const express = require("express");
const router = express.Router();
const pool = require("../db");
const { getSedesPermitidas } = require("../utils/sedes");

// ================= FUNCIONES =================

// fecha hoy YYYY-MM-DD
function hoy() {
  const f = new Date();
  f.setHours(0, 0, 0, 0);
  return f.toISOString().slice(0, 10);
}

// siguiente día hábil
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
    const sedesPermitidas = await getSedesPermitidas(req); // ✅ await

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
        AND m.tipo = 'PREVENTIVO'
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
    console.error("🔥 ERROR REAL:", err);
    return res.status(500).send(err.message);
  }
});

// ================= AGENDA MAÑANA =================
router.get("/manana", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    const manana = siguienteDiaHabil(new Date());
    const sedesPermitidas = await getSedesPermitidas(req); // ✅ await

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

// ================= FORM NUEVO =================
router.get("/nuevo", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    if (!["SUPERVISOR_PESADO", "ADMIN", "TALLER"].includes(req.session.user.rol)) {
      return res.status(403).send("No autorizado");
    }

    // Obtenemos la(s) sede(s) permitidas para el usuario
    const sedesPermitidas = await getSedesPermitidas(req);

    // Si el usuario tiene varias sedes, debemos permitir elegir? Por simplicidad,
    // tomamos la primera o usamos la sede de sesión. Ajusta según tu lógica.
    let sedeFiltro = null;
    if (sedesPermitidas.length === 1) {
      sedeFiltro = sedesPermitidas[0];
    } else if (req.session.sedeSeleccionada && sedesPermitidas.includes(req.session.sedeSeleccionada)) {
      sedeFiltro = req.session.sedeSeleccionada;
    } else {
      sedeFiltro = req.session.user.sede; // puede ser undefined si el usuario no tiene sede fija
    }

    if (!sedeFiltro) {
      return res.status(400).send("No se ha definido una sede para el usuario.");
    }

    const [unidades] = await pool.query(
      `SELECT id, placa, sede FROM unidades WHERE sede = ? ORDER BY placa`,
      [sedeFiltro]
    );

    res.render("agenda_nuevo", {
      unidades,
      user: req.session.user
    });
  } catch (err) {
    console.error("Error form agenda:", err);
    res.status(500).send("Error interno");
  }
});

// ================= GUARDAR =================
router.post("/nuevo", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    if (!["SUPERVISOR_PESADO", "ADMIN", "TALLER"].includes(req.session.user.rol)) {
      return res.status(403).send("No autorizado");
    }

    const { unidad_id, tipo, plan, fecha } = req.body;

    if (!unidad_id || !tipo || !fecha) {
      return res.status(400).send("Datos incompletos");
    }

    // Obtener la sede de la unidad seleccionada (más seguro que usar la sede de sesión)
    const [[unidad]] = await pool.query("SELECT sede FROM unidades WHERE id = ?", [unidad_id]);
    if (!unidad) return res.status(404).send("Unidad no encontrada");

    await pool.query(
      `INSERT INTO mantenimientos 
       (unidad_id, sede, tipo, plan, estado, fecha_programada, creado_por)
       VALUES (?, ?, ?, ?, 'PENDIENTE', ?, ?)`,
      [unidad_id, unidad.sede, tipo, plan || null, fecha, req.session.user.id]
    );

    res.redirect("/agenda");
  } catch (err) {
    console.error("Error guardando agenda:", err);
    res.status(500).send("Error interno");
  }
});

module.exports = router;