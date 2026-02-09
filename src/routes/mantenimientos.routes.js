const express = require("express");
const router = express.Router();
const pool = require("../db");

// ===================== LISTADO DE CORRECTIVOS =====================
router.get("/correctivos", async (req, res) => {
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

    const [rows] = await pool.query(`
      SELECT 
        c.id,
        DATE_FORMAT(c.fecha, '%d/%m/%Y %H:%i') AS fecha_formato,
        u.placa,
        c.trabajo_realizado,
        c.pendiente,
        us.nombre
      FROM correctivos c
      JOIN unidades u ON u.id = c.unidad_id
      JOIN usuarios us ON us.id = c.creado_por
      WHERE c.sede = ?
      ORDER BY c.fecha DESC
    `, [sedeFiltro]);

    res.render("correctivos", {
      correctivos: rows,
      user: req.session.user
    });

  } catch (error) {
    console.error("❌ ERROR listado correctivos:", error);
    res.status(500).send("Error interno");
  }
});

// ===================== FORM NUEVO CORRECTIVO =====================
router.get("/correctivos/nuevo", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    if (!["MECANICO", "ADMIN"].includes(req.session.user.rol)) {
      return res.redirect("/mantenimientos");
    }

    let sedeFiltro = null;

    if (req.session.user.rol === "ADMIN") {
      if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
        sedeFiltro = req.session.sedeSeleccionada;
      }
    } else {
      sedeFiltro = req.session.user.sede;
    }

    const [unidades] = await pool.query(
      "SELECT id, placa FROM unidades WHERE sede = ? ORDER BY placa",
      [sedeFiltro]
    );

    res.render("correctivos_nuevo", {
      unidades,
      user: req.session.user
    });

  } catch (error) {
    console.error("❌ ERROR form correctivo:", error);
    res.status(500).send("Error interno");
  }
});

// ===================== GUARDAR CORRECTIVO =====================
router.post("/correctivos", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    if (!["MECANICO", "ADMIN"].includes(req.session.user.rol)) {
      return res.status(403).send("No autorizado");
    }

    const { unidad_id, trabajo_realizado, pendiente } = req.body;

    let sedeFiltro = null;

    if (req.session.user.rol === "ADMIN") {
      if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
        sedeFiltro = req.session.sedeSeleccionada;
      }
    } else {
      sedeFiltro = req.session.user.sede;
    }

    await pool.query(`
      INSERT INTO correctivos (unidad_id, sede, trabajo_realizado, pendiente, creado_por)
      VALUES (?, ?, ?, ?, ?)
    `, [
      unidad_id,
      sedeFiltro,
      trabajo_realizado,
      pendiente || null,
      req.session.user.id
    ]);

    res.redirect("/mantenimientos/correctivos");

  } catch (error) {
    console.error("❌ ERROR guardar correctivo:", error);
    res.status(500).send("Error interno");
  }
});

// ===================== LISTADO DE MANTENIMIENTOS =====================
router.get("/", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    const filtro = req.query.filtro;

    let condiciones = [];
    let params = [];

    if (filtro === "pendientes") {
      condiciones.push("m.estado != 'CERRADO'");
    } else if (filtro === "realizados") {
      condiciones.push("m.estado = 'CERRADO'");
    }

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

    const where = condiciones.length ? "WHERE " + condiciones.join(" AND ") : "";

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
      sedeSeleccionada: sedeFiltro || "TODAS"
    });

  } catch (error) {
    console.error("❌ ERROR /mantenimientos:", error);
    res.status(500).send("Internal Server Error");
  }
});

// ===================== DETALLE DE MANTENIMIENTO =====================
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

// ===================== GUARDAR PLAN =====================
router.post("/:id/plan", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    if (!["ADMIN", "TALLER"].includes(req.session.user.rol)) {
      return res.status(403).send("No autorizado");
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

// ===================== GUARDAR EJECUCIÓN =====================
router.post("/:id/ejecucion", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    if (!["ADMIN", "MECANICO"].includes(req.session.user.rol)) {
      return res.status(403).send("No autorizado");
    }

    const { ejecucion, pendiente } = req.body;

    await pool.query(`
      UPDATE mantenimientos 
      SET ejecucion = ?, pendiente = ?, estado = 'CERRADO'
      WHERE id = ?
    `, [ejecucion, pendiente, req.params.id]);

    res.redirect("/mantenimientos");

  } catch (error) {
    console.error("❌ ERROR cerrar mantenimiento:", error);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = router;
