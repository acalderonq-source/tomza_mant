const pool = require("../db");

async function generarAgenda() {
  try {
    // 1️⃣ Obtener todas las unidades activas
    const [unidades] = await pool.query(
      "SELECT id FROM unidades WHERE activa = 1 ORDER BY id"
    );

    if (unidades.length === 0) {
      console.log("❌ No hay unidades");
      process.exit();
    }

    const hoy = new Date();
    let diaOffset = 0;
    let contadorDia = 0;

    for (let i = 0; i < unidades.length; i++) {
      // Si ya hay 5 en el día, pasar al siguiente
      if (contadorDia === 5) {
        contadorDia = 0;
        diaOffset++;
      }

      const fecha = new Date(hoy);
      fecha.setDate(hoy.getDate() + diaOffset);

      const fechaSQL = fecha.toISOString().split("T")[0];

      await pool.query(
        `INSERT INTO mantenimientos 
        (unidad_id, fecha_programada, tipo, estado)
        VALUES (?, ?, 'PREVENTIVO', 'PROGRAMADO')`,
        [unidades[i].id, fechaSQL]
      );

      contadorDia++;
    }

    console.log("✅ Agenda generada correctamente");
    process.exit();

  } catch (error) {
    console.error("❌ Error generando agenda:", error);
    process.exit(1);
  }
}

generarAgenda();
