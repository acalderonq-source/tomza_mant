const express = require("express");
const router = express.Router();
const pool = require("../db");

const ROLES_OFICINA_DIA_DIA = ["ADMIN", "TALLER", "PROVEEDURIA_TALLER"];
const SEDES_TRANSPORTE = ["Transportadora", "Granel"];
const PERSONAS_OFICINA = [
  "Emily Fernandez Mora",
  "Michelle Ramirez",
  "Daniel Martinez",
  "Alexandro Calderon"
];

function fechaCostaRica(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireOficina(req, res, next) {
  if (!ROLES_OFICINA_DIA_DIA.includes(req.session.user.rol)) {
    return res.status(403).send("No autorizado");
  }
  next();
}

function expandirSedeFiltro(sede) {
  if (!sede) return [];
  if (SEDES_TRANSPORTE.includes(sede)) return SEDES_TRANSPORTE;
  return [sede];
}

function etiquetaSede(sede) {
  if (!sede) return "TODAS";
  if (SEDES_TRANSPORTE.includes(sede)) return "Transportadora + Granel";
  return sede;
}

async function ensureOficinaDiaDiaTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oficina_dia_dia (
      id INT AUTO_INCREMENT PRIMARY KEY,
      fecha DATE NOT NULL,
      nombre_persona VARCHAR(150) NOT NULL,
      actividad TEXT NOT NULL,
      sede VARCHAR(100) NULL,
      creado_por INT NULL,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_oficina_fecha (fecha),
      INDEX idx_oficina_sede (sede)
    )
  `);
}

async function obtenerSedesUsuario(req) {
  const user = req.session.user;
  const [extras] = await pool.query("SELECT sede FROM usuarios_sedes WHERE usuario_id = ?", [user.id]);
  const sedesPermitidas = [...new Set([user.sede, ...extras.map(e => e.sede)].filter(Boolean))];

  if (user.rol === "ADMIN") {
    const seleccionada = req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS"
      ? req.session.sedeSeleccionada
      : null;
    return {
      sedeFiltro: seleccionada,
      sedesFiltro: expandirSedeFiltro(seleccionada),
      sedeVista: etiquetaSede(seleccionada)
    };
  }

  const sedeFiltro = req.session.sedeSeleccionada && sedesPermitidas.includes(req.session.sedeSeleccionada)
    ? req.session.sedeSeleccionada
    : user.sede;

  return {
    sedeFiltro,
    sedesFiltro: expandirSedeFiltro(sedeFiltro),
    sedeVista: etiquetaSede(sedeFiltro)
  };
}

router.get("/", requireAuth, requireOficina, async (req, res) => {
  try {
    await ensureOficinaDiaDiaTable();

    const { sedesFiltro, sedeVista } = await obtenerSedesUsuario(req);
    const condiciones = ["1=1"];
    const params = [];

    if (sedesFiltro.length) {
      condiciones.push("(od.sede IN (?) OR od.sede IS NULL)");
      params.push(sedesFiltro);
    }

    const [registros] = await pool.query(
      `SELECT
         od.id,
         od.fecha,
         DATE_FORMAT(od.fecha, '%d/%m/%Y') AS fecha_formato,
         od.nombre_persona,
         od.actividad,
         od.sede,
         od.creado_en,
         u.usuario AS registrado_por
       FROM oficina_dia_dia od
       LEFT JOIN usuarios u ON u.id = od.creado_por
       WHERE ${condiciones.join(" AND ")}
       ORDER BY od.fecha DESC, od.creado_en DESC, od.id DESC
       LIMIT 80`,
      params
    );

    res.render("oficina_dia_dia", {
      user: req.session.user,
      registros,
      personasOficina: PERSONAS_OFICINA,
      fechaHoy: fechaCostaRica(),
      sedeActual: sedeVista,
      error: req.query.error === "1"
    });
  } catch (error) {
    console.error("Error cargando oficina día a día:", error);
    res.status(500).send("Error cargando oficina día a día");
  }
});

router.post("/", requireAuth, requireOficina, async (req, res) => {
  try {
    await ensureOficinaDiaDiaTable();

    const nombre = String(req.body.nombre_persona || "").trim();
    const actividad = String(req.body.actividad || "").trim();
    const fecha = req.body.fecha || fechaCostaRica();
    const { sedeFiltro } = await obtenerSedesUsuario(req);
    const sede = sedeFiltro || req.session.user.sede || null;

    if (!nombre || !actividad || !PERSONAS_OFICINA.includes(nombre)) {
      return res.redirect("/oficina-dia-dia?error=1");
    }

    await pool.query(
      `INSERT INTO oficina_dia_dia (fecha, nombre_persona, actividad, sede, creado_por)
       VALUES (?, ?, ?, ?, ?)`,
      [fecha, nombre, actividad, sede, req.session.user.id || null]
    );

    res.redirect("/oficina-dia-dia");
  } catch (error) {
    console.error("Error guardando oficina día a día:", error);
    res.status(500).send("Error guardando oficina día a día");
  }
});

router.post("/:id/eliminar", requireAuth, requireOficina, async (req, res) => {
  try {
    await ensureOficinaDiaDiaTable();
    await pool.query("DELETE FROM oficina_dia_dia WHERE id = ?", [req.params.id]);
    res.redirect("/oficina-dia-dia");
  } catch (error) {
    console.error("Error eliminando oficina día a día:", error);
    res.status(500).send("Error eliminando registro");
  }
});

module.exports = router;
