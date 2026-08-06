const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  agregarTallerParaMecanico,
  SEDES_TRANSPORTE,
  etiquetaSede: etiquetaSedeTomza,
  esUsuarioTodasSedes,
  obtenerTodasSedes,
  obtenerSedesTransporte
} = require("../utils/sedes");

async function safeQuery(sql, params = [], fallback = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    console.warn("Dashboard query omitida:", error.code || error.message);
    return fallback;
  }
}

const ROLES_OFICINA_DIA_DIA = ["ADMIN", "TALLER", "PROVEEDURIA_TALLER"];
const SEDES_TRANSPORTE_AGRUPADAS = ["Transportadora", "Granel"];

function fechaCostaRica(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function expandirSedeFiltro(sede) {
  if (!sede) return [];
  if (SEDES_TRANSPORTE_AGRUPADAS.includes(sede)) return SEDES_TRANSPORTE;
  return [sede];
}

function etiquetaSede(sede) {
  if (!sede) return "TODAS";
  if (SEDES_TRANSPORTE_AGRUPADAS.includes(sede)) return "Transportadora + Granel";
  return etiquetaSedeTomza(sede);
}

function puedeUsarOficinaDiaDia(user) {
  return user && ROLES_OFICINA_DIA_DIA.includes(user.rol);
}

// =========================================================
// DASHBOARD PRINCIPAL
// =========================================================

router.get("/", async (req, res) => {

  try {

    // =========================
    // VALIDAR LOGIN
    // =========================
    if (!req.session.user) {
      return res.redirect("/login");
    }

    // =========================
    // FECHA HOY
    // =========================
    const hoy = new Date();
    const fechaHoy = fechaCostaRica(hoy);

    // =========================
    // TRAER SEDES EXTRA
    // =========================
    const [extras] = await pool.query(`
      SELECT sede
      FROM usuarios_sedes
      WHERE usuario_id = ?
    `, [req.session.user.id]);

    // =========================
    // ARMAR LISTA COMPLETA
    // =========================
    const esUsuarioPesados = req.session.user.rol === "SUPERVISOR_PESADO" ||
      String(req.session.user.usuario || "").trim().toLowerCase() === "pesados";
    const usuarioTodasSedes = esUsuarioTodasSedes(req.session.user);
    const sedesPermitidas = usuarioTodasSedes
      ? await obtenerTodasSedes(pool)
      : esUsuarioPesados
      ? await obtenerSedesTransporte(pool)
      : agregarTallerParaMecanico(req.session.user, [
          req.session.user.sede,
          ...extras.map(e => e.sede)
        ]);

    // =========================
    // DEFINIR SEDE ACTUAL
    // =========================
    let sedeFiltro = null;

    if (usuarioTodasSedes) {
      if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
        sedeFiltro = req.session.sedeSeleccionada;
      }
    } else {
      // MULTI-SEDE
      if (req.session.sedeSeleccionada && sedesPermitidas.includes(req.session.sedeSeleccionada)) {
        sedeFiltro = req.session.sedeSeleccionada;
      } else {
        sedeFiltro = req.session.user.sede;
      }
    }

    const sedesFiltro = expandirSedeFiltro(sedeFiltro);
    const sedeSeleccionadaVista = etiquetaSede(sedeFiltro);

    console.log("👤 Usuario:", req.session.user.usuario);
    console.log("📍 Sedes permitidas:", sedesPermitidas);
    console.log("📍 Sede actual:", sedeSeleccionadaVista);

    // =========================
    // QUERY HOY
    // =========================
    let condicionesHoy = ["m.fecha_programada = ?"];
    let paramsHoy = [fechaHoy];

    let condicionesStats = ["1=1"];
    let paramsStats = [];

    if (sedesFiltro.length) {
      condicionesHoy.push("u.sede IN (?)");
      paramsHoy.push(sedesFiltro);
      condicionesStats.push("u.sede IN (?)");
      paramsStats.push(sedesFiltro);
    }

    // =========================
    // MANTENIMIENTOS HOY
    // =========================
    const sqlHoy = `
      SELECT 
        m.id,
        u.placa,
        u.sede,
        m.tipo,
        m.estado,
        m.plan,
        DATE_FORMAT(m.fecha_programada, '%d/%m/%Y') AS fecha
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      WHERE ${condicionesHoy.join(" AND ")}
      ORDER BY m.id
    `;
    const [hoyMantenimientos] = await pool.query(sqlHoy, paramsHoy);

    // =========================
    // KPIs
    // =========================
    const sqlStats = `
      SELECT 
        SUM(CASE WHEN m.estado = 'CERRADO' THEN 1 ELSE 0 END) AS realizados,
        SUM(CASE WHEN m.estado != 'CERRADO' THEN 1 ELSE 0 END) AS pendientes
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      WHERE ${condicionesStats.join(" AND ")}
    `;
    const [statsRows] = await pool.query(sqlStats, paramsStats);
    const stats = statsRows[0] || { realizados: 0, pendientes: 0 };

    // =========================
    // KPIs EJECUTIVOS
    // =========================
    const sedeUnidadWhere = sedesFiltro.length ? "WHERE sede IN (?)" : "";
    const sedeUnidadParams = sedesFiltro.length ? [sedesFiltro] : [];

    const [unidadesRow] = await safeQuery(
      `SELECT COUNT(*) AS total FROM unidades ${sedeUnidadWhere}`,
      sedeUnidadParams,
      [{ total: 0 }]
    );

    const [unidadesResumenRow] = await safeQuery(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN activa = 1 THEN 1 ELSE 0 END) AS activas,
         SUM(CASE WHEN activa = 0 THEN 1 ELSE 0 END) AS inactivas,
         SUM(CASE WHEN varada = 1 THEN 1 ELSE 0 END) AS varadas
       FROM unidades
       ${sedeUnidadWhere}`,
      sedeUnidadParams,
      [{ total: 0, activas: 0, inactivas: 0, varadas: 0 }]
    );

    const [mantenimientosVencidosRow] = await safeQuery(
      `SELECT COUNT(*) AS total
       FROM mantenimientos m
       JOIN unidades u ON u.id = m.unidad_id
       WHERE m.estado != 'CERRADO'
         AND m.fecha_programada < ?
         ${sedesFiltro.length ? "AND u.sede IN (?)" : ""}`,
      sedesFiltro.length ? [fechaHoy, sedesFiltro] : [fechaHoy],
      [{ total: 0 }]
    );

    const [mantenimientosMananaRow] = await safeQuery(
      `SELECT COUNT(*) AS total
       FROM mantenimientos m
       JOIN unidades u ON u.id = m.unidad_id
       WHERE m.estado != 'CERRADO'
         AND DATE(m.fecha_programada) = DATE_ADD(?, INTERVAL 1 DAY)
         ${sedesFiltro.length ? "AND u.sede IN (?)" : ""}`,
      sedesFiltro.length ? [fechaHoy, sedesFiltro] : [fechaHoy],
      [{ total: 0 }]
    );

    const [ordenesAbiertasRow] = await safeQuery(
      `SELECT COUNT(*) AS total
       FROM ordenes_compra
       WHERE estado NOT IN ('RECIBIDA_TOTAL')`,
      [],
      [{ total: 0 }]
    );

    const [facturasOrdenesRow] = await safeQuery(
      `SELECT COUNT(*) AS pendientes,
              COALESCE(SUM(GREATEST(total - COALESCE(nota_credito_monto, 0) - COALESCE(abono_monto, 0), 0)), 0) AS monto
       FROM ordenes_compra
       WHERE facturada = 1
         AND COALESCE(pagada, 0) = 0
         AND GREATEST(total - COALESCE(nota_credito_monto, 0) - COALESCE(abono_monto, 0), 0) > 0`,
      [],
      [{ pendientes: 0, monto: 0 }]
    );

    const [facturasIndependientesRow] = await safeQuery(
      `SELECT COUNT(*) AS pendientes,
              COALESCE(SUM(GREATEST(monto - COALESCE(nota_credito_monto, 0) - COALESCE(abono_monto, 0), 0)), 0) AS monto
       FROM facturas
       WHERE COALESCE(pagada, 0) = 0
         AND GREATEST(monto - COALESCE(nota_credito_monto, 0) - COALESCE(abono_monto, 0), 0) > 0`,
      [],
      [{ pendientes: 0, monto: 0 }]
    );

    const [facturasVencidasRow] = await safeQuery(
      `SELECT COUNT(*) AS total
       FROM ordenes_compra
       WHERE facturada = 1
         AND COALESCE(pagada, 0) = 0
         AND fecha_vencimiento_factura IS NOT NULL
         AND fecha_vencimiento_factura < ?`,
      [fechaHoy],
      [{ total: 0 }]
    );

    const [llantasRow] = await safeQuery(
      `SELECT
         SUM(CASE WHEN estado = 'SOLICITADA' THEN 1 ELSE 0 END) AS solicitadas,
         SUM(CASE WHEN estado = 'COTIZADA' THEN 1 ELSE 0 END) AS cotizadas,
         SUM(CASE WHEN estado = 'COMPRADA' THEN 1 ELSE 0 END) AS compradas
       FROM solicitudes_llantas
       ${sedesFiltro.length ? "WHERE sede IN (?)" : ""}`,
      sedesFiltro.length ? [sedesFiltro] : [],
      [{ solicitadas: 0, cotizadas: 0, compradas: 0 }]
    );

    const comprasPendientes = Number(facturasOrdenesRow.pendientes || 0) + Number(facturasIndependientesRow.pendientes || 0);
    const montoPendiente = Number(facturasOrdenesRow.monto || 0) + Number(facturasIndependientesRow.monto || 0);
    const ejecutivo = {
      unidades: Number(unidadesRow.total || 0),
      unidadesActivas: Number(unidadesResumenRow.activas || 0),
      unidadesInactivas: Number(unidadesResumenRow.inactivas || 0),
      unidadesVaradas: Number(unidadesResumenRow.varadas || 0),
      mantenimientosVencidos: Number(mantenimientosVencidosRow.total || 0),
      mantenimientosManana: Number(mantenimientosMananaRow.total || 0),
      ordenesAbiertas: Number(ordenesAbiertasRow.total || 0),
      facturasPendientes: comprasPendientes,
      facturasVencidas: Number(facturasVencidasRow.total || 0),
      montoPendiente,
      llantasSolicitadas: Number(llantasRow.solicitadas || 0),
      llantasCotizadas: Number(llantasRow.cotizadas || 0),
      llantasCompradas: Number(llantasRow.compradas || 0)
    };

    const alertasEjecutivas = [
      ejecutivo.facturasVencidas > 0 ? {
        tipo: "Crítica",
        titulo: "Facturas vencidas",
        detalle: `${ejecutivo.facturasVencidas} factura${ejecutivo.facturasVencidas === 1 ? "" : "s"} requiere revisión.`,
        url: "/compras/facturas?vencida=1"
      } : null,
      ejecutivo.mantenimientosVencidos > 0 ? {
        tipo: "Operación",
        titulo: "Mantenimientos atrasados",
        detalle: `${ejecutivo.mantenimientosVencidos} mantenimiento${ejecutivo.mantenimientosVencidos === 1 ? "" : "s"} pendiente fuera de fecha.`,
        url: "/mantenimientos"
      } : null,
      ejecutivo.llantasCompradas > 0 ? {
        tipo: "Logística",
        titulo: "Llantas compradas sin recibir",
        detalle: `${ejecutivo.llantasCompradas} solicitud${ejecutivo.llantasCompradas === 1 ? "" : "es"} pendiente de llegada.`,
        url: "/llantas"
      } : null,
      ejecutivo.ordenesAbiertas > 0 ? {
        tipo: "Compras",
        titulo: "Órdenes abiertas",
        detalle: `${ejecutivo.ordenesAbiertas} orden${ejecutivo.ordenesAbiertas === 1 ? "" : "es"} sin recepción total.`,
        url: "/compras/ordenes"
      } : null
    ].filter(Boolean);

    let prioridadesSql = `
      SELECT
        tp.id,
        tp.placa,
        tp.sede,
        tp.observacion,
        tp.creado_en,
        u.usuario AS creado_por_nombre
      FROM taller_prioridades tp
      LEFT JOIN usuarios u ON u.id = tp.creado_por
      WHERE tp.estado = 'PENDIENTE'
        AND DATE(tp.creado_en) = ?
    `;
    const prioridadesParams = [fechaHoy];
    if (sedesFiltro.length) {
      prioridadesSql += " AND (tp.sede IN (?) OR tp.sede IS NULL OR tp.sede = '')";
      prioridadesParams.push(sedesFiltro);
    }
    prioridadesSql += " ORDER BY tp.creado_en DESC, tp.id DESC LIMIT 8";

    const prioridadesTaller = await safeQuery(prioridadesSql, prioridadesParams, []);

    const puedeVerOficinaDiaDia = puedeUsarOficinaDiaDia(req.session.user);

    // =========================
    // RENDER (se pasan TODAS las variables que la vista pueda esperar)
    // =========================
    const sedesDashboard = await obtenerTodasSedes(pool);
    res.render("dashboard", {
      user: req.session.user,
      hoy: hoyMantenimientos,
      stats,
      sedeSeleccionada: sedeSeleccionadaVista,
      sedesMultiples: sedesPermitidas,
      sedesDashboard,
      etiquetaSede: etiquetaSedeTomza,
      // Variables para evitar errores si la vista tiene bloques de trámites
      totalPendientes: 0,
      porVencer: 0,
      citasProximas: [],
      ultimosTramites: [],
      ejecutivo,
      alertasEjecutivas,
      prioridadesTaller,
      puedeVerOficinaDiaDia
    });

  } catch (error) {
    console.error("❌ ERROR dashboard:", error);
    res.status(500).send("Internal Server Error");
  }

});

module.exports = router;
