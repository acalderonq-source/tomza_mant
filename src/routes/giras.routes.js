const express = require("express");
const router = express.Router();
const pool = require("../db");

const ROLES_VER_GIRAS = ["ADMIN", "TALLER", "MECANICO", "SUPERVISOR", "SUPERVISOR_PESADO"];
const ROLES_GESTION_GIRAS = ["ADMIN", "TALLER"];
const TODAS_SEDES = [
  "Cartago",
  "Guapiles",
  "La Cruz",
  "Transportadora",
  "Granel",
  "Alajuela",
  "Tecnicos",
  "Taller",
  "San Carlos",
  "Rio Claro",
  "Perez Zeledon",
  "Nicoya"
];

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (roles.includes(req.session.user.rol)) return next();
    return res.status(403).send("No autorizado");
  };
}

function puedeGestionar(user) {
  return ROLES_GESTION_GIRAS.includes(user.rol);
}

function sedesPermitidasGiras(req) {
  const user = req.session.user;

  if (["ADMIN", "TALLER"].includes(user.rol)) {
    if (user.rol === "ADMIN" && req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
      return [req.session.sedeSeleccionada];
    }
    return TODAS_SEDES;
  }

  return [user.sede].filter(Boolean);
}

function fechaInput(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function estadoValido(value) {
  const estado = String(value || "ABIERTA").trim().toUpperCase();
  return ["ABIERTA", "EN_SEGUIMIENTO", "CERRADA"].includes(estado) ? estado : "ABIERTA";
}

function etiquetaEstado(estado) {
  const etiquetas = {
    ABIERTA: "Abierta",
    EN_SEGUIMIENTO: "En seguimiento",
    CERRADA: "Cerrada"
  };
  return etiquetas[estado] || estado || "-";
}

async function ensureGirasTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS giras_taller (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sede VARCHAR(100) NOT NULL,
      fecha DATE NOT NULL,
      inspector VARCHAR(150) NOT NULL,
      estado ENUM('ABIERTA','EN_SEGUIMIENTO','CERRADA') NOT NULL DEFAULT 'ABIERTA',
      observaciones TEXT NOT NULL,
      pendientes TEXT NULL,
      acciones_recomendadas TEXT NULL,
      creado_por INT NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_giras_sede_fecha (sede, fecha),
      INDEX idx_giras_estado (estado)
    )
  `);
}

router.use(requireAuth);
router.use(allowRoles(...ROLES_VER_GIRAS));

router.get("/", async (req, res) => {
  try {
    await ensureGirasTable();

    const sedesPermitidas = sedesPermitidasGiras(req);
    const sedeFiltro = String(req.query.sede || "").trim();
    const estadoFiltro = String(req.query.estado || "").trim().toUpperCase();
    const fechaDesde = String(req.query.fecha_desde || "").trim();
    const fechaHasta = String(req.query.fecha_hasta || "").trim();

    let sql = `
      SELECT
        gt.*,
        DATE_FORMAT(gt.fecha, '%d/%m/%Y') AS fecha_formato,
        DATE_FORMAT(gt.creado_en, '%d/%m/%Y %H:%i') AS creado_formato,
        u.usuario AS creado_por_usuario
      FROM giras_taller gt
      LEFT JOIN usuarios u ON u.id = gt.creado_por
      WHERE gt.sede IN (?)
    `;
    const params = [sedesPermitidas];

    if (sedeFiltro && sedesPermitidas.includes(sedeFiltro)) {
      sql += " AND gt.sede = ?";
      params.push(sedeFiltro);
    }

    if (["ABIERTA", "EN_SEGUIMIENTO", "CERRADA"].includes(estadoFiltro)) {
      sql += " AND gt.estado = ?";
      params.push(estadoFiltro);
    }

    if (fechaDesde) {
      sql += " AND gt.fecha >= ?";
      params.push(fechaDesde);
    }

    if (fechaHasta) {
      sql += " AND gt.fecha <= ?";
      params.push(fechaHasta);
    }

    sql += " ORDER BY gt.fecha DESC, gt.id DESC";

    const [giras] = await pool.query(sql, params);
    const resumen = {
      total: giras.length,
      abiertas: giras.filter(g => g.estado === "ABIERTA").length,
      seguimiento: giras.filter(g => g.estado === "EN_SEGUIMIENTO").length,
      cerradas: giras.filter(g => g.estado === "CERRADA").length
    };

    res.render("giras_listado", {
      user: req.session.user,
      giras,
      resumen,
      sedesPermitidas,
      filtros: { sede: sedeFiltro, estado: estadoFiltro, fecha_desde: fechaDesde, fecha_hasta: fechaHasta },
      puedeEditar: puedeGestionar(req.session.user),
      etiquetaEstado
    });
  } catch (error) {
    console.error("ERROR listado giras:", error);
    res.status(500).send("Error interno");
  }
});

router.get("/nuevo", async (req, res) => {
  try {
    await ensureGirasTable();

    if (!puedeGestionar(req.session.user)) return res.redirect("/giras");

    res.render("giras_form", {
      user: req.session.user,
      sedesPermitidas: sedesPermitidasGiras(req),
      gira: null,
      hoy: new Date().toISOString().slice(0, 10)
    });
  } catch (error) {
    console.error("ERROR form gira:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/", async (req, res) => {
  try {
    await ensureGirasTable();

    if (!puedeGestionar(req.session.user)) return res.status(403).send("No autorizado");

    const sedesPermitidas = sedesPermitidasGiras(req);
    const sede = String(req.body.sede || "").trim();
    const fecha = String(req.body.fecha || "").trim();
    const inspector = String(req.body.inspector || "").trim();
    const observaciones = String(req.body.observaciones || "").trim();

    if (!sedesPermitidas.includes(sede)) return res.status(400).send("Debe seleccionar una sede válida.");
    if (!fecha) return res.status(400).send("Debe colocar la fecha de la gira.");
    if (!inspector) return res.status(400).send("Debe colocar quién realizó la inspección.");
    if (!observaciones) return res.status(400).send("Debe escribir las observaciones de la gira.");

    await pool.query(
      `
      INSERT INTO giras_taller
        (sede, fecha, inspector, estado, observaciones, pendientes, acciones_recomendadas, creado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        sede,
        fecha,
        inspector,
        estadoValido(req.body.estado),
        observaciones,
        req.body.pendientes || null,
        req.body.acciones_recomendadas || null,
        req.session.user.id
      ]
    );

    res.redirect("/giras");
  } catch (error) {
    console.error("ERROR guardar gira:", error);
    res.status(500).send("Error interno");
  }
});

