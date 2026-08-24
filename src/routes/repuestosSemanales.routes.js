const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  etiquetaSede,
  getSedesPermitidas,
  obtenerTodasSedes,
  obtenerSedesTransporte
} = require("../utils/sedes");
const {
  ESTADOS_REPUESTOS_SEMANALES,
  ensureRepuestosSemanalesTable,
  etiquetaEstadoSemanal,
  normalizarEstadoSemanal
} = require("../utils/repuestosSemanales");
const { normalizarPlaca: normalizarPlacaSistema, agregarFiltroPlacaSql } = require("../utils/placas");
const { generarPdfPedidoCedis, dividirRepuestosSeleccionables } = require("../utils/pdfPedidoCedis");

const ROLES_PROVEEDURIA = ["PROVEEDURIA_TALLER", "PROVEEDURIA"];
const ROLES_VER = ["ADMIN", "TALLER", "MECANICO", "SUPERVISOR_PESADO", ...ROLES_PROVEEDURIA];
const ROLES_GESTION = ["ADMIN", "TALLER", ...ROLES_PROVEEDURIA];
const SEDE_RECOPE_LIMON = "RECOPE_LIMON";
const SEDE_RECOPE_UNIDADES = "Transportadora";
const GRUPOS_RECOPE_LIMON = new Set(["GENERALES-LIMON", "MUEBLE-LIMON"]);

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function esUsuarioPesado(user) {
  return user && (
    user.rol === "SUPERVISOR_PESADO" ||
    String(user.usuario || "").trim().toLowerCase() === "pesados"
  );
}

function unirLista(...listas) {
  return [...new Set(
    listas
      .flat()
      .map(item => String(item || "").trim())
      .filter(Boolean)
  )];
}

function esSedeRecopeLimon(sede) {
  return String(sede || "").trim().toUpperCase() === SEDE_RECOPE_LIMON;
}

function etiquetaSedePedido(sede) {
  if (esSedeRecopeLimon(sede)) return "RECOPE_LIMON";
  return etiquetaSede(sede);
}

function incluirRecopeLimonSiAplica(sedes) {
  const lista = unirLista(sedes);
  return lista.includes(SEDE_RECOPE_UNIDADES)
    ? unirLista(lista, [SEDE_RECOPE_LIMON])
    : lista;
}

function sedesParaBuscarUnidades(sedes) {
  const lista = unirLista(sedes);
  return lista.includes(SEDE_RECOPE_LIMON)
    ? unirLista(lista, [SEDE_RECOPE_UNIDADES])
    : lista;
}

function sedeDestinoPedido(sedeUnidad, sedeFallback = "") {
  if (esSedeRecopeLimon(sedeFallback) && sedeUnidad === SEDE_RECOPE_UNIDADES) {
    return SEDE_RECOPE_LIMON;
  }
  return sedeUnidad;
}

function requireVer(req, res, next) {
  if (ROLES_VER.includes(req.session.user.rol) || esUsuarioPesado(req.session.user)) return next();
  return res.status(403).send("No autorizado");
}

function requireGestion(req, res, next) {
  if (ROLES_GESTION.includes(req.session.user.rol)) return next();
  return res.status(403).send("No autorizado");
}

