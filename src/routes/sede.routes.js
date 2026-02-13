const express = require("express");
const router = express.Router();

router.post("/cambiar-sede", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const sede = req.body.sede;

  // ADMIN: puede cambiar entre todas
  if (req.session.user.rol === "ADMIN") {
    req.session.sedeSeleccionada = sede || "TODAS";
    return res.redirect(req.get("Referrer") || "/dashboard");
  }

  // Usuario especial: pesados
  if (req.session.user.usuario === "pesados") {
    if (!["Transportadora", "Granel"].includes(sede)) {
      return res.status(403).send("Sede no permitida");
    }
    req.session.sedeSeleccionada = sede;
    return res.redirect(req.get("Referrer") || "/dashboard");
  }

  return res.status(403).send("No autorizado");
});

module.exports = router;
