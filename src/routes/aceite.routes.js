const express = require("express");
const router = express.Router();
const pool = require("../db");

// ===================== LISTADO =====================
router.get("/", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    let sedeFiltro = null;
    if (req.session.user.rol === "ADMIN") {
      if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
        sedeFiltro = req.session.sedeSeleccionada;
      }
    } else {
      sedeFiltro = req.session.user.sede;
    }
    if (!sedeFiltro) sedeFiltro = req.session.user.sede;

    const [rows] = await pool.query(`
      SELECT 
        ca.id,
        DATE_FORMAT(ca.fecha, '%d/%m/%Y %H:%i') AS fecha_formato,
        u.placa,
        ca.km_actual,
        ca.galones,
        ca.proximo_km,
        ca.observaciones,
        us.nombre AS mecanico
      FROM cambios_aceite ca
      JOIN unidades u ON u.id = ca.unidad_id
      JOIN usuarios us ON us.id = ca.creado_por
      WHERE ca.sede = ?
      ORDER BY ca.fecha DESC
    `, [sedeFiltro]);

    res.render("aceite_listado", { cambios: rows, user: req.session.user });

  } catch (error) {
    console.error("❌ ERROR listado cambios de aceite:", error);
    res.status(500).send("Error interno");
  }
});

// ===================== FORM NUEVO =====================
router.get("/nuevo", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");
    if (!["ADMIN", "MECANICO"].includes(req.session.user.rol)) {
      return res.redirect("/aceite");
    }

    let sedeFiltro = null;
    if (req.session.user.rol === "ADMIN") {
      if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
        sedeFiltro = req.session.sedeSeleccionada;
      }
    } else {
      sedeFiltro = req.session.user.sede;
    }
    if (!sedeFiltro) sedeFiltro = req.session.user.sede;

    const [unidades] = await pool.query(
      "SELECT id, placa FROM unidades WHERE sede = ? ORDER BY placa",
      [sedeFiltro]
    );

    res.render("aceite_nuevo", { unidades, user: req.session.user });

  } catch (error) {
    console.error("❌ ERROR form aceite:", error);
    res.status(500).send("Error interno");
  }
});

// ===================== GUARDAR =====================
router.post("/", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");
    if (!["ADMIN", "MECANICO"].includes(req.session.user.rol)) {
      return res.status(403).send("No autorizado");
    }

    const { unidad_id, km_actual, galones, proximo_km, observaciones } = req.body;

    let sedeFiltro = null;
    if (req.session.user.rol === "ADMIN") {
      if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
        sedeFiltro = req.session.sedeSeleccionada;
      }
    } else {
      sedeFiltro = req.session.user.sede;
    }
    if (!sedeFiltro) sedeFiltro = req.session.user.sede;

    await pool.query(`
      INSERT INTO cambios_aceite (unidad_id, sede, km_actual, galones, proximo_km, observaciones, creado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [unidad_id, sedeFiltro, km_actual, galones, proximo_km, observaciones || null, req.session.user.id]);

    res.redirect("/aceite");

  } catch (error) {
    console.error("❌ ERROR guardar cambio de aceite:", error);
    res.status(500).send("Error interno");
  }
});

module.exports = router;