function fechaCostaRica(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function inicioSemanaCostaRica() {
  const hoy = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Costa_Rica" }));
  hoy.setHours(12, 0, 0, 0);
  const dia = hoy.getDay() || 7;
  hoy.setDate(hoy.getDate() - dia + 1);
  return fechaCostaRica(hoy);
}

function proximaSemanaCostaRica() {
  const hoy = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Costa_Rica" }));
  hoy.setHours(12, 0, 0, 0);
  const dia = hoy.getDay() || 7;
  hoy.setDate(hoy.getDate() - dia + 8);
  return fechaCostaRica(hoy);
}

function limpiarPlacaLibre(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  if (/\d/.test(raw)) return normalizarPlacaSistema(raw) || raw.replace(/\s+/g, " ");
  return raw.replace(/\s+/g, " ");
}

function normalizarArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizarIds(value) {
  return normalizarArray(value)
    .map(id => parseInt(id, 10))
    .filter(Number.isInteger);
}

function textoLista(value) {
  return normalizarArray(value)
    .map(item => String(item || "").trim())
    .filter(Boolean)
    .join("\n");
}

function textoGuardadoASet(value) {
  return new Set(
    String(value || "")
      .split(/\r?\n|,+/g)
      .map(item => textoComparable(item))
      .filter(Boolean)
  );
}

function normalizarPedidoItems(value) {
  return normalizarArray(value)
    .map(raw => {
      const [idRaw, indexRaw] = String(raw || "").split(":");
      const id = parseInt(idRaw, 10);
      const index = parseInt(indexRaw, 10);
      if (!Number.isInteger(id) || !Number.isInteger(index) || index < 0) return null;
      return { id, index };
    })
    .filter(Boolean);
}

function prepararSolicitudesPedidoPorItems(solicitudes, pedidoItems) {
  const itemsPorSolicitud = new Map();
  pedidoItems.forEach(item => {
    if (!itemsPorSolicitud.has(item.id)) itemsPorSolicitud.set(item.id, new Set());
    itemsPorSolicitud.get(item.id).add(item.index);
  });

  return solicitudes
    .filter(solicitud => solicitud.estado !== "NO_COMPRA")
    .flatMap(solicitud => {
    const indices = itemsPorSolicitud.get(Number(solicitud.id));
    if (pedidoItems.length && !indices) return [];

    const noCompra = textoGuardadoASet(solicitud.no_compra);
    const partes = dividirRepuestosSeleccionables(solicitud);
    return partes
      .map((parte, index) => ({ parte, index }))
      .filter(({ parte, index }) => (!pedidoItems.length || indices.has(index)) && !noCompra.has(textoComparable(parte)))
      .map(({ parte, index }) => ({
        ...solicitud,
        solicitud: parte,
        marcado_rojo: null,
        cantidad: index === 0 ? solicitud.cantidad : "",
        _pedido_item_index: index
      }));
  });
}

function redirectConFiltros(req, res) {
  const params = new URLSearchParams();
  ["fecha", "sede", "placa", "estado"].forEach(key => {
    const value = String(req.body[key] || req.query[key] || "").trim();
    if (value) params.set(key, value);
  });
  res.redirect(`/repuestos-semanales${params.toString() ? `?${params.toString()}` : ""}`);
}

function fechaValida(value, fallback = proximaSemanaCostaRica()) {
  const fecha = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : fallback;
}

function textoComparable(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s]+/g, "-");
}

function esGrupoRecopeLimon(value) {
  return GRUPOS_RECOPE_LIMON.has(textoComparable(value));
}

function excluirDePedidoCedis(item) {
  const placa = textoComparable(item.placa);
  const sede = textoComparable(item.sede);
  const solicitud = textoComparable(item.solicitud);
  const marcado = textoComparable(item.marcado_rojo);
  const noCompra = textoComparable(item.no_compra);
  const excluidos = new Set(["MUEBLE", "GENERAL-TALLER", "GENERALES-TALLER"]);

  return item.estado === "NO_COMPRA" ||
    excluidos.has(placa) ||
    excluidos.has(sede) ||
    solicitud.includes("GENERAL-TALLER") ||
    solicitud.includes("GENERALES-TALLER") ||
    solicitud.includes("MUEBLE") ||
    marcado.includes("GENERAL-TALLER") ||
    marcado.includes("GENERALES-TALLER") ||
    marcado.includes("MUEBLE") ||
    noCompra.includes("GENERAL-TALLER") ||
    noCompra.includes("GENERALES-TALLER") ||
    noCompra.includes("MUEBLE");
}

