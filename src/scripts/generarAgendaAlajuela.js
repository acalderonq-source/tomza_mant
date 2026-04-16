const pool = require("../db");

// siguiente día hábil
function siguienteDiaHabil(fecha) {
  const f = new Date(fecha);

  do {
    f.setDate(f.getDate() + 1);
  } while (f.getDay() === 0 || f.getDay() === 6);

  return f;
}

// formato fecha SQL
function formato(fecha) {
  return fecha.toISOString().slice(0, 10);
}

async function generarAgendaAlajuela() {
  try {
    console.log("🚀 Generando agenda SOLO Alajuela");

    // 🔥 SOLO ALAJUELA
    const [unidades] = await pool.query(`
      SELECT id 
      FROM unidades 
      WHERE sede = 'Alajuela' 
      AND activa = 1
      ORDER BY placa
    `);

    let fecha = new Date();
    let contador = 0;

    for (const unidad of unidades) {

      // 5 por día
      if (contador >= 5) {
        fecha = siguienteDiaHabil(fecha);
        contador = 0;
      }

      const fechaSQL = formato(fecha);

      await pool.query(`
        INSERT INTO mantenimientos 
        (unidad_id, sede, tipo, estado, fecha_programada)
        VALUES (?, 'Alajuela', 'PREVENTIVO', 'PENDIENTE', ?)
      `, [
        unidad.id,
        fechaSQL
      ]);

      contador++;
    }

    console.log("✅ Agenda Alajuela generada");

  } catch (error) {
    console.error("❌ Error:", error);
  }
}

module.exports = generarAgendaAlajuela;