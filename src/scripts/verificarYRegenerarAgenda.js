const pool = require("../db");

/**
 * Retorna siguiente día hábil (lunes a viernes)
 */
function siguienteDiaHabil(fecha) {
  const f = new Date(fecha);
  do {
    f.setDate(f.getDate() + 1);
  } while (f.getDay() === 0 || f.getDay() === 6); // domingo o sábado
  return f.toISOString().slice(0, 10);
}

async function verificarYRegenerarAgenda() {
  try {
    console.log("🔍 Verificando mantenimientos pendientes...");

    // 1️⃣ Ver si existen PROGRAMADOS
    const [pendientes] = await pool.query(`
      SELECT COUNT(*) AS total
      FROM mantenimientos
      WHERE estado = 'PROGRAMADO'
    `);

    if (pendientes[0].total > 0) {
      console.log("⏳ Aún hay mantenimientos pendientes. No se genera agenda.");
      return;
    }

    console.log("✅ No hay pendientes. Generando nueva agenda...");

    // 2️⃣ Obtener todas las unidades activas
    const [unidades] = await pool.query(`
      SELECT id
      FROM unidades
      WHERE estado = 'ACTIVA'
    `);

    if (unidades.length === 0) {
      console.log("⚠️ No hay unidades activas.");
      return;
    }

    // 3️⃣ Fecha inicial (mañana hábil)
    let fecha = siguienteDiaHabil(new Date());

    // 4️⃣ Generar agenda
    for (const unidad of unidades) {
      await pool.query(
        `
        INSERT INTO mantenimientos
          (unidad_id, tipo, estado, prioridad, fecha_programada)
        VALUES
          (?, 'PREVENTIVO', 'PROGRAMADO', 'MEDIA', ?)
        `,
        [unidad.id, fecha]
      );

      fecha = siguienteDiaHabil(fecha);
    }

    console.log("🚀 Agenda generada correctamente");

  } catch (error) {
    console.error("❌ ERROR regenerando agenda:", error);
  } finally {
    process.exit();
  }
}

verificarYRegenerarAgenda();