async function sedesDisponibles(req) {
  if (["ADMIN", "TALLER"].includes(req.session.user.rol) || ROLES_PROVEEDURIA.includes(req.session.user.rol)) {
    return incluirRecopeLimonSiAplica(await obtenerTodasSedes(pool));
  }

  if (esUsuarioPesado(req.session.user)) {
    return incluirRecopeLimonSiAplica(await obtenerSedesTransporte(pool));
  }

  const sedes = getSedesPermitidas(req);
  return incluirRecopeLimonSiAplica(sedes);
}

async function resolverSedePorPlaca(req, placa, sedeFallback = "") {
  const sedes = await sedesDisponibles(req);
  const placaLimpia = limpiarPlacaLibre(placa);

  if (!placaLimpia) {
    return { error: "Digite la placa o el grupo.", sedes };
  }

  if (/\d/.test(placaLimpia)) {
    const params = [placaLimpia];
    const filtros = ["UPPER(TRIM(placa)) = ?"];
    const sedesUnidades = sedesParaBuscarUnidades(sedes);

    if (sedesUnidades.length) {
      filtros.push("sede IN (?)");
      params.push(sedesUnidades);
    }

    const [unidades] = await pool.query(
      `SELECT placa, sede
       FROM unidades
       WHERE ${filtros.join(" AND ")}
       LIMIT 1`,
      params
    );

    if (!unidades.length) {
      return { error: "Seleccione una placa válida de la lista para colocar la sede automáticamente.", sedes };
    }

    return {
      placa: unidades[0].placa,
      sede: sedeDestinoPedido(unidades[0].sede, sedeFallback),
      sedes
    };
  }

  const sede = String(sedeFallback || "").trim();
  if (esGrupoRecopeLimon(placaLimpia)) {
    if (sedes.length && !sedes.includes(SEDE_RECOPE_LIMON)) {
      return {
        error: "Su usuario no tiene acceso a RECOPE_LIMON.",
        sedes
      };
    }

    return { placa: textoComparable(placaLimpia), sede: SEDE_RECOPE_LIMON, sedes };
  }

  if (!sede || (sedes.length && !sedes.includes(sede))) {
    return {
      error: "Para grupos como GENERALES, MUEBLE o LLANTAS, primero filtre una sede para asignarla automáticamente. GENERALES-LIMON y MUEBLE-LIMON van directo a RECOPE_LIMON.",
      sedes
    };
  }

  return { placa: placaLimpia, sede, sedes };
}

async function obtenerSolicitudesFiltradas(req) {
  const sedes = await sedesDisponibles(req);
  const fechaFiltro = String(req.query.fecha || proximaSemanaCostaRica()).trim();
  const sedeFiltro = String(req.query.sede || "").trim();
  const placaFiltro = limpiarPlacaLibre(req.query.placa);
  const estadoFiltro = normalizarEstadoSemanal(req.query.estado);
  const estadoRaw = String(req.query.estado || "").trim().toUpperCase();
  const ids = normalizarIds(req.query.solicitud_ids);

  const condiciones = ["1=1"];
  const params = [];

  if (ids.length) {
    condiciones.push("rs.id IN (?)");
    params.push(ids);
  }

  if (fechaFiltro) {
    condiciones.push("rs.fecha = ?");
    params.push(fechaFiltro);
  }

  if (sedeFiltro && sedes.includes(sedeFiltro)) {
    condiciones.push("rs.sede = ?");
    params.push(sedeFiltro);
  } else if (sedes.length) {
    condiciones.push("rs.sede IN (?)");
    params.push(sedes);
  }

  if (estadoRaw && ESTADOS_REPUESTOS_SEMANALES.includes(estadoFiltro)) {
    condiciones.push("rs.estado = ?");
    params.push(estadoFiltro);
  }

  if (placaFiltro) {
    const placaConditions = [];
    agregarFiltroPlacaSql(placaConditions, params, "rs.placa", placaFiltro);
    if (placaConditions.length) {
      condiciones.push(`(${placaConditions[0]} OR UPPER(rs.placa) LIKE ?)`);
      params.push(`%${placaFiltro}%`);
    } else {
      condiciones.push("UPPER(rs.placa) LIKE ?");
      params.push(`%${placaFiltro}%`);
    }
  }

  const [solicitudes] = await pool.query(
    `SELECT
       rs.*,
       DATE_FORMAT(rs.fecha, '%d/%m/%Y') AS fecha_formato,
       DATE_FORMAT(rs.fecha, '%Y-%m-%d') AS fecha_iso,
       u.usuario AS creado_por_usuario
     FROM repuestos_semanales rs
     LEFT JOIN usuarios u ON u.id = rs.creado_por
     WHERE ${condiciones.join(" AND ")}
     ORDER BY rs.fecha DESC, rs.sede ASC, rs.placa ASC, rs.id ASC`,
    params
  );

  return {
    sedes,
    solicitudes,
    filtros: { fecha: fechaFiltro, sede: sedeFiltro, placa: placaFiltro, estado: estadoRaw }
  };
}

