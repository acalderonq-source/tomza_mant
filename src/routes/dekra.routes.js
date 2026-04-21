const express = require("express");
const router = express.Router();
const pool = require("../db");

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function obtenerSedeFiltro(req) {
  if (!req.session.user) return null;

  if (req.session.user.rol === "ADMIN") {
    if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
      return req.session.sedeSeleccionada;
    }
    return null;
  }

  return req.session.user.sede;
}

// =========================
// LISTADO DEKRA
// =========================
router.get("/", requireAuth, async (req, res) => {
  try {
    const sedeFiltro = obtenerSedeFiltro(req);
    const mes = req.query.mes || "";
    const negocio = req.query.negocio || "";

    let sql = `
      SELECT
        d.id,
        u.placa,
        d.sede,
        d.mes,
        d.negocio,
        d.estado,
        d.observacion,
        DATE_FORMAT(d.fecha_registro, '%d/%m/%Y %H:%i') AS fecha_registro
      FROM dekra_control d
      JOIN unidades u ON u.id = d.unidad_id
      WHERE 1=1
    `;

    const params = [];

    if (sedeFiltro) {
      sql += ` AND d.sede = ?`;
      params.push(sedeFiltro);
    }

    if (mes) {
      sql += ` AND d.mes = ?`;
      params.push(mes);
    }

    if (negocio) {
      sql += ` AND d.negocio = ?`;
      params.push(negocio);
    }

    sql += ` ORDER BY d.sede, d.mes, d.negocio, u.placa`;

    const [rows] = await pool.query(sql, params);

    res.render("dekra", {
      registros: rows,
      user: req.session.user,
      mesSeleccionado: mes,
      negocioSeleccionado: negocio
    });
  } catch (error) {
    console.error("❌ Error cargando DEKRA:", error);
    res.status(500).send("Error interno");
  }
});

// =========================
// FORM NUEVO REGISTRO
// =========================
router.get("/nuevo", requireAuth, async (req, res) => {
  try {
    const sedeFiltro = obtenerSedeFiltro(req);

    let sql = `SELECT id, placa, sede FROM unidades WHERE activa = 1`;
    const params = [];

    if (sedeFiltro) {
      sql += ` AND sede = ?`;
      params.push(sedeFiltro);
    }

    sql += ` ORDER BY sede, placa`;

    const [unidades] = await pool.query(sql, params);

    res.render("dekra_nuevo", {
      unidades,
      user: req.session.user
    });
  } catch (error) {
    console.error("❌ Error formulario DEKRA:", error);
    res.status(500).send("Error interno");
  }
});

// =========================
// GUARDAR NUEVO REGISTRO
// =========================
router.post("/nuevo", requireAuth, async (req, res) => {
  try {
    const { unidad_id, mes, negocio } = req.body;

    if (!unidad_id || !mes || !negocio) {
      return res.status(400).send("Datos incompletos");
    }

    const [[unidad]] = await pool.query(
      `SELECT id, sede FROM unidades WHERE id = ? LIMIT 1`,
      [unidad_id]
    );

    if (!unidad) {
      return res.status(404).send("Unidad no encontrada");
    }

    await pool.query(
      `
      INSERT INTO dekra_control (unidad_id, sede, mes, negocio, estado, actualizado_por)
      VALUES (?, ?, ?, ?, 'PENDIENTE', ?)
      `,
      [unidad.id, unidad.sede, mes, negocio, req.session.user.id]
    );

    res.redirect("/dekra");
  } catch (error) {
    console.error("❌ Error guardando DEKRA:", error);
    res.status(500).send("Error interno");
  }
});

// =========================
// MARCAR COMO REALIZADO
// =========================
router.post("/:id/realizado", requireAuth, async (req, res) => {
  try {
    await pool.query(
      `
      UPDATE dekra_control
      SET estado = 'REALIZADO',
          observacion = NULL,
          actualizado_por = ?,
          fecha_actualizacion = NOW()
      WHERE id = ?
      `,
      [req.session.user.id, req.params.id]
    );

    res.redirect("/dekra");
  } catch (error) {
    console.error("❌ Error marcando realizado:", error);
    res.status(500).send("Error interno");
  }
});

// =========================
// MARCAR COMO NO REALIZADO
// =========================
router.post("/:id/no-realizado", requireAuth, async (req, res) => {
  try {
    const { observacion } = req.body;

    if (!observacion || !observacion.trim()) {
      return res.status(400).send("Debe indicar el motivo");
    }

    await pool.query(
      `
      UPDATE dekra_control
      SET estado = 'NO_REALIZADO',
          observacion = ?,
          actualizado_por = ?,
          fecha_actualizacion = NOW()
      WHERE id = ?
      `,
      [observacion.trim(), req.session.user.id, req.params.id]
    );

    res.redirect("/dekra");
  } catch (error) {
    console.error("❌ Error marcando no realizado:", error);
    res.status(500).send("Error interno");
  }
});

module.exports = router;