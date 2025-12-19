const express = require("express");
const router = express.Router();
const pool = require("../db");

/* =======================
   LISTADO DE MANTENIMIENTOS
======================= */
router.get("/", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    const [mantenimientos] = await pool.query(`
      SELECT 
        m.id,
        u.placa,
        m.fecha_programada,
        m.tipo,
        m.estado
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      ORDER BY m.fecha_programada DESC
    `);

    res.render("mantenimientos", {
      mantenimientos,
      user: req.session.user
    });

  } catch (error) {
    console.error("❌ Error listado mantenimientos:", error);
    res.status(500).send("Error interno");
  }
});

/* =======================
   DETALLE DE MANTENIMIENTO
======================= */
router.get("/:id", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    const [[mantenimiento]] = await pool.query(
      `
      SELECT 
        m.*,
        u.placa
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      WHERE m.id = ?
      `,
      [req.params.id]
    );

    if (!mantenimiento) {
      return res.redirect("/agenda");
    }

    res.render("mantenimiento_detalle", {
      mantenimiento,
      user: req.session.user
    });

  } catch (error) {
    console.error("❌ Error detalle mantenimiento:", error);
    res.status(500).send("Error interno");
  }
});

/* =======================
   PLAN (SOLO TALLER / ADMIN)
======================= */
router.post("/:id/plan", async (req, res) => {
  try {
    if (
      !req.session.user ||
      !["TALLER", "ADMIN"].includes(req.session.user.rol)
    ) {
      return res.redirect("/dashboard");
    }

    const { plan } = req.body;

    await pool.query(
      "UPDATE mantenimientos SET plan = ? WHERE id = ?",
      [plan, req.params.id]
    );

    res.redirect(`/mantenimientos/${req.params.id}`);

  } catch (error) {
    console.error("❌ Error guardando plan:", error);
    res.status(500).send("Error interno");
  }
});

/* =======================
   EJECUCIÓN + PENDIENTES
   (SOLO MECÁNICO / ADMIN)
======================= */
router.post("/:id/ejecutar", async (req, res) => {
  try {
    if (
      !req.session.user ||
      !["MECANICO", "ADMIN"].includes(req.session.user.rol)
    ) {
      return res.redirect("/dashboard");
    }

    const { ejecucion, pendientes } = req.body;

    await pool.query(
      `
      UPDATE mantenimientos
      SET ejecucion = ?,
          pendientes = ?,
          estado = 'CERRADO',
          fecha_cierre = NOW()
      WHERE id = ?
      `,
      [ejecucion, pendientes, req.params.id]
    );

    res.redirect(`/mantenimientos/${req.params.id}`);

  } catch (error) {
    console.error("❌ Error cerrando mantenimiento:", error);
    res.status(500).send("Error interno");
  }
});

module.exports = router;