function agruparParaPedido(solicitudes) {
  const grupos = new Map();

  solicitudes.filter(item => !excluirDePedidoCedis(item)).forEach(item => {
    const key = `${item.fecha_iso || item.fecha}|${item.sede}`;
    if (!grupos.has(key)) {
      grupos.set(key, {
        fecha: item.fecha_iso || item.fecha,
        sede: item.sede,
        items: []
      });
    }
    grupos.get(key).items.push(item);
  });

  return [...grupos.values()];
}

router.use(requireAuth);
router.use(requireVer);

router.get("/", async (req, res) => {
  try {
    await ensureRepuestosSemanalesTable(pool);

    const { sedes, solicitudes, filtros } = await obtenerSolicitudesFiltradas(req);

    const sedesUnidades = sedesParaBuscarUnidades(sedes);
    const [unidades] = await pool.query(
      `SELECT id, placa, sede
       FROM unidades
       WHERE placa IS NOT NULL
         AND placa <> ''
         ${sedesUnidades.length ? "AND sede IN (?)" : ""}
       ORDER BY sede, placa`,
      sedesUnidades.length ? [sedesUnidades] : []
    );

    const resumen = solicitudes.reduce((acc, item) => {
      acc.total += 1;
      acc[item.estado] = (acc[item.estado] || 0) + 1;
      if (String(item.marcado_rojo || "").trim()) acc.marcados += 1;
      if (String(item.no_compra || "").trim()) acc.noCompraItems += 1;
      return acc;
    }, { total: 0, marcados: 0, noCompraItems: 0 });

    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("repuestos_semanales", {
      user: req.session.user,
      solicitudes,
      sedes,
      unidades,
      filtros,
      estados: ESTADOS_REPUESTOS_SEMANALES,
      resumen,
      fechaHoy: fechaCostaRica(),
      fechaProximaSemana: proximaSemanaCostaRica(),
      puedeGestionar: ROLES_GESTION.includes(req.session.user.rol),
      etiquetaEstadoSemanal,
      etiquetaSede: etiquetaSedePedido,
      sedeRecopeLimon: SEDE_RECOPE_LIMON,
      sedeRecopeUnidades: SEDE_RECOPE_UNIDADES,
      dividirRepuestosSeleccionables,
      success,
      error
    });
  } catch (error) {
    console.error("Error cargando repuestos semanales:", error);
    res.status(500).send("Error cargando repuestos semanales");
  }
});

router.get("/pedido-cedis.pdf", async (req, res) => {
  try {
    await ensureRepuestosSemanalesTable(pool);

    const pedidoItems = normalizarPedidoItems(req.query.pedido_items);
    if (pedidoItems.length) {
      req.query.solicitud_ids = [...new Set(pedidoItems.map(item => item.id))];
    }

    const { solicitudes, filtros } = await obtenerSolicitudesFiltradas(req);
    const solicitudesPedido = prepararSolicitudesPedidoPorItems(solicitudes, pedidoItems);
    const grupos = agruparParaPedido(solicitudesPedido);

    if (!grupos.length) {
      return res.status(404).send("No hay datos para generar el pedido.");
    }

    const pdfBuffer = await generarPdfPedidoCedis(grupos);
    const sedeNombre = filtros.sede ? filtros.sede.replace(/\s+/g, "_") : "todas";
    const fechaNombre = filtros.fecha || fechaCostaRica();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"pedido_cedis_${sedeNombre}_${fechaNombre}.pdf\"`
    );
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Error generando pedido CEDIS:", error);
    res.status(500).send("Error generando pedido CEDIS");
  }
});

