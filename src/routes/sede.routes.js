const express = require("express");
const router = express.Router();

// Cambiar sede solo ADMIN
router.post("/cambiar-sede", (req, res) => {
  if (!req.session.user || req.session.user.rol !== "ADMIN") {
    return res.redirect("/dashboard");
  }

  const { sede } = req.body; // "Cartago" | "La Cruz" | ""

  if (!sede || sede === "") {
    // ver todas las sedes
    req.session.sedeActual = null;
  } else {
    // fijar sede elegida
    req.session.sedeActual = sede;
  }

  res.redirect("/dashboard");
});

module.exports = router;