router.get("/:id/editar", async (req, res) => {
  try {
    await ensureGirasTable();

    if (!puedeGestionar(req.session.user)) return res.redirect("/giras");

    const sedesPermitidas = sedesPermitidasGiras(req);
    const [[gira]] = await pool.query("SELECT * FROM giras_taller WHERE id = ? AND sede IN (?)", [req.params.id, sedesPermitidas]);
    if (!gira) return res.status(404).send("Gira no encontrada");

    res.render("giras_form", {
      user: req.session.user,
      sedesPermitidas,
      gira: { ...gira, fecha_input: fechaInput(gira.fecha) },
      hoy: new Date().toISOString().slice(0, 10)
    });
  } catch (error) {
    console.error("ERROR editar gira:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/:id/editar", async (req, res) => {
  try {
    await ensureGirasTable();

    if (!puedeGestionar(req.session.user)) return res.status(403).send("No autorizado");

    const sedesPermitidas = sedesPermitidasGiras(req);
    const sede = String(req.body.sede || "").trim();
    const fecha = String(req.body.fecha || "").trim();
    const inspector = String(req.body.inspector || "").trim();
    const observaciones = String(req.body.observaciones || "").trim();

    if (!sedesPermitidas.includes(sede)) return res.status(400).send("Debe seleccionar una sede válida.");
    if (!fecha) return res.status(400).send("Debe colocar la fecha de la gira.");
    if (!inspector) return res.status(400).send("Debe colocar quién realizó la inspección.");
    if (!observaciones) return res.status(400).send("Debe escribir las observaciones de la gira.");

    const [[gira]] = await pool.query("SELECT id FROM giras_taller WHERE id = ? AND sede IN (?)", [req.params.id, sedesPermitidas]);
    if (!gira) return res.status(404).send("Gira no encontrada");

    await pool.query(
      `
      UPDATE giras_taller
      SET sede = ?,
          fecha = ?,
          inspector = ?,
          estado = ?,
          observaciones = ?,
          pendientes = ?,
          acciones_recomendadas = ?
      WHERE id = ?
      `,
      [
        sede,
        fecha,
        inspector,
        estadoValido(req.body.estado),
        observaciones,
        req.body.pendientes || null,
        req.body.acciones_recomendadas || null,
        req.params.id
      ]
    );

    res.redirect("/giras");
  } catch (error) {
    console.error("ERROR actualizar gira:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/:id/eliminar", async (req, res) => {
  try {
    await ensureGirasTable();

    if (req.session.user.rol !== "ADMIN") return res.status(403).send("No autorizado");

    const sedesPermitidas = sedesPermitidasGiras(req);
    await pool.query("DELETE FROM giras_taller WHERE id = ? AND sede IN (?)", [req.params.id, sedesPermitidas]);
    res.redirect("/giras");
  } catch (error) {
    console.error("ERROR eliminar gira:", error);
    res.status(500).send("Error interno");
  }
});

module.exports = router;
