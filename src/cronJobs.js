const cron = require("node-cron");
const pool = require("./db");               // Ajusta la ruta si db.js está en src/
const { enviarRecordatorio } = require("./utils/emailService");

// Función para formatear fecha a YYYY-MM-DD
const formatDate = (d) => d.toISOString().split("T")[0];

// Programar tarea: todos los días a las 8:00 AM
cron.schedule("0 8 * * *", async () => {
  console.log("🕗 Ejecutando revisión de recordatorios MINAE...");

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const dentroDe15Dias = new Date(hoy);
  dentroDe15Dias.setDate(hoy.getDate() + 15);
  const dentroDe2Dias = new Date(hoy);
  dentroDe2Dias.setDate(hoy.getDate() + 2);

  // Recordatorios a 15 días
  const [citas15] = await pool.query(
    `SELECT mt.*, u.placa 
     FROM minae_tramites mt
     JOIN unidades u ON u.id = mt.unidad_id
     WHERE mt.tiene_cita = 1 
       AND mt.recordatorio_15d_enviado = 0 
       AND DATE(mt.fecha_cita) = ?`,
    [formatDate(dentroDe15Dias)]
  );

  for (const cita of citas15) {
    await enviarRecordatorio(cita, 15, cita.fecha_cita, cita.lugar_cita);
    await pool.query("UPDATE minae_tramites SET recordatorio_15d_enviado = 1 WHERE id = ?", [cita.id]);
  }

  // Recordatorios a 2 días
  const [citas2] = await pool.query(
    `SELECT mt.*, u.placa 
     FROM minae_tramites mt
     JOIN unidades u ON u.id = mt.unidad_id
     WHERE mt.tiene_cita = 1 
       AND mt.recordatorio_2d_enviado = 0 
       AND DATE(mt.fecha_cita) = ?`,
    [formatDate(dentroDe2Dias)]
  );

  for (const cita of citas2) {
    await enviarRecordatorio(cita, 2, cita.fecha_cita, cita.lugar_cita);
    await pool.query("UPDATE minae_tramites SET recordatorio_2d_enviado = 1 WHERE id = ?", [cita.id]);
  }

  console.log("✅ Revisión de recordatorios finalizada.");
});

console.log("⏰ Cron job de recordatorios MINAE programado (8:00 AM diario)");