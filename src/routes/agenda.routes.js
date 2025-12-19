const express = require("express");
const pool = require("../db");
const { generarAgenda } = require("../ia");
const { requireRole } = require("../middleware");

const router = express.Router();
/**
 * COMPATIBILIDAD: /agenda/hoy
 */
router.get("/hoy", (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10);
  res.redirect(`/agenda?fecha=${hoy}`);
});

/**
 * AGENDA POR FECHA
 * /agenda?fecha=YYYY-MM-DD
 */
router.get("/", async (req, res) => {
function hoyCR() {
  const now = new Date();
  now.setHours(now.getHours() - 6); // Costa Rica UTC-6
  return now.toISOString().slice(0, 10);
}

const fecha = req.query.fecha || hoyCR();


  const [rows] = await pool.query(
    `
    SELECT 
      m.id,
      m.fecha_programada,
      m.tipo,
      m.prioridad,
      m.estado,
      u.placa
    FROM mantenimientos m
    JOIN unidades u ON u.id = m.unidad_id
    WHERE m.fecha_programada = ?
    ORDER BY u.placa
    `,
    [fecha]
  );

  res.render("agenda_hoy", {
    fecha,
    items: rows
  });
});

/**
 * GENERAR AGENDA PARA UNA FECHA (ADMIN)
 */
router.post("/generar", requireRole("ADMIN"), async (req, res) => {
  const { fecha } = req.body;

  await generarAgenda(fecha, "CARTAGO");

  res.redirect(`/agenda?fecha=${fecha}`);
});

module.exports = router;
