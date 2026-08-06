const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  agregarTallerParaMecanico,
  esSedeTransporte,
  esUsuarioTodasSedes,
  obtenerSedesTransporte
} = require("../utils/sedes");
const { agregarFiltroPlacaSql, normalizarPlaca } = require("../utils/placas");

const DB_CONNECTION_ERRORS = new Set(["ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "ECONNREFUSED"]);
const lastDbErrorLog = new Map();

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "No autorizado" });
  next();
}

async function sedesPermitidasUsuario(req) {
  const user = req.session.user;

  if (esUsuarioTodasSedes(user)) {
    if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
      return [req.session.sedeSeleccionada];
    }
    return [];
  }

  const esPesados = user.rol === "SUPERVISOR_PESADO" ||
    String(user.usuario || "").trim().toLowerCase() === "pesados";

  if (esPesados) {
    if (
      req.session.sedeSeleccionada &&
      req.session.sedeSeleccionada !== "TODAS" &&
      esSedeTransporte(req.session.sedeSeleccionada)
    ) {
      return [req.session.sedeSeleccionada];
    }
    return obtenerSedesTransporte(pool);
  }

  const [extras] = await pool.query(
    "SELECT sede FROM usuarios_sedes WHERE usuario_id = ?",
    [user.id]
  );
  const sedes = agregarTallerParaMecanico(user, [user.sede, ...extras.map(item => item.sede)]);

  if (req.session.sedeSeleccionada && sedes.includes(req.session.sedeSeleccionada)) {
    return [req.session.sedeSeleccionada];
  }

  return sedes;
}

function logDbSearchError(error) {
  const code = error.code || error.errno || "DB_ERROR";
  const now = Date.now();
  const last = lastDbErrorLog.get(code) || 0;

  if (DB_CONNECTION_ERRORS.has(code) && now - last < 30000) return;

  lastDbErrorLog.set(code, now);

  if (DB_CONNECTION_ERRORS.has(code)) {
    console.warn(`Buscador de placas sin conexión a MySQL (${code}).`);
    return;
  }

  console.error("Error buscando unidades:", error);
}

router.get("/unidades/buscar", requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json({ unidades: [] });

    const sedes = await sedesPermitidasUsuario(req);
    const condiciones = ["COALESCE(activa, 1) = 1", "placa IS NOT NULL", "TRIM(placa) <> ''"];
    const params = [];

    if (sedes.length) {
      condiciones.push("sede IN (?)");
      params.push(sedes);
    }

    agregarFiltroPlacaSql(condiciones, params, "placa", q);

    const [unidades] = await pool.query(
      `SELECT id, placa, sede
       FROM unidades
       WHERE ${condiciones.join(" AND ")}
       ORDER BY sede, placa
       LIMIT 20`,
      params
    );

    const placaNormalizada = normalizarPlaca(q);
    const ordenadas = placaNormalizada
      ? [...unidades].sort((a, b) => {
          const aExacta = String(a.placa || "").toUpperCase() === placaNormalizada ? 0 : 1;
          const bExacta = String(b.placa || "").toUpperCase() === placaNormalizada ? 0 : 1;
          return aExacta - bExacta;
        })
      : unidades;

    res.json({ unidades: ordenadas });
  } catch (error) {
    logDbSearchError(error);
    const status = DB_CONNECTION_ERRORS.has(error.code) ? 503 : 500;
    res.status(status).json({ unidades: [], error: "No se pudo buscar unidades" });
  }
});

module.exports = router;
