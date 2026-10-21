const cron = require("node-cron");
const pool = require("./db");
const { enviarRecordatorio } = require("./utils/emailService");
const { actualizarHaciendaPendientes } = require('./utils/proveedorHaciendaPendientes');
const { synchronizeMailbox } = require('./routes/facturasCorreo.routes');
const { cruzarFacturasPendientes } = require('./utils/portalCruceAutomatico');
const { tareaSinEncimar } = require('./utils/tareaUnica');

// Cada tarea lleva su propio candado: si una vuelta tarda más de 5 minutos,
// la siguiente se omite en lugar de correr dos veces al mismo tiempo.
const consultarHacienda = tareaSinEncimar('Consulta pendiente Hacienda', () => actualizarHaciendaPendientes(pool));
const sincronizarCorreo = tareaSinEncimar('Sincronización Outlook pendiente', () => synchronizeMailbox());
const cruzarFacturas = tareaSinEncimar('Cruce de facturas pendiente', () => cruzarFacturasPendientes(pool));

cron.schedule('*/5 * * * *', () => {
  consultarHacienda();
  sincronizarCorreo();
  cruzarFacturas();
});

// Función para formatear fecha a YYYY-MM-DD
const formatDate = (d) => d.toISOString().split("T")[0];

async function enviarRecordatoriosMinae(dias, columna, fechaObjetivo, db = pool, enviar = enviarRecordatorio) {
  const [citas] = await db.query(
    `SELECT mt.*, u.placa
     FROM minae_tramites mt
     JOIN unidades u ON u.id = mt.unidad_id
     WHERE mt.tiene_cita = 1
       AND mt.${columna} = 0
       AND DATE(mt.fecha_cita) = ?`,
    [formatDate(fechaObjetivo)]
  );
  let enviados = 0;
  let fallidos = 0;
  for (const cita of citas) {
    // Un recordatorio que falla no debe impedir el envío de los demás.
    try {
      await enviar(cita, dias, cita.fecha_cita, cita.lugar_cita);
      await db.query(`UPDATE minae_tramites SET ${columna} = 1 WHERE id = ?`, [cita.id]);
      enviados += 1;
    } catch (error) {
      fallidos += 1;
      console.error(`Recordatorio MINAE (${dias} días) de la cita ${cita.id} falló:`, error?.code || error?.message || error);
    }
  }
  return { enviados, fallidos };
}

async function revisarRecordatoriosMinae(db = pool, enviar = enviarRecordatorio, hoy = new Date()) {
  console.log("🕗 Ejecutando revisión de recordatorios MINAE...");
  const base = new Date(hoy);
  base.setHours(0, 0, 0, 0);
  const dentroDe15Dias = new Date(base);
  dentroDe15Dias.setDate(base.getDate() + 15);
  const dentroDe2Dias = new Date(base);
  dentroDe2Dias.setDate(base.getDate() + 2);

  const resultados = {};
  for (const [dias, columna, fecha] of [[15, 'recordatorio_15d_enviado', dentroDe15Dias], [2, 'recordatorio_2d_enviado', dentroDe2Dias]]) {
    try {
      resultados[dias] = await enviarRecordatoriosMinae(dias, columna, fecha, db, enviar);
    } catch (error) {
      resultados[dias] = { error: error?.code || error?.message || String(error) };
      console.error(`Revisión de recordatorios MINAE a ${dias} días falló:`, resultados[dias].error);
    }
  }
  console.log("✅ Revisión de recordatorios finalizada.", resultados);
  return resultados;
}

// Programar tarea: todos los días a las 8:00 AM
cron.schedule("0 8 * * *", tareaSinEncimar('Recordatorios MINAE', () => revisarRecordatoriosMinae()));

console.log("⏰ Cron job de recordatorios MINAE programado (8:00 AM diario)");

module.exports = { revisarRecordatoriosMinae, enviarRecordatoriosMinae };
