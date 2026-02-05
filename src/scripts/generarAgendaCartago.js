require("dotenv").config();
const pool = require("../db");

function esDiaHabil(fecha) {
  const d = fecha.getDay();
  return d !== 0 && d !== 6; // 0 domingo, 6 sábado
}

function hoyOProximoHabil() {
  const hoy = new Date();
  if (esDiaHabil(hoy)) return hoy;

  const f = new Date(hoy);
  do {
    f.setDate(f.getDate() + 1);
  } while (!esDiaHabil(f));
  return f;
}

function siguienteDiaHabil(fecha) {
  const f = new Date(fecha);
  do {
    f.setDate(f.getDate() + 1);
  } while (!esDiaHabil(f));
  return f;
}

(async () => {
  try {
    console.log("⏳ Generando agenda CARTAGO...");

    // 1️⃣ traer SOLO unidades de Cartago
    const [unidades] = await pool.query(
      "SELECT id FROM unidades WHERE sede = 'Cartago' ORDER BY id"
    );

    const porDia = 5;
    let fecha = new Date();

    // empezar desde mañana
    fecha.setDate(fecha.getDate() + 1);

    let index = 0;

    while (index < unidades.length) {
      const hoy = fecha.toISOString().slice(0, 10);

      const lote = unidades.slice(index, index + porDia);

      for (const u of lote) {
        await pool.query(`
          INSERT INTO mantenimientos
          (unidad_id, sede, tipo, estado, prioridad, fecha_programada)
          VALUES (?, 'Cartago', 'PREVENTIVO', 'PROGRAMADO', 'MEDIA', ?)
        `, [u.id, hoy]);
      }

      index += porDia;
      fecha = siguienteDiaHabil(fecha);
    }

    console.log("✅ Agenda CARTAGO generada correctamente");
    process.exit();

  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
})();
