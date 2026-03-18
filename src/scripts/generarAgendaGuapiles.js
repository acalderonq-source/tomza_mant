require("dotenv").config();
const pool = require("../db");

/* ================== FECHAS ================== */
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

/* ================== SCRIPT ================== */
async function generarAgendaGuapiles() {
  try {
    console.log("⏳ Generando agenda GUAPILES...");

    // 🔹 Unidades SOLO de Guapiles
    const [unidades] = await pool.query(`
      SELECT id, placa
      FROM unidades
      WHERE sede = 'Guapiles'
      ORDER BY placa
    `);

    if (unidades.length === 0) {
      console.log("⚠️ No hay unidades de Pérez Zeledón");
      process.exit();
    }

    let fecha = hoyOProximoHabil();
    let contadorDia = 0;
    const LIMITE_DIA = 2; // 👈 PÉREZ ZELEDÓN = 2 POR DÍA

    for (const unidad of unidades) {

      // 🔹 No duplicar mantenimientos pendientes
      const [existe] = await pool.query(`
        SELECT id
        FROM mantenimientos
        WHERE unidad_id = ?
          AND estado != 'CERRADO'
      `, [unidad.id]);

      if (existe.length > 0) continue;

      await pool.query(`
        INSERT INTO mantenimientos
          (unidad_id, tipo, estado, prioridad, fecha_programada, sede)
        VALUES
          (?, 'PREVENTIVO', 'PROGRAMADO', 'MEDIA', ?, 'Guapiles')
      `, [
        unidad.id,
        fecha.toISOString().slice(0, 10)
      ]);

      console.log(`✔ ${unidad.placa} → ${fecha.toISOString().slice(0, 10)}`);

      contadorDia++;

      // 🔹 Cambiar de día cuando se llena el cupo
      if (contadorDia === LIMITE_DIA) {
        fecha = siguienteDiaHabil(fecha);
        contadorDia = 0;
      }
    }

    console.log("✅ Agenda PÉREZ ZELEDÓN generada DESDE HOY");
    process.exit();

  } catch (error) {
    console.error("❌ Error generando agenda PÉREZ ZELEDÓN:", error);
    process.exit(1);
  }
}

generarAgendaGuapiles();