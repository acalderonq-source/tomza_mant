const express = require("express");
const router = express.Router();
const pool = require("../db");

// LISTADO DE MANTENIMIENTOS
router.get("/", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    const filtro = req.query.filtro;

    let condiciones = [];
    let params = [];

    // filtro por estado
    if (filtro === "pendientes") {
      condiciones.push("m.estado != 'CERRADO'");
    } else if (filtro === "realizados") {
      condiciones.push("m.estado = 'CERRADO'");
    }

    // determinar sede
    let sedeFiltro = null;

    if (req.session.user.rol === "ADMIN") {
      if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
        sedeFiltro = req.session.sedeSeleccionada;
      }
    } else {
      sedeFiltro = req.session.user.sede;
    }

    if (sedeFiltro) {
      condiciones.push("u.sede = ?");
      params.push(sedeFiltro);
    }

    const where = condiciones.length
      ? "WHERE " + condiciones.join(" AND ")
      : "";

    const [mantenimientos] = await pool.query(`
      SELECT 
        m.id,
        u.placa,
        u.sede,
        m.tipo,
        m.estado,
        DATE_FORMAT(m.fecha_programada, '%d/%m/%Y') AS fecha_formato,
        m.ejecucion,
        m.pendiente
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      ${where}
      ORDER BY m.fecha_programada DESC, m.id DESC
    `, params);

    res.render("mantenimientos", {
      mantenimientos,
      user: req.session.user,
      filtro,
      sedeSeleccionada: req.session.sedeSeleccionada || req.session.user.sede
    });

  } catch (error) {
    console.error("❌ ERROR /mantenimientos:", error);
    res.status(500).send("Internal Server Error");
  }
});

// DETALLE
router.get("/:id", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    let sql = `
      SELECT 
        m.id,
        m.tipo,
        m.estado,
        m.prioridad,
        m.plan,
        m.ejecucion,
        m.pendiente,
        u.placa,
        u.sede
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      WHERE m.id = ?
    `;

    let params = [req.params.id];

    let sedeFiltro = null;

    if (req.session.user.rol === "ADMIN") {
      if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
        sedeFiltro = req.session.sedeSeleccionada;
      }
    } else {
      sedeFiltro = req.session.user.sede;
    }

    if (sedeFiltro) {
      sql += " AND u.sede = ?";
      params.push(sedeFiltro);
    }

    const [rows] = await pool.query(sql, params);

    if (rows.length === 0) {
      return res.send("Mantenimiento no encontrado");
    }

    res.render("mantenimiento_detalle", {
      mantenimiento: rows[0],
      user: req.session.user
    });

  } catch (error) {
    console.error("❌ ERROR detalle mantenimiento:", error);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = router;
