const express = require("express");
const router = express.Router();
const pool = require("../db");

// Agenda HOY
router.get("/", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    const fecha = new Date().toISOString().split("T")[0];

    const [agenda] = await pool.query(
      `
      SELECT 
        m.id,
        u.placa,
        m.tipo,
        m.estado,
        m.plan
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      WHERE m.fecha_programada = ?
      ORDER BY m.id
      `,
      [fecha]
    );

    res.render("agenda", {
      agenda,
      fecha,
      user: req.session.user,
      vista: "hoy"
    });

  } catch (error) {
    console.error("❌ Error agenda hoy:", error);
    res.status(500).send("Error interno");
  }
});

// Agenda MAÑANA
router.get("/manana", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    const fecha = manana.toISOString().split("T")[0];

    const [agenda] = await pool.query(
      `
      SELECT 
        m.id,
        u.placa,
        m.tipo,
        m.estado,
        m.plan
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      WHERE m.fecha_programada = ?
      ORDER BY m.id
      `,
      [fecha]
    );

    res.render("agenda", {
      agenda,
      fecha,
      user: req.session.user,
      vista: "manana"
    });

  } catch (error) {
    console.error("❌ Error agenda mañana:", error);
    res.status(500).send("Error interno");
  }
});

module.exports = router;
