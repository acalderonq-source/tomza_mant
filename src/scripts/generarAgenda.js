const pool = require("../db");

/**
 * Retorna el próximo día hábil (L-V)
 */
function siguienteDiaHabil(fecha) {
  const f = new Date(fecha);

  do {
    f.setDate(f.getDate() + 1);
  } while (f.getDay() === 0 || f.getDay() === 6);

  return f;
}

async function generarAgenda() {
  try {
    console.log("📅 Generando agenda (Lunes a Viernes, desde HOY)...");

    // 1️⃣ Obtener unidades
    const [unidades] = await pool.query(`
      SELECT id, placa
      FROM unidades
      ORDER BY id
    `);

    if (unidades.length === 0) {
      console.log("⚠️ No hay unidades");
      process.exit();
    }

    // 2️⃣ Fecha base = HOY (Costa Rica)
    let fechaBase = new Date();
    fechaBase.setHours(fechaBase.getHours() - 6); // UTC-6 CR

    // Si hoy no es hábil, mover al siguiente día hábil
    if (fechaBase.getDay() === 0 || fechaBase.getDay() === 6) {
      fechaBase = siguienteDiaHabil(fechaBase);
    }

    let contadorDia = 0;

    // 3️⃣ Generar agenda
    for (const unidad of unidades) {

      // Máximo 5 por día
      if (contadorDia === 5) {
        fechaBase = siguienteDiaHabil(fechaBase);
        contadorDia = 0;
      }

      // Asegurar que SIEMPRE sea L-V
      if (fechaBase.getDay() === 0 || fechaBase.getDay() === 6) {
        fechaBase = siguienteDiaHabil(fechaBase);
      }

      const fechaProgramada = fechaBase.toISOString().slice(0, 10);

      await pool.query(
        `
        INSERT INTO mantenimientos
          (unidad_id, tipo, estado, prioridad, fecha_programada)
        VALUES
          (?, 'PREVENTIVO', 'PROGRAMADO', 'MEDIA', ?)
        `,
        [unidad.id, fechaProgramada]
      );

      console.log(`🆕 ${unidad.placa} → ${fechaProgramada}`);

      contadorDia++;
    }

    console.log("✅ Agenda generada correctamente (sin fechas pasadas, sin sábados)");
    process.exit();

  } catch (error) {
    console.error("❌ Error generando agenda:", error);
    process.exit(1);
  }
}

generarAgenda();
