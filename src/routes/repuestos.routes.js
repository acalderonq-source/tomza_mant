const express = require("express");
const router = express.Router();
const pool = require("../db");
const { getSedesPermitidas } = require("../utils/sedes");
const {
  ESTADOS_REPUESTOS,
  PRIORIDADES_REPUESTOS,
  ensureRepuestosSolicitudesTable,
  etiquetaEstadoRepuesto,
  etiquetaPrioridadRepuesto,
  normalizarEstado,
  normalizarPlaca,
  normalizarPrioridad
} = require("../utils/repuestosSolicitudes");

const ROLES_VER_REPUESTOS = ["ADMIN", "TALLER", "PROVEEDURIA_TALLER"];
const ROLES_GESTION_REPUESTOS = ["ADMIN", "PROVEEDURIA_TALLER"];

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireVerRepuestos(req, res, next) {
  if (!ROLES_VER_REPUESTOS.includes(req.session.user.rol)) {
    return res.status(403).send("No autorizado");
  }
  next();
}

function requireGestionRepuestos(req, res, next) {
  if (!ROLES_GESTION_REPUESTOS.includes(req.session.user.rol)) {
    return res.status(403).send("No autorizado");
  }
  next();
}

function fechaCostaRica(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function redirectConFiltros(req, res) {
  const params = new URLSearchParams();
  ["sede", "placa"].forEach(key => {
    const value = String(req.body[key] || req.query[key] || "").trim();
    if (value) params.set(key, value);
  });
  const estado = String(req.body.estado_filtro || req.body.estado || req.query.estado || "").trim();
  if (estado) params.set("estado", estado);
  res.redirect(`/repuestos${params.toString() ? `?${params.toString()}` : ""}`);
}

function sedesDisponibles(req) {
  const sedes = getSedesPermitidas(req);
  return [...new Set(sedes.filter(Boolean))];
}

async function obtenerProveedorSeleccionado(proveedorId) {
  if (!proveedorId) return { id: null, nombre: null };
  const [[proveedor]] = await pool.query("SELECT id, nombre FROM proveedores WHERE id = ?", [proveedorId]);
  return proveedor ? { id: proveedor.id, nombre: proveedor.nombre } : { id: null, nombre: null };
}

router.use(requireAuth);
router.use(requireVerRepuestos);

router.get("/", async (req, res) => {
  try {
    await ensureRepuestosSolicitudesTable(pool);

    const sedes = sedesDisponibles(req);
    const sedeFiltro = String(req.query.sede || "").trim();
    const estadoFiltro = String(req.query.estado || "").trim().toUpperCase();
    const placaFiltro = normalizarPlaca(req.query.placa);

    const condiciones = ["1=1"];
    const params = [];

    if (sedeFiltro && sedes.includes(sedeFiltro)) {
      condiciones.push("sr.sede = ?");
      params.push(sedeFiltro);
    } else if (sedes.length) {
      condiciones.push("sr.sede IN (?)");
      params.push(sedes);
    }

    if (ESTADOS_REPUESTOS.includes(estadoFiltro)) {
      condiciones.push("sr.estado = ?");
      params.push(estadoFiltro);
    }

    if (placaFiltro) {
      condiciones.push("sr.placa LIKE ?");
      params.push(`%${placaFiltro}%`);
    }

    const [solicitudes] = await pool.query(
      `SELECT
         sr.*,
         DATE_FORMAT(sr.fecha_solicitud, '%d/%m/%Y') AS fecha_formato,
         u.usuario AS creado_por_usuario,
         COALESCE(p.nombre, sr.proveedor) AS proveedor_nombre
       FROM solicitudes_repuestos sr
       LEFT JOIN usuarios u ON u.id = sr.creado_por
       LEFT JOIN proveedores p ON p.id = sr.proveedor_id
       WHERE ${condiciones.join(" AND ")}
       ORDER BY
         CASE sr.estado
           WHEN 'PENDIENTE_COMPRAR' THEN 1
           WHEN 'PEDIDO' THEN 2
           WHEN 'EN_TRANSITO' THEN 3
           WHEN 'ENTREGADO' THEN 4
           ELSE 5
         END,
         CASE sr.prioridad WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END,
         sr.fecha_solicitud DESC,
         sr.id DESC`,
      params
    );

    const [unidades] = await pool.query(
      `SELECT id, placa, sede
       FROM unidades
       WHERE placa IS NOT NULL
         AND placa <> ''
         ${sedes.length ? "AND sede IN (?)" : ""}
       ORDER BY sede, placa`,
      sedes.length ? [sedes] : []
    );

    const [proveedores] = await pool.query("SELECT id, nombre FROM proveedores ORDER BY nombre");

    const resumen = solicitudes.reduce((acc, item) => {
      acc.total += 1;
      acc[item.estado] = (acc[item.estado] || 0) + 1;
      return acc;
    }, { total: 0 });

    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("repuestos_solicitudes", {
      user: req.session.user,
      solicitudes,
      sedes,
      unidades,
      proveedores,
      filtros: { sede: sedeFiltro, estado: estadoFiltro, placa: placaFiltro },
      estados: ESTADOS_REPUESTOS,
      prioridades: PRIORIDADES_REPUESTOS,
      puedeGestionar: ROLES_GESTION_REPUESTOS.includes(req.session.user.rol),
      fechaHoy: fechaCostaRica(),
      resumen,
      success,
      error,
      etiquetaEstadoRepuesto,
      etiquetaPrioridadRepuesto
    });
  } catch (error) {
    console.error("Error cargando solicitud de repuestos:", error);
    res.status(500).send("Error cargando solicitud de repuestos");
  }
});

router.post("/", requireGestionRepuestos, async (req, res) => {
  try {
    await ensureRepuestosSolicitudesTable(pool);

    const sedes = sedesDisponibles(req);
    const fecha = req.body.fecha_solicitud || fechaCostaRica();
    const placa = normalizarPlaca(req.body.placa);
    const solicitadoPor = String(req.body.solicitado_por || req.session.user.usuario || "").trim();
    const repuesto = String(req.body.repuesto_solicitado || "").trim();
    const cantidad = Number(req.body.cantidad || 1);
    const prioridad = normalizarPrioridad(req.body.prioridad);
    const estado = normalizarEstado(req.body.estado);
    const proveedorSeleccionado = await obtenerProveedorSeleccionado(req.body.proveedor_id);

    if (!fecha || !placa || !solicitadoPor || !repuesto || !Number.isFinite(cantidad) || cantidad <= 0) {
      req.session.error = "Complete fecha, placa, solicitado por, repuesto y cantidad.";
      return redirectConFiltros(req, res);
    }

    const [[unidad]] = await pool.query(
      `SELECT placa, sede
       FROM unidades
       WHERE UPPER(TRIM(placa)) = ?
         ${sedes.length ? "AND sede IN (?)" : ""}
       LIMIT 1`,
      sedes.length ? [placa, sedes] : [placa]
    );

    if (!unidad) {
      req.session.error = "Seleccione una placa válida de las unidades permitidas.";
      return redirectConFiltros(req, res);
    }

    await pool.query(
      `INSERT INTO solicitudes_repuestos
        (fecha_solicitud, sede, placa, solicitado_por, repuesto_solicitado, cantidad, prioridad, estado, proveedor_id, proveedor, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fecha,
        unidad.sede,
        unidad.placa,
        solicitadoPor,
        repuesto,
        cantidad,
        prioridad,
        estado,
        proveedorSeleccionado.id,
        proveedorSeleccionado.nombre,
        req.session.user.id || null
      ]
    );

    req.session.success = `Solicitud de repuesto guardada para ${unidad.placa}.`;
    redirectConFiltros(req, res);
  } catch (error) {
    console.error("Error guardando solicitud de repuesto:", error);
    req.session.error = "Error guardando solicitud de repuesto.";
    redirectConFiltros(req, res);
  }
});

router.post("/:id/estado", requireGestionRepuestos, async (req, res) => {
  try {
    await ensureRepuestosSolicitudesTable(pool);

    const id = req.params.id;
    const estado = normalizarEstado(req.body.estado);
    const proveedorSeleccionado = await obtenerProveedorSeleccionado(req.body.proveedor_id);
    const sedes = sedesDisponibles(req);

    const [result] = await pool.query(
      `UPDATE solicitudes_repuestos
       SET estado = ?, proveedor_id = ?, proveedor = ?
       WHERE id = ? AND sede IN (?)`,
      [estado, proveedorSeleccionado.id, proveedorSeleccionado.nombre, id, sedes]
    );

    req.session[result.affectedRows ? "success" : "error"] = result.affectedRows
      ? "Solicitud actualizada."
      : "Solicitud no encontrada o sin permiso para esa sede.";
    redirectConFiltros(req, res);
  } catch (error) {
    console.error("Error actualizando solicitud de repuesto:", error);
    req.session.error = "Error actualizando solicitud.";
    redirectConFiltros(req, res);
  }
});

router.post("/:id/eliminar", requireGestionRepuestos, async (req, res) => {
  try {
    await ensureRepuestosSolicitudesTable(pool);
    const sedes = sedesDisponibles(req);
    const [result] = await pool.query(
      "DELETE FROM solicitudes_repuestos WHERE id = ? AND sede IN (?)",
      [req.params.id, sedes]
    );
    req.session[result.affectedRows ? "success" : "error"] = result.affectedRows
      ? "Solicitud eliminada."
      : "Solicitud no encontrada o sin permiso.";
    redirectConFiltros(req, res);
  } catch (error) {
    console.error("Error eliminando solicitud de repuesto:", error);
    req.session.error = "Error eliminando solicitud.";
    redirectConFiltros(req, res);
  }
});

module.exports = router;
