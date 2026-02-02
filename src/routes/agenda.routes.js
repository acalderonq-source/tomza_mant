const express = require("express");
const router = express.Router();
const pool = require("../db");

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

    const user = req.session.user;
    const fecha = hoy();

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

    // 🔒 si el usuario tiene sede, solo ver esa sede
    if (user.sede && user.sede !== "") {
      sql += " AND u.sede = ?";
      params.push(user.sede);
    }

    sql += " ORDER BY m.id";

    const [agenda] = await pool.query(sql, params);

    res.render("agenda", {
      agenda,
      fecha,
      user,
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

    const user = req.session.user;

    const manana = siguienteDiaHabil(new Date());

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

    // 🔒 filtro por sede del usuario
    if (user.sede && user.sede !== "") {
      sql += " AND u.sede = ?";
      params.push(user.sede);
    }

    sql += " ORDER BY m.id";

    const [agenda] = await pool.query(sql, params);

    res.render("agenda", {
      agenda,
      fecha: manana,
      user,
      vista: "manana"
    });

  } catch (err) {
    console.error("Error agenda mañana:", err);
    res.status(500).send("Error interno");
  }
});

module.exports = router;
