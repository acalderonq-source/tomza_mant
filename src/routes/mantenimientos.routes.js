const express = require("express");
const router = express.Router();
const pool = require("../db");

// ===================== LISTADO DE MANTENIMIENTOS =====================
router.get("/", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    const filtro = req.query.filtro;

    let where = "";
    if (filtro === "pendientes") {
      where = "WHERE m.estado != 'CERRADO'";
    }
    if (filtro === "realizados") {
      where = "WHERE m.estado = 'CERRADO'";
    }

    const [mantenimientos] = await pool.query(`
      SELECT 
        m.id,
        u.placa,
        m.tipo,
        m.estado,
        DATE_FORMAT(m.fecha_programada, '%d/%m/%Y') AS fecha_formato,
        m.ejecucion,
        m.pendiente
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      ${where}
      ORDER BY m.fecha_programada DESC, m.id DESC
    `);

    res.render("mantenimientos", {
      mantenimientos,
      user: req.session.user,
      filtro
    });

  } catch (error) {
    console.error("❌ ERROR /mantenimientos:", error);
    res.status(500).send("Internal Server Error");
  }
});

// ===================== DETALLE DE MANTENIMIENTO =====================
router.get("/:id", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    const { id } = req.params;

    const [[mantenimiento]] = await pool.query(
      `
      SELECT 
        m.id,
        m.tipo,
        m.estado,
        m.prioridad,
        m.plan,
        m.ejecucion,
        m.pendiente,
        DATE_FORMAT(m.fecha_programada, '%d/%m/%Y') AS fecha_formato,
        u.placa
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      WHERE m.id = ?
      `,
      [id]
    );

    if (!mantenimiento) {
      return res.status(404).send("Mantenimiento no encontrado");
    }

    res.render("mantenimiento_detalle", {
      mantenimiento,
      user: req.session.user
    });

  } catch (error) {
    console.error("❌ ERROR detalle mantenimiento:", error);
    res.status(500).send("Internal Server Error");
  }
});

// ===================== GUARDAR PLAN (ADMIN / TALLER) =====================
router.post("/:id/plan", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    if (!["ADMIN", "TALLER"].includes(req.session.user.rol)) {
      return res.status(403).send("No autorizado");
    }

    const { plan } = req.body;

    await pool.query(
      `UPDATE mantenimientos SET plan = ? WHERE id = ?`,
      [plan, req.params.id]
    );

    res.redirect(`/mantenimientos/${req.params.id}`);

  } catch (error) {
    console.error("❌ Error guardando plan:", error);
    res.status(500).send("Error interno");
  }
});


// ===================== GUARDAR EJECUCIÓN (ADMIN / MECÁNICO) =====================
router.post("/:id/ejecucion", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    if (!["ADMIN", "MECANICO"].includes(req.session.user.rol)) {
      return res.status(403).send("No autorizado");
    }

    const { id } = req.params;
    const { ejecucion, pendiente } = req.body;

    await pool.query(
      `
      UPDATE mantenimientos 
      SET 
        ejecucion = ?,
        pendiente = ?,
        estado = 'CERRADO'
      WHERE id = ?
      `,
      [ejecucion, pendiente, id]
    );

    res.redirect("/mantenimientos");

  } catch (error) {
    console.error("❌ ERROR cerrar mantenimiento:", error);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = router;
