const pool = require("../db");

function siguienteDiaHabil(fecha) {
  const nuevaFecha = new Date(fecha);

  do {
    nuevaFecha.setDate(nuevaFecha.getDate() + 1);
  } while (nuevaFecha.getDay() === 0); // 0 = Domingo

  return nuevaFecha.toISOString().split("T")[0];
}

async function reprogramar() {
  try {
    console.log("🔄 Reprogramando mantenimientos pendientes...");

    // 1️⃣ Buscar mantenimientos NO cerrados y vencidos
    const [pendientes] = await pool.query(`
      SELECT id, fecha_programada
      FROM mantenimientos
      WHERE estado != 'CERRADO'
        AND fecha_programada < CURDATE()
    `);

    for (const m of pendientes) {
      const nuevaFecha = siguienteDiaHabil(m.fecha_programada);

      await pool.query(
        "UPDATE mantenimientos SET fecha_programada = ? WHERE id = ?",
        [nuevaFecha, m.id]
      );

      console.log(`✅ Mantenimiento ${m.id} → ${nuevaFecha}`);
    }

    console.log("🎯 Reprogramación finalizada");

  } catch (error) {
    console.error("❌ Error reprogramando:", error);
  } finally {
    process.exit();
  }
}

reprogramar();
