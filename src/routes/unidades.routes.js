const express = require("express");
const pool = require("../db");
const { requireRole } = require("../middleware");

const router = express.Router();

router.get("/", requireRole("ADMIN"), async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM unidades");
  res.render("unidades", { unidades: rows, error: null });
});

router.post("/", requireRole("ADMIN"), async (req, res) => {
  try {
    await pool.query("INSERT INTO unidades (placa, sede) VALUES (?, 'CARTAGO')", [
      req.body.placa
    ]);
    res.redirect("/unidades");
  } catch {
    const [rows] = await pool.query("SELECT * FROM unidades");
    res.render("unidades", { unidades: rows, error: "Placa duplicada" });
  }
});

module.exports = router;
