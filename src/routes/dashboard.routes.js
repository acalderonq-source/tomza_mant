const express = require("express");
const pool = require("../db");

const router = express.Router();

router.get("/dashboard", async (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10);

  const [[prog]] = await pool.query(
    "SELECT COUNT(*) total FROM mantenimientos WHERE fecha_programada=?",
    [hoy]
  );

  res.render("dashboard", {
    hoy,
    programados: prog.total,
    en_proceso: 0,
    cerrados: 0
  });
});

module.exports = router;
