const express = require("express");
const router = express.Router();
const pool = require("../db");
const { getSedesPermitidas } = require("../utils/sedes");

// ===================== LISTADO =====================
router.get("/", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    const sedesPermitidas = getSedesPermitidas(req);

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
      WHERE ca.sede IN (?)
      ORDER BY ca.fecha DESC
    `, [sedesPermitidas]);

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

    const sedesPermitidas = getSedesPermitidas(req);

    const [unidades] = await pool.query(
      "SELECT id, placa FROM unidades WHERE sede IN (?) ORDER BY placa",
      [sedesPermitidas]
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

    const sedesPermitidas = getSedesPermitidas(req);

    // obtenemos la sede real de la unidad (para no depender del form)
    const [[unidad]] = await pool.query(
      "SELECT sede FROM unidades WHERE id = ?",
      [unidad_id]
    );

    if (!unidad || !sedesPermitidas.includes(unidad.sede)) {
      return res.status(403).send("No autorizado para esa unidad");
    }

    // guardar historial si existe registro previo
    await pool.query(`
      INSERT INTO cambios_aceite_historial
      (unidad_id, sede, km_actual, galones, proximo_km, observaciones, creado_por)
      SELECT unidad_id, sede, km_actual, galones, proximo_km, observaciones, creado_por
      FROM cambios_aceite
      WHERE unidad_id = ?
    `, [unidad_id]);

    // upsert en tabla actual
    await pool.query(`
      INSERT INTO cambios_aceite 
        (unidad_id, sede, km_actual, galones, proximo_km, observaciones, creado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        sede = VALUES(sede),
        km_actual = VALUES(km_actual),
        galones = VALUES(galones),
        proximo_km = VALUES(proximo_km),
        observaciones = VALUES(observaciones),
        creado_por = VALUES(creado_por),
        fecha = CURRENT_TIMESTAMP
    `, [unidad_id, unidad.sede, km_actual, galones, proximo_km, observaciones || null, req.session.user.id]);

    res.redirect("/aceite");

  } catch (error) {
    console.error("❌ ERROR guardar cambio de aceite:", error);
    res.status(500).send("Error interno");
  }
});

module.exports = router;
