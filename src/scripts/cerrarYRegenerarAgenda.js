const pool = require("../db");

/**
 * Retorna la siguiente fecha hábil (salta domingos)
 */
function siguienteDiaHabil(fecha) {
  const f = new Date(fecha);
  do {
    f.setDate(f.getDate() + 1);
  } while (f.getDay() === 0);
  return f.toISOString().slice(0, 10);
}

async function cerrarYRegenerar() {
  try {
    console.log("🔒 Cerrando mantenimientos pendientes...");

    // 1️⃣ Cerrar SOLO los pendientes
    const [pendientes] = await pool.query(`
      SELECT id
      FROM mantenimientos
      WHERE estado != 'CERRADO'
    `);

    for (const m of pendientes) {
      await pool.query(
        `
        UPDATE mantenimientos
        SET
          estado = 'CERRADO',
          ejecucion = COALESCE(ejecucion, 'NO REALIZADO - CIERRE AUTOMÁTICO'),
          pendiente = 'Reprogramado automáticamente'
        WHERE id = ?
        `,
        [m.id]
      );
    }

    console.log(`✅ ${pendientes.length} mantenimientos cerrados`);

    // 2️⃣ Obtener unidades
    const [unidades] = await pool.query(`
      SELECT id, placa
      FROM unidades
      ORDER BY id
    `);

    // 3️⃣ Última fecha programada
    const [[ultima]] = await pool.query(`
      SELECT MAX(fecha_programada) AS ultima_fecha
      FROM mantenimientos
    `);

    let fechaBase = ultima?.ultima_fecha
      ? new Date(ultima.ultima_fecha)
      : new Date();

    // Ajustar a Costa Rica
    fechaBase.setHours(fechaBase.getHours() - 6);

    if (fechaBase.getDay() === 0) {
      fechaBase = new Date(siguienteDiaHabil(fechaBase));
    }

    console.log("📅 Generando nueva agenda...");

    let contadorDia = 0;

    for (const unidad of unidades) {

      if (contadorDia === 5) {
        fechaBase = new Date(siguienteDiaHabil(fechaBase));
        contadorDia = 0;
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

    console.log("🎯 Proceso COMPLETADO correctamente");
    process.exit();

  } catch (error) {
    console.error("❌ Error en cierre y regeneración:", error);
    process.exit(1);
  }
}

cerrarYRegenerar();
