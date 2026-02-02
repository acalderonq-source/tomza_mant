const express = require("express");
const router = express.Router();
const pool = require("../db");

// DASHBOARD PRINCIPAL
router.get("/", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    // fecha de hoy en formato YYYY-MM-DD
    const hoy = new Date();
    const fechaHoy = hoy.toISOString().split("T")[0];

    let sqlHoy = `
      SELECT 
        m.id,
        u.placa,
        m.tipo,
        m.estado,
        m.plan,
        DATE_FORMAT(m.fecha_programada, '%d/%m/%Y') AS fecha
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      WHERE m.fecha_programada = ?
    `;

    let paramsHoy = [fechaHoy];

    // si NO es admin, filtrar por sede
    if (req.session.user.rol !== "ADMIN") {
      sqlHoy += " AND u.sede = ?";
      paramsHoy.push(req.session.user.sede);
    }

    sqlHoy += " ORDER BY m.id";

    const [hoyMantenimientos] = await pool.query(sqlHoy, paramsHoy);

    // estadísticas generales
    let sqlStats = `
      SELECT 
        SUM(CASE WHEN m.estado = 'CERRADO' THEN 1 ELSE 0 END) AS realizados,
        SUM(CASE WHEN m.estado != 'CERRADO' THEN 1 ELSE 0 END) AS pendientes
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      WHERE 1=1
    `;

    let paramsStats = [];

    if (req.session.user.rol !== "ADMIN") {
      sqlStats += " AND u.sede = ?";
      paramsStats.push(req.session.user.sede);
    }

    const [statsRows] = await pool.query(sqlStats, paramsStats);
    const stats = statsRows[0] || { realizados: 0, pendientes: 0 };

    res.render("dashboard", {
      user: req.session.user,
      hoy: hoyMantenimientos,
      stats
    });

  } catch (error) {
    console.error("❌ ERROR dashboard:", error);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = router;