router.post("/", requireGestion, async (req, res) => {
  try {
    await ensureRepuestosSemanalesTable(pool);

    const fecha = fechaValida(req.body.fecha);
    const sedeFallback = String(req.body.sede || req.query.sede || "").trim();
    const sedeResuelta = await resolverSedePorPlaca(req, req.body.placa, sedeFallback);
    const solicitud = String(req.body.solicitud || "").trim();
    const marcadoRojo = String(req.body.marcado_rojo || "").trim();
    const noCompra = String(req.body.no_compra || "").trim();
    const estado = noCompra ? "NO_COMPRA" : marcadoRojo ? "LLEGANDO" : normalizarEstadoSemanal(req.body.estado);

    if (sedeResuelta.error || !solicitud) {
      req.session.error = sedeResuelta.error || "Complete la solicitud del repuesto.";
      return redirectConFiltros(req, res);
    }

    const { placa, sede } = sedeResuelta;

    await pool.query(
      `INSERT INTO repuestos_semanales
       (fecha, sede, placa, solicitud, marcado_rojo, no_compra, estado, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [fecha, sede, placa, solicitud, marcadoRojo || null, noCompra || null, estado, req.session.user.id || null]
    );

    req.session.success = `Repuesto semanal guardado para ${placa}.`;
    res.redirect(`/repuestos-semanales?fecha=${encodeURIComponent(fecha)}&sede=${encodeURIComponent(sede)}`);
  } catch (error) {
    console.error("Error guardando repuesto semanal:", error);
    req.session.error = "Error guardando repuesto semanal.";
    redirectConFiltros(req, res);
  }
});

router.post("/:id/editar", requireGestion, async (req, res) => {
  try {
    await ensureRepuestosSemanalesTable(pool);

    const sedes = await sedesDisponibles(req);
    const [actuales] = await pool.query(
      `SELECT *,
              DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha_iso
       FROM repuestos_semanales
       WHERE id = ? ${sedes.length ? "AND sede IN (?)" : ""}
       LIMIT 1`,
      sedes.length ? [req.params.id, sedes] : [req.params.id]
    );

    if (!actuales.length) {
      req.session.error = "Registro no encontrado o sin permiso.";
      return redirectConFiltros(req, res);
    }

    const actual = actuales[0];
    const fecha = fechaValida(req.body.fecha, actual.fecha_iso || proximaSemanaCostaRica());
    const sedeFallback = String(req.body.sede || actual.sede || req.query.sede || "").trim();
    const sedeResuelta = await resolverSedePorPlaca(req, req.body.placa, sedeFallback);
    const solicitud = String(req.body.solicitud || "").trim();
    const marcadoRojo = req.body.marcado_rojo === undefined
      ? String(actual.marcado_rojo || "").trim()
      : String(req.body.marcado_rojo || "").trim();
    const noCompra = req.body.no_compra === undefined
      ? String(actual.no_compra || "").trim()
      : String(req.body.no_compra || "").trim();
    const estado = noCompra ? "NO_COMPRA" : normalizarEstadoSemanal(req.body.estado || actual.estado);

    if (sedeResuelta.error || !solicitud) {
      req.session.error = sedeResuelta.error || "Complete la solicitud del repuesto.";
      return redirectConFiltros(req, res);
    }

    await pool.query(
      `UPDATE repuestos_semanales
       SET fecha = ?,
           sede = ?,
           placa = ?,
           solicitud = ?,
           marcado_rojo = ?,
           no_compra = ?,
           estado = ?
       WHERE id = ?`,
      [fecha, sedeResuelta.sede, sedeResuelta.placa, solicitud, marcadoRojo || null, noCompra || null, estado, req.params.id]
    );

    req.session.success = "Repuesto semanal actualizado.";
    res.redirect(`/repuestos-semanales?fecha=${encodeURIComponent(fecha)}&sede=${encodeURIComponent(sedeResuelta.sede)}`);
  } catch (error) {
    console.error("Error editando repuesto semanal:", error);
    req.session.error = "Error editando repuesto semanal.";
    redirectConFiltros(req, res);
  }
});

router.post("/:id/marcado", requireGestion, async (req, res) => {
  try {
    await ensureRepuestosSemanalesTable(pool);

    const sedes = await sedesDisponibles(req);
    const marcadoRojo = textoLista(req.body.marcado_rojo_items || req.body.marcado_rojo);
    const noCompra = textoLista(req.body.no_compra_items || req.body.no_compra);
    const [actuales] = await pool.query(
      `SELECT solicitud
       FROM repuestos_semanales
       WHERE id = ? AND sede IN (?) AND estado <> 'COMPLETO'
       LIMIT 1`,
      [req.params.id, sedes]
    );

    const noCompraSet = textoGuardadoASet(noCompra);
    const partes = actuales.length ? dividirRepuestosSeleccionables(actuales[0]) : [];
    const todoNoCompra = partes.length > 0 && partes.every(parte => noCompraSet.has(textoComparable(parte)));
    const estado = todoNoCompra ? "NO_COMPRA" : marcadoRojo ? "LLEGANDO" : "PENDIENTE";
    const [result] = await pool.query(
      `UPDATE repuestos_semanales
       SET marcado_rojo = ?,
           no_compra = ?,
           estado = CASE WHEN estado = 'COMPLETO' THEN estado ELSE ? END
       WHERE id = ? AND sede IN (?) AND estado <> 'COMPLETO'`,
      [marcadoRojo || null, noCompra || null, estado, req.params.id, sedes]
    );

    req.session[result.affectedRows ? "success" : "error"] = result.affectedRows
      ? "Marcado rojo actualizado."
      : "Registro no encontrado, sin permiso o ya completo.";
    redirectConFiltros(req, res);
  } catch (error) {
    console.error("Error actualizando marcado semanal:", error);
    req.session.error = "Error actualizando el marcado.";
    redirectConFiltros(req, res);
  }
});

router.post("/:id/estado", requireGestion, async (req, res) => {
  try {
    await ensureRepuestosSemanalesTable(pool);

    const sedes = await sedesDisponibles(req);
    const estado = normalizarEstadoSemanal(req.body.estado);
    const [result] = await pool.query(
      "UPDATE repuestos_semanales SET estado = ? WHERE id = ? AND sede IN (?)",
      [estado, req.params.id, sedes]
    );

    req.session[result.affectedRows ? "success" : "error"] = result.affectedRows
      ? "Estado actualizado."
      : "Registro no encontrado o sin permiso.";
    redirectConFiltros(req, res);
  } catch (error) {
    console.error("Error actualizando estado semanal:", error);
    req.session.error = "Error actualizando estado.";
    redirectConFiltros(req, res);
  }
});

router.post("/:id/eliminar", requireGestion, async (req, res) => {
  try {
    await ensureRepuestosSemanalesTable(pool);

    const sedes = await sedesDisponibles(req);
    const [result] = await pool.query(
      "DELETE FROM repuestos_semanales WHERE id = ? AND sede IN (?)",
      [req.params.id, sedes]
    );

    req.session[result.affectedRows ? "success" : "error"] = result.affectedRows
      ? "Registro eliminado."
      : "Registro no encontrado o sin permiso.";
    redirectConFiltros(req, res);
  } catch (error) {
    console.error("Error eliminando repuesto semanal:", error);
    req.session.error = "Error eliminando registro.";
    redirectConFiltros(req, res);
  }
});

module.exports = router;
