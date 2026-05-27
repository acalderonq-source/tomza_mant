const express = require("express");
const router = express.Router();
const pool = require("../db");

// ================= FUNCIONES =================

function hoy() {
  const f = new Date();
  f.setHours(0, 0, 0, 0);
  return f.toISOString().slice(0, 10);
}

function siguienteDiaHabil(fechaBase) {
  const f = new Date(fechaBase);
  do {
    f.setDate(f.getDate() + 1);
  } while (f.getDay() === 0 || f.getDay() === 6);
  return f.toISOString().slice(0, 10);
}

// Obtener sedes permitidas del usuario (igual que en dashboard)
async function obtenerSedesPermitidas(req) {
  const [extras] = await pool.query(
    `SELECT sede FROM usuarios_sedes WHERE usuario_id = ?`,
    [req.session.user.id]
  );
  const sedes = [
    ...new Set([
      req.session.user.sede,
      ...extras.map(e => e.sede)
    ])
  ].filter(Boolean);
  return sedes;
}

// Determinar la sede actual (filtro)
function obtenerSedeFiltro(req, sedesPermitidas) {
  if (req.session.user.rol === "ADMIN") {
    if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
      return req.session.sedeSeleccionada;
    }
    return null; // null = todas las sedes
  } else {
    // Usuarios normales: si tiene varias sedes, usa la seleccionada; si no, la primera
    if (req.session.sedeSeleccionada && sedesPermitidas.includes(req.session.sedeSeleccionada)) {
      return req.session.sedeSeleccionada;
    } else {
      return sedesPermitidas[0] || null;
    }
  }
}

// ================= AGENDA HOY =================
router.get("/", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    const fecha = hoy();
    const sedesPermitidas = await obtenerSedesPermitidas(req);
    const sedeFiltro = obtenerSedeFiltro(req, sedesPermitidas);

    let sql = `
      SELECT 
        'PREVENTIVO' AS tipo_registro,
        m.id AS id,
        u.placa,
        u.sede,
        m.tipo AS subtipo,
        m.estado,
        m.plan AS descripcion,
        DATE_FORMAT(m.fecha_programada, '%d/%m/%Y') AS fecha_mostrar
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      WHERE m.fecha_programada = ?
        AND m.tipo = 'PREVENTIVO'

      UNION ALL

      SELECT 
        'CORRECTIVO' AS tipo_registro,
        c.id AS id,
        u.placa,
        u.sede,
        NULL AS subtipo,
        'REALIZADO' AS estado,
        c.trabajo_realizado AS descripcion,
        DATE_FORMAT(c.fecha, '%d/%m/%Y') AS fecha_mostrar
      FROM correctivos c
      JOIN unidades u ON u.id = c.unidad_id
      WHERE DATE(c.fecha) = ?
    `;

    const params = [fecha, fecha];

    if (sedeFiltro) {
      sql += " AND u.sede = ?";
      params.push(sedeFiltro);
    } else if (sedesPermitidas.length && req.session.user.rol !== "ADMIN") {
      // Si no es ADMIN y no hay sede específica, mostrar solo las sedes permitidas
      sql += " AND u.sede IN (?)";
      params.push(sedesPermitidas);
    }

    sql += " ORDER BY fecha_mostrar, placa";

    const [agenda] = await pool.query(sql, params);

    res.render("agenda", {
      agenda,
      fecha,
      user: req.session.user,
      vista: "hoy",
      sedeSeleccionada: sedeFiltro || "TODAS",
      sedesPermitidas
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
    const sedesPermitidas = await obtenerSedesPermitidas(req);
    const sedeFiltro = obtenerSedeFiltro(req, sedesPermitidas);

    let sql = `
      SELECT 
        'PREVENTIVO' AS tipo_registro,
        m.id AS id,
        u.placa,
        u.sede,
        m.tipo AS subtipo,
        m.estado,
        m.plan AS descripcion,
        DATE_FORMAT(m.fecha_programada, '%d/%m/%Y') AS fecha_mostrar
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      WHERE m.fecha_programada = ?
        AND m.tipo = 'PREVENTIVO'

      UNION ALL

      SELECT 
        'CORRECTIVO' AS tipo_registro,
        c.id AS id,
        u.placa,
        u.sede,
        NULL AS subtipo,
        'REALIZADO' AS estado,
        c.trabajo_realizado AS descripcion,
        DATE_FORMAT(c.fecha, '%d/%m/%Y') AS fecha_mostrar
      FROM correctivos c
      JOIN unidades u ON u.id = c.unidad_id
      WHERE DATE(c.fecha) = ?
    `;

    const params = [manana, manana];

    if (sedeFiltro) {
      sql += " AND u.sede = ?";
      params.push(sedeFiltro);
    } else if (sedesPermitidas.length && req.session.user.rol !== "ADMIN") {
      sql += " AND u.sede IN (?)";
      params.push(sedesPermitidas);
    }

    sql += " ORDER BY fecha_mostrar, placa";

    const [agenda] = await pool.query(sql, params);

    res.render("agenda", {
      agenda,
      fecha: manana,
      user: req.session.user,
      vista: "manana",
      sedeSeleccionada: sedeFiltro || "TODAS",
      sedesPermitidas
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

    const sedesPermitidas = await obtenerSedesPermitidas(req);
    let sedeFiltro = req.session.sedeSeleccionada && sedesPermitidas.includes(req.session.sedeSeleccionada)
      ? req.session.sedeSeleccionada
      : sedesPermitidas[0];

    if (!sedeFiltro) return res.status(400).send("No hay sedes disponibles");

    const [unidades] = await pool.query(
      `SELECT id, placa FROM unidades WHERE sede = ? ORDER BY placa`,
      [sedeFiltro]
    );

    res.render("agenda_nuevo", {
      unidades,
      user: req.session.user,
      sedeSeleccionada: sedeFiltro
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
    if (!unidad_id || !tipo || !fecha) return res.status(400).send("Datos incompletos");

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