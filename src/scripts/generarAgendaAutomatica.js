require("dotenv").config();

const pool = require("../db");

/* ================== FECHAS ================== */

function esDiaHabil(fecha) {
  const d = fecha.getDay();
  return d !== 0 && d !== 6;
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

/* ================== CONFIG ================== */

const CONFIG = {
  Cartago: 5,
  Guapiles: 2,
  "La Cruz": 2,
  "Perez Zeledon": 2
};

/* ================== SCRIPT ================== */

(async () => {

  try {

    console.log("⏳ Generando agenda automática...");

    for (const sede of Object.keys(CONFIG)) {

      const porDia = CONFIG[sede];

      console.log(`\n📍 Sede: ${sede}`);

      // =========================
      // TRAER UNIDADES
      // =========================
      const [unidades] = await pool.query(`
        SELECT id
        FROM unidades
        WHERE sede = ?
        ORDER BY id
      `, [sede]);

      if (unidades.length === 0) {
        console.log(`⚠️ Sin unidades en ${sede}`);
        continue;
      }

      // =========================
      // ÚLTIMA PROGRAMADA
      // =========================
      const [ultima] = await pool.query(`
        SELECT unidad_id
        FROM mantenimientos
        WHERE sede = ?
        AND tipo = 'PREVENTIVO'
        ORDER BY id DESC
        LIMIT 1
      `, [sede]);

      let ultimoIndex = -1;

      if (ultima.length > 0) {

        ultimoIndex = unidades.findIndex(
          u => u.id === ultima[0].unidad_id
        );

      }

      // =========================
      // REINICIAR CICLO
      // =========================
      let index = ultimoIndex + 1;

      if (index >= unidades.length) {
        index = 0;
      }

      // =========================
      // FECHA INICIAL
      // =========================
      let fecha = hoyOProximoHabil();

      // =========================
      // GENERAR 30 DÍAS
      // =========================
      for (let d = 0; d < 30; d++) {

        const hoy = fecha.toISOString().slice(0, 10);

        for (let i = 0; i < porDia; i++) {

          const unidad = unidades[index];

          await pool.query(`
            INSERT INTO mantenimientos
            (
              unidad_id,
              sede,
              tipo,
              estado,
              prioridad,
              fecha_programada
            )
            VALUES
            (
              ?,
              ?,
              'PREVENTIVO',
              'PROGRAMADO',
              'MEDIA',
              ?
            )
          `, [
            unidad.id,
            sede,
            hoy
          ]);

          index++;

          // 🔥 REINICIAR DESDE EL PRINCIPIO
          if (index >= unidades.length) {
            index = 0;
          }

        }

        fecha = siguienteDiaHabil(fecha);

      }

      console.log(`✅ ${sede} generado`);

    }

    console.log("\n🚛 Agenda automática completada");
    process.exit();

  } catch (err) {

    console.error("❌ Error:", err);
    process.exit(1);

  }

})();