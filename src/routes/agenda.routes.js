const express = require("express");
const router = express.Router();
const pool = require("../db");
const { getSedesPermitidas } = require("../utils/sedes");

// fecha hoy en formato YYYY-MM-DD
function hoy() {
  const f = new Date();
  f.setHours(0, 0, 0, 0);
  return f.toISOString().slice(0, 10);
}

// siguiente día hábil (sin sábado ni domingo)
function siguienteDiaHabil(fechaBase) {
  const f = new Date(fechaBase);
  do {
    f.setDate(f.getDate() + 1);
  } while (f.getDay() === 0 || f.getDay() === 6);
  return f.toISOString().slice(0, 10);
}

// ================= AGENDA HOY =================
router.get("/", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    const fecha = hoy();
    const sedesPermitidas = getSedesPermitidas(req);

    let sql = `
      SELECT 
        m.id,
        u.placa,
        u.sede,
        m.tipo,
        m.estado,
        m.plan,
        DATE_FORMAT(m.fecha_programada,'%d/%m/%Y') AS fecha
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      WHERE m.fecha_programada = ?
    `;

    const params = [fecha];

    if (sedesPermitidas.length) {
      sql += " AND u.sede IN (?)";
      params.push(sedesPermitidas);
    }

    sql += " ORDER BY m.id";

    const [agenda] = await pool.query(sql, params);

    res.render("agenda", {
      agenda,
      fecha,
      user: req.session.user,
      vista: "hoy"
    });

  } catch (err) {
    console.error("Error agenda hoy:", err);
    res.status(500).send("Error interno");
  }
});

// ================= AGENDA MAÑANA =================
router.get("/manana", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    const manana = siguienteDiaHabil(new Date());
    const sedesPermitidas = getSedesPermitidas(req);

    let sql = `
      SELECT 
        m.id,
        u.placa,
        u.sede,
        m.tipo,
        m.estado,
        m.plan,
        DATE_FORMAT(m.fecha_programada,'%d/%m/%Y') AS fecha
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      WHERE m.fecha_programada = ?
    `;

    const params = [manana];

    if (sedesPermitidas.length) {
      sql += " AND u.sede IN (?)";
      params.push(sedesPermitidas);
    }

    sql += " ORDER BY m.id";

    const [agenda] = await pool.query(sql, params);

    res.render("agenda", {
      agenda,
      fecha: manana,
      user: req.session.user,
      vista: "manana"
    });

  } catch (err) {
    console.error("Error agenda mañana:", err);
    res.status(500).send("Error interno");
  }
});

module.exports = router;
