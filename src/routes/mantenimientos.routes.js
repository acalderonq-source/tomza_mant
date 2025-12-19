const express = require("express");
const pool = require("../db");
const { requireRole } = require("../middleware");

const router = express.Router();

/**
 * HISTORIAL POR PLACA Y/O FECHA
 * /mantenimientos?placa=&fecha_desde=&fecha_hasta=
 */
router.get("/", async (req, res) => {
  const { placa, fecha_desde, fecha_hasta } = req.query;

  let where = [];
  let params = [];

  if (placa) {
    where.push("u.placa = ?");
    params.push(placa);
  }

  if (fecha_desde) {
    where.push("m.fecha_programada >= ?");
    params.push(fecha_desde);
  }

  if (fecha_hasta) {
    where.push("m.fecha_programada <= ?");
    params.push(fecha_hasta);
  }

  const whereSQL = where.length ? "WHERE " + where.join(" AND ") : "";

  const [rows] = await pool.query(
    `
    SELECT 
      m.id,
      m.fecha_programada,
      m.tipo,
      m.prioridad,
      m.estado,
      u.placa,
      pt.plan_texto,
      e.realizado_texto,
      e.pendientes_texto
    FROM mantenimientos m
    JOIN unidades u ON u.id = m.unidad_id
    LEFT JOIN planes_taller pt ON pt.mantenimiento_id = m.id
    LEFT JOIN ejecuciones e ON e.mantenimiento_id = m.id
    ${whereSQL}
    ORDER BY m.fecha_programada DESC, u.placa
    `,
    params
  );

  res.render("historial", {
    placa: placa || "",
    fecha_desde: fecha_desde || "",
    fecha_hasta: fecha_hasta || "",
    items: rows
  });
});

/**
 * VER MANTENIMIENTO DETALLE
 */
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  const [rows] = await pool.query(
    `
    SELECT m.*, u.placa
    FROM mantenimientos m
    JOIN unidades u ON u.id = m.unidad_id
    WHERE m.id = ?
    LIMIT 1
    `,
    [id]
  );

  if (!rows.length) return res.send("Mantenimiento no existe");

  const m = rows[0];

  const [planRows] = await pool.query(
    "SELECT * FROM planes_taller WHERE mantenimiento_id = ?",
    [id]
  );

  const [ejRows] = await pool.query(
    "SELECT * FROM ejecuciones WHERE mantenimiento_id = ?",
    [id]
  );

  res.render("mantenimiento_detalle", {
    m,
    plan: planRows[0] || null,
    ejecucion: ejRows[0] || null
  });
});

/**
 * GUARDAR PLAN (TALLER)
 */
router.post("/:id/plan", requireRole("TALLER", "ADMIN"), async (req, res) => {
  const { id } = req.params;
  const { plan_texto } = req.body;

  await pool.query(
    `
    INSERT INTO planes_taller (mantenimiento_id, plan_texto, creado_por_user_id)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE
      plan_texto = VALUES(plan_texto),
      creado_por_user_id = VALUES(creado_por_user_id)
    `,
    [id, plan_texto, req.user.id]
  );

  await pool.query(
    `
    UPDATE mantenimientos
    SET estado = 'EN_PROCESO'
    WHERE id = ? AND estado = 'PROGRAMADO'
    `,
    [id]
  );

  res.redirect(`/mantenimientos/${id}`);
});

/**
 * GUARDAR EJECUCIÓN (MECÁNICOS)
 */
router.post("/:id/ejecucion", requireRole("MECANICOS", "ADMIN"), async (req, res) => {
  const { id } = req.params;
  const { realizado_texto, pendientes_texto } = req.body;

  await pool.query(
    `
    INSERT INTO ejecuciones (mantenimiento_id, realizado_texto, pendientes_texto, mecanico_user_id)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      realizado_texto = VALUES(realizado_texto),
      pendientes_texto = VALUES(pendientes_texto),
      mecanico_user_id = VALUES(mecanico_user_id)
    `,
    [id, realizado_texto, pendientes_texto || null, req.user.id]
  );

  await pool.query(
    `
    UPDATE mantenimientos
    SET estado = 'CERRADO', cerrado_por_user_id = ?
    WHERE id = ?
    `,
    [req.user.id, id]
  );

  res.redirect(`/mantenimientos/${id}`);
});

module.exports = router;
