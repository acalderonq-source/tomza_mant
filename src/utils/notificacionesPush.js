const pool = require("../db");

let webPush = null;
try {
  webPush = require("web-push");
} catch (error) {
  console.warn("web-push no disponible; las notificaciones push quedan desactivadas:", error.code || error.message);
}

function getVapidKeys() {
  if (!webPush) {
    return { publicKey: null, privateKey: null };
  }

  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY
    };
  }

  if (!global.__tomzaVapidKeys) {
    global.__tomzaVapidKeys = webPush.generateVAPIDKeys();
    console.warn("VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no configuradas. Se generaron llaves temporales para esta ejecución.");
  }

  return global.__tomzaVapidKeys;
}

function configurarWebPush() {
  if (!webPush) return false;

  const keys = getVapidKeys();
  if (!keys.publicKey || !keys.privateKey) return false;

  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@tomza.local",
    keys.publicKey,
    keys.privateKey
  );

  return true;
}

async function queryWithRetry(sql, params = []) {
  try {
    return await pool.query(sql, params);
  } catch (error) {
    if (["ECONNRESET", "PROTOCOL_CONNECTION_LOST", "ETIMEDOUT"].includes(error.code)) {
      console.warn("Reintentando consulta MySQL por conexión reiniciada:", error.code);
      return pool.query(sql, params);
    }
    throw error;
  }
}

async function ensurePushTables() {
  await queryWithRetry(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT NULL,
      usuario VARCHAR(100) NULL,
      rol VARCHAR(50) NULL,
      sede VARCHAR(100) NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      ultimo_envio DATE NULL,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_push_endpoint (endpoint(255)),
      INDEX idx_push_activo (activo),
      INDEX idx_push_sede (sede)
    )
  `);
}

async function guardarSuscripcion(user, subscription) {
  await ensurePushTables();

  if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
    throw new Error("Suscripción push inválida.");
  }

  await queryWithRetry(
    `INSERT INTO push_subscriptions
       (usuario_id, usuario, rol, sede, endpoint, p256dh, auth, activo)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       usuario_id = VALUES(usuario_id),
       usuario = VALUES(usuario),
       rol = VALUES(rol),
       sede = VALUES(sede),
       p256dh = VALUES(p256dh),
       auth = VALUES(auth),
       activo = 1,
       actualizado_en = CURRENT_TIMESTAMP`,
    [
      user.id || null,
      user.usuario || null,
      user.rol || null,
      user.sede || null,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth
    ]
  );
}

function puedeRecibirMantenimiento(subscription, mantenimiento) {
  if (!subscription || !mantenimiento) return false;
  if (subscription.rol === "ADMIN") return true;
  if (!subscription.sede) return true;
  return String(subscription.sede).toUpperCase() === String(mantenimiento.sede || "").toUpperCase();
}

async function enviarPush(subscription, payload) {
  if (!configurarWebPush()) return { ok: false, reason: "web-push no configurado" };

  const pushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth
    }
  };

  try {
    await webPush.sendNotification(pushSubscription, JSON.stringify(payload));
    return { ok: true };
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      await queryWithRetry("UPDATE push_subscriptions SET activo = 0 WHERE id = ?", [subscription.id]);
    }
    console.warn("No se pudo enviar push:", error.statusCode || error.message);
    return { ok: false, reason: error.message };
  }
}

async function enviarRecordatoriosMantenimientos(fechaObjetivo = null) {
  await ensurePushTables();

  const fecha = fechaObjetivo || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [mantenimientos] = await queryWithRetry(
    `SELECT
       m.id,
       m.tipo,
       m.plan,
       m.estado,
       m.fecha_programada,
       u.placa,
       u.sede
     FROM mantenimientos m
     JOIN unidades u ON u.id = m.unidad_id
     WHERE DATE(m.fecha_programada) = ?
       AND m.estado != 'CERRADO'
     ORDER BY u.sede, u.placa`,
    [fecha]
  );

  if (!mantenimientos.length) {
    return { fecha, mantenimientos: 0, enviados: 0 };
  }

  const [subscriptions] = await queryWithRetry(
    "SELECT * FROM push_subscriptions WHERE activo = 1",
    []
  );

  let enviados = 0;
  for (const mantenimiento of mantenimientos) {
    const payload = {
      title: "Mantenimiento pendiente mañana",
      body: `${mantenimiento.placa} · ${mantenimiento.sede} · ${mantenimiento.tipo || "Mantenimiento"}`,
      icon: "/img/app-icon.svg",
      badge: "/img/app-icon.svg",
      url: `/mantenimientos/${mantenimiento.id}`,
      tag: `mant-${mantenimiento.id}-${fecha}`,
      data: {
        mantenimientoId: mantenimiento.id,
        fecha,
        url: `/mantenimientos/${mantenimiento.id}`
      }
    };

    for (const subscription of subscriptions) {
      if (!puedeRecibirMantenimiento(subscription, mantenimiento)) continue;
      const result = await enviarPush(subscription, payload);
      if (result.ok) enviados++;
    }
  }

  return { fecha, mantenimientos: mantenimientos.length, enviados };
}

module.exports = {
  configurarWebPush,
  enviarRecordatoriosMantenimientos,
  ensurePushTables,
  getVapidKeys,
  guardarSuscripcion
};
