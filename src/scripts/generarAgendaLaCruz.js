require("dotenv").config();
const pool = require("../db");

/**
 * Retorna el siguiente día hábil (lunes a viernes)
 */
function siguienteDiaHabil(fecha) {
  const f = new Date(fecha);
  do {
    f.setDate(f.getDate() + 1);
  } while (f.getDay() === 0 || f.getDay() === 6); // domingo o sábado
  return f.toISOString().slice(0, 10);
}

async function generarAgendaLaCruz() {
  try {
    console.log("⏳ Generando agenda LA CRUZ...");

    // 🔹 SOLO unidades de La Cruz (sin columna activa)
    const [unidades] = await pool.query(`
      SELECT id, placa
      FROM unidades
      WHERE sede = 'La Cruz'
      ORDER BY placa
    `);

    if (unidades.length === 0) {
      console.log("⚠️ No hay unidades registradas en La Cruz");
      process.exit();
    }

    // 🔹 Fecha inicial = próximo día hábil
    let fecha = siguienteDiaHabil(new Date());

    let contadorDia = 0;
    const LIMITE_DIA = 2; // 👈 LA CRUZ = 2 POR DÍA

    for (const unidad of unidades) {

      // 🔹 No duplicar si ya tiene mantenimiento pendiente
      const [existe] = await pool.query(`
        SELECT id
        FROM mantenimientos
        WHERE unidad_id = ?
          AND estado != 'CERRADO'
      `, [unidad.id]);

      if (existe.length > 0) {
        continue;
      }

      await pool.query(`
        INSERT INTO mantenimientos
          (unidad_id, tipo, estado, prioridad, fecha_programada)
        VALUES
          (?, 'PREVENTIVO', 'PROGRAMADO', 'MEDIA', ?)
      `, [unidad.id, fecha]);

      console.log(`✔ ${unidad.placa} programada para ${fecha}`);

      contadorDia++;

      // 🔹 Cambiar de día SOLO al llegar al límite
      if (contadorDia === LIMITE_DIA) {
        fecha = siguienteDiaHabil(fecha);
        contadorDia = 0;
      }
    }

    console.log("✅ Agenda LA CRUZ generada correctamente");
    process.exit();

  } catch (error) {
    console.error("❌ Error generando agenda LA CRUZ:", error);
    process.exit(1);
  }
}

generarAgendaLaCruz();
