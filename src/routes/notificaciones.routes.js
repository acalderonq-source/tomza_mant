const express = require("express");
const router = express.Router();
const {
  enviarRecordatoriosMantenimientos,
  ensurePushTables,
  getVapidKeys,
  guardarSuscripcion
} = require("../utils/notificacionesPush");

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "No autenticado" });
  next();
}

router.get("/public-key", requireAuth, async (req, res) => {
  const keys = getVapidKeys();
  if (!keys.publicKey) {
    return res.status(503).json({ ok: false, error: "Notificaciones no configuradas" });
  }
  res.json({ ok: true, publicKey: keys.publicKey });
});

router.post("/suscribir", requireAuth, async (req, res) => {
  try {
    await guardarSuscripcion(req.session.user, req.body.subscription || req.body);
    res.json({ ok: true });
  } catch (error) {
    console.error("Error guardando suscripción push:", error);
    res.status(400).json({ ok: false, error: "No se pudo guardar la suscripción" });
  }
});

router.post("/probar", requireAuth, async (req, res) => {
  try {
    await ensurePushTables();
    const resultado = await enviarRecordatoriosMantenimientos(req.body.fecha || null);
    res.json({ ok: true, resultado });
  } catch (error) {
    console.error("Error probando notificaciones:", error);
    res.status(500).json({ ok: false, error: "No se pudo enviar la prueba" });
  }
});

module.exports = router;
