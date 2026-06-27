const express = require("express");
const router = express.Router();
const { obtenerContextoSistema, preguntarIA } = require("../utils/iaSistema");

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

router.get("/", requireAuth, async (req, res) => {
  res.render("ia", {
    user: req.session.user,
    tieneApiKey: Boolean(process.env.OPENAI_API_KEY),
    modelo: process.env.OPENAI_MODEL || "gpt-4.1-mini"
  });
});

router.post("/preguntar", requireAuth, async (req, res) => {
  try {
    const pregunta = String(req.body.pregunta || "").trim();
    if (!pregunta) {
      return res.status(400).json({ ok: false, error: "Debe escribir una pregunta." });
    }
    if (pregunta.length > 1200) {
      return res.status(400).json({ ok: false, error: "La pregunta es muy larga." });
    }

    const contexto = await obtenerContextoSistema(req, pregunta);
    const resultado = await preguntarIA(contexto, pregunta);

    res.json({
      ok: true,
      modo: resultado.modo,
      respuesta: resultado.respuesta
    });
  } catch (error) {
    console.error("Error IA:", error);
    res.status(500).json({
      ok: false,
      error: "No se pudo consultar la IA. Revise la configuración o intente de nuevo."
    });
  }
});

module.exports = router;
