const express = require("express");
const router = express.Router();

router.post("/cambiar-sede", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const { sede } = req.body;

  if (!["Cartago", "La Cruz", "TODAS"].includes(sede)) {
    return res.status(400).send("Sede inválida");
  }

  req.session.sedeSeleccionada = sede;

  console.log("👉 Sede en sesión:", req.session.sedeSeleccionada);

  res.redirect("/dashboard");
});

module.exports = router;
