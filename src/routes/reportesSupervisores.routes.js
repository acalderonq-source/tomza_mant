const express = require("express");
const router = express.Router();
const pool = require("../db");
const ExcelJS = require("exceljs");
const {
  ensureReportesSupervisoresTables,
  limpiarTextoReporte
} = require("../utils/reportesSupervisoresDb");
const {
  agregarTallerParaMecanico,
  esSedeTransporte,
  esUsuarioMecanicoSede,
  esUsuarioPesados,
  expandirSedesEquivalentes,
  obtenerSedesTransporte,
  sedesEspecialesPorUsuario
} = require("../utils/sedes");
const { agregarFiltroPlacaSql } = require("../utils/placas");
const { normalizarTipoMantenimiento, detectarTipoMantenimiento } = require("../utils/tipoMantenimiento");
const { ensureRutasSupervisoresTables } = require("../utils/rutasSupervisoresDb");

const ROLES_VER = ["ADMIN", "TALLER", "MECANICO", "SUPERVISOR", "SUPERVISOR_PESADO"];
const ROLES_CREAR = ["ADMIN", "TALLER", "SUPERVISOR", "SUPERVISOR_PESADO"];
const ROLES_EDITAR = ["ADMIN", "TALLER"];
const ROLES_RUTAS = ["ADMIN", "TALLER", "SUPERVISOR", "SUPERVISOR_PESADO"];

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

async function obtenerSedesPermitidas(req) {
  const user = req.session.user;
  if (["ADMIN", "TALLER"].includes(user.rol)) {
    if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
      return expandirSedesEquivalentes(req.session.sedeSeleccionada);
    }
    return [];
  }

  if (esUsuarioPesados(user)) {
    if (
      req.session.sedeSeleccionada &&
      req.session.sedeSeleccionada !== "TODAS" &&
      esSedeTransporte(req.session.sedeSeleccionada)
    ) {
      return expandirSedesEquivalentes(req.session.sedeSeleccionada);
    }
    return expandirSedesEquivalentes(await obtenerSedesTransporte(pool));
  }

  const [extras] = await pool.query("SELECT sede FROM usuarios_sedes WHERE usuario_id = ?", [user.id]);
  const usuarioMecanicoSede = esUsuarioMecanicoSede(user);
  const sedes = agregarTallerParaMecanico(user, [
    user.sede,
    ...extras.map(e => e.sede),
    ...sedesEspecialesPorUsuario(user)
  ]);

  if (!usuarioMecanicoSede && req.session.sedeSeleccionada && sedes.includes(req.session.sedeSeleccionada)) {
    return expandirSedesEquivalentes(req.session.sedeSeleccionada);
  }

  return expandirSedesEquivalentes(sedes);
}

function aplicarFiltroSedes(sql, params, sedesPermitidas, alias = "rs") {
  if (sedesPermitidas.length) {
    sql += ` AND ${alias}.sede IN (?)`;
    params.push(sedesPermitidas);
  }
  return sql;
}

function nombreArchivoSeguro(value) {
  return String(value || "reportes")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase() || "reportes";
}

function nombreHojaSeguro(value, fallback = "Reportes") {
  const nombre = String(value || fallback)
    .replace(/[\\/*?:[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (nombre || fallback).slice(0, 31);
}

function fechaISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inicioSemanaLunes(date = new Date()) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  const dia = d.getDay() || 7;
  d.setDate(d.getDate() - dia + 1);
  return d;
}

function semanaInputValue(date = new Date()) {
  const d = inicioSemanaLunes(date);
  const jueves = new Date(d);
  jueves.setDate(d.getDate() + 3);
  const primerJueves = new Date(jueves.getFullYear(), 0, 4, 12, 0, 0, 0);
  const primerLunes = inicioSemanaLunes(primerJueves);
  const semana = Math.floor((jueves - primerLunes) / 604800000) + 1;
  return `${jueves.getFullYear()}-W${String(semana).padStart(2, "0")}`;
}

function lunesDesdeSemanaInput(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return "";

  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!year || week < 1 || week > 53) return "";

  const enero4 = new Date(year, 0, 4, 12, 0, 0, 0);
  const lunesSemana1 = inicioSemanaLunes(enero4);
  lunesSemana1.setDate(lunesSemana1.getDate() + ((week - 1) * 7));
  return fechaISO(lunesSemana1);
}

function semanaInputDesdeFecha(value) {
  if (!value) return "";
  const fechaBase = value instanceof Date
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Costa_Rica",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(value)
    : (String(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || "");
  const fecha = new Date(`${fechaBase}T12:00:00`);
  if (Number.isNaN(fecha.getTime())) return "";
  return semanaInputValue(fecha);
}

function semanaDefaultReporte() {
  const hoy = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Costa_Rica" }));
  const base = new Date(hoy);
  if (hoy.getDay() === 5) {
    base.setDate(base.getDate() + 7);
  }
  return semanaInputValue(base);
}

function semanaActualRutas() {
  const hoyCostaRica = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Costa_Rica" }));
  return semanaInputValue(hoyCostaRica);
}

function texto(value, maxLength = 255) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

async function cargarSedesRutas(req) {
  const sedesPermitidas = await obtenerSedesPermitidas(req);
  let sql = `SELECT DISTINCT sede FROM unidades WHERE COALESCE(activa, 1) = 1 AND sede IS NOT NULL AND TRIM(sede) <> ''`;
  const params = [];
  if (sedesPermitidas.length) {
    sql += " AND sede IN (?)";
    params.push(sedesPermitidas);
  }
  sql += " ORDER BY sede";
  const [rows] = await pool.query(sql, params);
  return rows.map(row => row.sede);
}

function usuarioPuedeUsarSede(sede, sedesPermitidas) {
  return !sedesPermitidas.length || sedesPermitidas.includes(sede);
}

function nombreUsuario(user) {
  return texto(user?.nombre || user?.usuario || "Usuario", 180);
}

async function registrarMovimientoRuta(conn, asignacionId, accion, anterior, nuevo, req, motivo = "") {
  const semana = nuevo?.semana_inicio || anterior?.semana_inicio;
  await conn.query(
    `INSERT INTO supervisor_rutas_movimientos (
      asignacion_id, accion, semana_inicio,
      sede_anterior, sede_nueva, ruta_anterior, ruta_nueva,
      chofer_anterior, chofer_nuevo, unidad_id_anterior, unidad_id_nueva,
      observacion_anterior, observacion_nueva, motivo,
      cambiado_por, cambiado_por_nombre
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      asignacionId,
      accion,
      semana,
      anterior?.sede || null,
      nuevo?.sede || null,
      anterior?.ruta || null,
      nuevo?.ruta || null,
      anterior?.chofer || null,
      nuevo?.chofer || null,
      anterior?.unidad_id || null,
      nuevo?.unidad_id || null,
      anterior?.observacion || null,
      nuevo?.observacion || null,
      texto(motivo) || null,
      req.session.user.id,
      nombreUsuario(req.session.user)
    ]
  );
}

function puedeElegirSemanaReporte(user) {
  return ROLES_EDITAR.includes(user?.rol);
}

function agruparPorSede(reportes) {
  return Array.from(reportes.reduce((map, reporte) => {
    const sedeReporte = reporte.sede || "Sin sede";
    if (!map.has(sedeReporte)) map.set(sedeReporte, []);
    map.get(sedeReporte).push(reporte);
    return map;
  }, new Map()).entries()).sort((a, b) => a[0].localeCompare(b[0], "es"));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function decodeHtmlBasico(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&#39;/gi, "'");
}

function htmlATextoPlano(value) {
  return decodeHtmlBasico(String(value || "")
    .replace(/<br\s*\/?>/gi, ", ")
    .replace(/<\/(?:div|p|li)>/gi, ", ")
    .replace(/<[^>]+>/g, "")
  )
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, " ")
    .replace(/[★☆✦✧❖◆◇■□●○]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/,+/g, ",")
    .replace(/,\s*$/g, "")
    .toLowerCase()
    .trim();
}

function sanitizarFragmentoHtml(value) {
  return escapeHtml(htmlATextoPlano(value));
}

function sanitizarReporteHtml(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const preparado = raw
    .replace(/<br\s*\/?>/gi, ", ")
    .replace(/<\/(?:div|p|li)>/gi, ", ")
    .replace(/<(?:div|p|li)[^>]*>/gi, "");

  const spanRojo = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
  let resultado = "";
  let ultimoIndice = 0;
  let match;

  while ((match = spanRojo.exec(preparado))) {
    const atributos = match[1] || "";
    const esRojo =
      /mark-red|text-danger|color\s*:\s*(?:red|#dc2626|rgb\(\s*220\s*,\s*38\s*,\s*38\s*\))/i.test(atributos);

    resultado += sanitizarFragmentoHtml(preparado.slice(ultimoIndice, match.index));
    const textoInterno = sanitizarFragmentoHtml(match[2]);
    if (textoInterno) {
      resultado += esRojo
        ? `<span class="mark-red">${textoInterno}</span>`
        : textoInterno;
    }
    ultimoIndice = spanRojo.lastIndex;
  }

  resultado += sanitizarFragmentoHtml(preparado.slice(ultimoIndice));
  const limpio = resultado
    .replace(/([A-Za-zÁÉÍÓÚÑáéíóúñ0-9])<span/g, "$1 <span")
    .replace(/<\/span>([A-Za-zÁÉÍÓÚÑáéíóúñ0-9])/g, "</span> $1")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/,\s*<\/span>/g, "</span>,")
    .replace(/,+/g, ",")
    .replace(/,\s*$/g, "")
    .trim();

  if (!limpio) return "";
  return /[.!?]\s*(?:<\/span>)?\s*$/.test(limpio) ? limpio : `${limpio}.`;
}

function renderReporteHtml(value) {
  const limpio = sanitizarReporteHtml(value);
  return limpio || escapeHtml(limpiarTextoReporte(value));
}

function partesReporteRichText(value, importante = false) {
  const html = sanitizarReporteHtml(value);
  const partes = [];
  const spanRojo = /<span class="mark-red">([\s\S]*?)<\/span>/gi;
  let ultimoIndice = 0;
  let match;

  function agregar(texto, rojo = false) {
    const plano = htmlATextoPlano(texto);
    if (!plano) return;
    partes.push({
      text: plano,
      font: {
        name: "Arial",
        size: 10,
        bold: rojo || importante,
        color: { argb: rojo || importante ? "FF0000" : "000000" }
      }
    });
  }

  while ((match = spanRojo.exec(html))) {
    agregar(html.slice(ultimoIndice, match.index), false);
    agregar(match[1], true);
    ultimoIndice = spanRojo.lastIndex;
  }
  agregar(html.slice(ultimoIndice), false);

  if (!partes.length) {
    agregar(limpiarTextoReporte(value), importante);
  }

  return partes;
}

function tieneRojoReporte(value) {
  return /<span class="mark-red">/i.test(sanitizarReporteHtml(value));
}

function fechaReporteKey(value) {
  if (!value) return "";
  const texto = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function normalizarClaveReporte(value) {
  return htmlATextoPlano(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function combinarTextosReportes(items, campo) {
  const vistos = new Set();
  const partes = [];

  for (const item of items) {
    const texto = String(item[campo] || "").trim();
    const clave = normalizarClaveReporte(texto);
    if (!texto || !clave || vistos.has(clave)) continue;
    vistos.add(clave);
    partes.push(texto);
  }

  return partes.join(" / ");
}

function agruparReportesPorPlaca(reportes = []) {
  const grupos = new Map();

  for (const reporte of reportes) {
    const semana = fechaReporteKey(reporte.semana_reporte || reporte.fecha_reporte);
    const sede = reporte.sede || reporte.unidad_sede || "Sin sede";
    const placa = String(reporte.placa || "").trim().toUpperCase();
    const tipo = String(reporte.tipo_mantenimiento || "CORRECTIVO").trim().toUpperCase();
    const key = [semana, sede.toUpperCase(), placa].join("|");

    if (!grupos.has(key)) {
      grupos.set(key, {
        ...reporte,
        grupo_id: `grupo_${reporte.id}`,
        sede,
        placa,
        tipo_mantenimiento: tipo,
        reportes_detalle: [],
        cantidad_reportes: 0,
        _tipos: new Set()
      });
    }

    const grupo = grupos.get(key);
    grupo.reportes_detalle.push(reporte);
    grupo.cantidad_reportes += 1;
    grupo._tipos.add(tipo);
    grupo.importante = Number(grupo.importante || 0) || Number(reporte.importante || 0);

    if (reporte.estado === "EN_REVISION") grupo.estado = "EN_REVISION";
    if (new Date(reporte.fecha_reporte || 0) > new Date(grupo.fecha_reporte || 0)) {
      grupo.fecha_reporte = reporte.fecha_reporte;
      grupo.supervisor_nombre = reporte.supervisor_nombre;
    }
  }

  return [...grupos.values()].map(grupo => {
    const tipos = [...grupo._tipos].filter(Boolean);
    delete grupo._tipos;

    return {
      ...grupo,
      tipo_mantenimiento: tipos.length ? tipos.join(" + ") : "CORRECTIVO",
      descripcion_limpia: combinarTextosReportes(grupo.reportes_detalle, "descripcion_limpia") ||
        combinarTextosReportes(grupo.reportes_detalle, "descripcion_original"),
      descripcion_original: combinarTextosReportes(grupo.reportes_detalle, "descripcion_original")
    };
  });
}

async function consultarReportesPendientes(req, filtros = {}) {
  const sedesPermitidas = await obtenerSedesPermitidas(req);
  const { sede, placa, importante, semana_reporte } = filtros;
  const params = [];
  let sql = `
    SELECT
      rs.*,
      u.placa,
      u.sede AS unidad_sede
    FROM reportes_supervisores rs
    JOIN unidades u ON u.id = rs.unidad_id
    WHERE rs.estado IN ('PENDIENTE','EN_REVISION')
  `;

  sql = aplicarFiltroSedes(sql, params, sedesPermitidas, "rs");

  if (sede) {
    sql += " AND rs.sede IN (?)";
    params.push(expandirSedesEquivalentes(sede));
  }
  if (placa) {
    const condicionesPlaca = [];
    agregarFiltroPlacaSql(condicionesPlaca, params, "u.placa", placa);
    if (condicionesPlaca.length) {
      sql += ` AND ${condicionesPlaca[0]}`;
    }
  }
  if (importante === "1") {
    sql += " AND rs.importante = 1";
  }
  if (semana_reporte) {
    sql += " AND COALESCE(rs.semana_reporte, DATE(rs.fecha_reporte)) = ?";
    params.push(semana_reporte);
  }

  sql += " ORDER BY COALESCE(rs.semana_reporte, DATE(rs.fecha_reporte)) DESC, rs.importante DESC, rs.sede ASC, u.placa ASC, rs.fecha_reporte DESC";
  const [reportes] = await pool.query(sql, params);
  return { reportes, sedesPermitidas };
}

function pintarCelda(cell, fillColor = "FFFFFF", fontColor = "000000", bold = false) {
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: fillColor }
  };
  cell.font = {
    name: "Arial",
    size: 10,
    bold,
    color: { argb: fontColor }
  };
  cell.alignment = {
    vertical: "middle",
    wrapText: true
  };
  cell.border = {
    top: { style: "thin", color: { argb: "000000" } },
    left: { style: "thin", color: { argb: "000000" } },
    bottom: { style: "thin", color: { argb: "000000" } },
    right: { style: "thin", color: { argb: "000000" } }
  };
}

function agregarHojaReportes(workbook, sede, items) {
  const sheet = workbook.addWorksheet(nombreHojaSeguro(sede), {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.2, right: 0.2, top: 0.25, bottom: 0.25, header: 0.1, footer: 0.1 }
    },
    views: [{ showGridLines: false }]
  });

  sheet.columns = [
    { key: "placa", width: 14 },
    { key: "reporte", width: 125 }
  ];

  sheet.mergeCells("A1:B1");
  sheet.getCell("A1").value = sede;
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getCell("A1").font = { name: "Arial", size: 11, bold: true, color: { argb: "000000" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "9FC5E8" } };
  sheet.getCell("A1").border = {
    top: { style: "thin", color: { argb: "000000" } },
    left: { style: "thin", color: { argb: "000000" } },
    bottom: { style: "thin", color: { argb: "000000" } },
    right: { style: "thin", color: { argb: "000000" } }
  };
  sheet.getRow(1).height = 16;

  const filas = items.length ? items : [{ placa: "", descripcion_limpia: "" }];
  filas.forEach(item => {
    const row = sheet.addRow({
      placa: item.placa || "",
      reporte: ""
    });
    row.height = 18;
    const textoReporte = item.descripcion_limpia || item.descripcion_original || "";
    const tieneRojo = tieneRojoReporte(textoReporte);
    const importante = Number(item.importante || 0) === 1 && !tieneRojo;
    pintarCelda(row.getCell(1), importante ? "FFF2CC" : "FFFFFF", "000000", true);
    pintarCelda(row.getCell(2), "FFFFFF", importante ? "FF0000" : "000000", importante);
    const richText = partesReporteRichText(textoReporte, importante);
    row.getCell(2).value = richText.length ? { richText } : "";
  });

  for (let i = filas.length; i < 32; i++) {
    const row = sheet.addRow({ placa: "", reporte: "" });
    row.height = 18;
    pintarCelda(row.getCell(1));
    pintarCelda(row.getCell(2));
  }

  sheet.eachRow(row => {
    row.eachCell(cell => {
      if (!cell.alignment) cell.alignment = {};
      cell.alignment = { ...cell.alignment, vertical: "middle", wrapText: true };
    });
  });
}

async function cargarUnidades(req) {
  const sedesPermitidas = await obtenerSedesPermitidas(req);
  let sql = "SELECT id, placa, sede FROM unidades WHERE activa = 1";
  const params = [];
  if (sedesPermitidas.length) {
    sql += " AND sede IN (?)";
    params.push(sedesPermitidas);
  }
  sql += " ORDER BY sede, placa";
  const [unidades] = await pool.query(sql, params);
  return unidades;
}

async function obtenerSugerenciasPendientes(sedesPermitidas, correctivoId = null) {
  const params = [];
  let sql = `
    SELECT
      s.id,
      s.reporte_id,
      s.correctivo_id,
      s.confianza,
      s.motivo,
      rs.descripcion_limpia,
      rs.descripcion_original,
      rs.fecha_reporte,
      u.placa,
      rs.sede,
      c.trabajo_realizado,
      c.fecha AS fecha_correctivo
    FROM reportes_supervisores_sugerencias s
    JOIN reportes_supervisores rs ON rs.id = s.reporte_id
    JOIN unidades u ON u.id = rs.unidad_id
    JOIN correctivos c ON c.id = s.correctivo_id
    WHERE s.estado = 'PENDIENTE'
      AND rs.estado IN ('PENDIENTE','EN_REVISION')
  `;

  if (correctivoId) {
    sql += " AND s.correctivo_id = ?";
    params.push(correctivoId);
  }

  sql = aplicarFiltroSedes(sql, params, sedesPermitidas, "rs");
  sql += " ORDER BY s.confianza DESC, s.creado_en DESC";

  const [sugerencias] = await pool.query(sql, params);
  return sugerencias;
}

router.use(requireAuth);

router.get("/", allowRoles(...ROLES_VER), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    await ensureRutasSupervisoresTables(pool);
    const sedesPermitidas = await obtenerSedesPermitidas(req);
    const { sede, placa, importante, correctivo_id } = req.query;
    const semana = String(req.query.semana || "").trim();
    const semanaReporteFecha = lunesDesdeSemanaInput(semana);
    const { reportes } = await consultarReportesPendientes(req, { sede, placa, importante, semana_reporte: semanaReporteFecha });
    const reportesAgrupados = agruparReportesPorPlaca(reportes);
    const unidades = await cargarUnidades(req);
    const sugerencias = await obtenerSugerenciasPendientes(sedesPermitidas, correctivo_id || null);
    const semanaRutasFecha = lunesDesdeSemanaInput(semanaActualRutas());
    const paramsRutas = [semanaRutasFecha];
    let sqlRutas = `SELECT COUNT(*) AS total FROM supervisor_rutas_semanales WHERE activo = 1 AND semana_inicio = ?`;
    if (sedesPermitidas.length) {
      sqlRutas += " AND sede IN (?)";
      paramsRutas.push(sedesPermitidas);
    }
    const [[rutasSemanaRow]] = await pool.query(sqlRutas, paramsRutas);
    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("reportes_supervisores", {
      reportes: reportesAgrupados,
      unidades,
      sugerencias,
      user: req.session.user,
      filtros: { sede, placa, importante, correctivo_id, semana },
      semanaDefault: semanaDefaultReporte(),
      puedeElegirSemanaReporte: puedeElegirSemanaReporte(req.session.user),
      puedeCrear: ROLES_CREAR.includes(req.session.user.rol),
      puedeEditar: ROLES_EDITAR.includes(req.session.user.rol),
      rutasSemanaActual: Number(rutasSemanaRow.total || 0),
      semanaRutasActual: semanaActualRutas(),
      renderReporteHtml,
      success,
      error
    });
  } catch (error) {
    console.error("Error cargando reportes de supervisores:", error);
    res.status(500).send("Error interno");
  }
});

router.get("/rutas", allowRoles(...ROLES_RUTAS), async (req, res) => {
  try {
    await ensureRutasSupervisoresTables(pool);
    const sedesPermitidas = await obtenerSedesPermitidas(req);
    const sedes = await cargarSedesRutas(req);
    const unidades = await cargarUnidades(req);
    const semanaInput = String(req.query.semana || semanaActualRutas()).trim();
    const semanaFecha = lunesDesdeSemanaInput(semanaInput) || lunesDesdeSemanaInput(semanaActualRutas());
    const sede = texto(req.query.sede, 100);

    if (sede && !usuarioPuedeUsarSede(sede, sedesPermitidas)) {
      return res.status(403).send("No autorizado para esa sede");
    }

    const params = [semanaFecha];
    let sql = `
      SELECT sr.*, u.placa
      FROM supervisor_rutas_semanales sr
      LEFT JOIN unidades u ON u.id = sr.unidad_id
      WHERE sr.activo = 1 AND sr.semana_inicio = ?
    `;
    if (sedesPermitidas.length) {
      sql += " AND sr.sede IN (?)";
      params.push(sedesPermitidas);
    }
    if (sede) {
      sql += " AND sr.sede = ?";
      params.push(sede);
    }
    sql += " ORDER BY sr.sede, sr.ruta, sr.chofer";
    const [asignaciones] = await pool.query(sql, params);

    const movimientoParams = [semanaFecha];
    let movimientoSql = `
      SELECT
        sm.*,
        ua.placa AS placa_anterior,
        un.placa AS placa_nueva
      FROM supervisor_rutas_movimientos sm
      LEFT JOIN unidades ua ON ua.id = sm.unidad_id_anterior
      LEFT JOIN unidades un ON un.id = sm.unidad_id_nueva
      WHERE sm.semana_inicio = ?
    `;
    if (sedesPermitidas.length) {
      movimientoSql += " AND COALESCE(sm.sede_nueva, sm.sede_anterior) IN (?)";
      movimientoParams.push(sedesPermitidas);
    }
    if (sede) {
      movimientoSql += " AND COALESCE(sm.sede_nueva, sm.sede_anterior) = ?";
      movimientoParams.push(sede);
    }
    movimientoSql += " ORDER BY sm.cambiado_en DESC, sm.id DESC LIMIT 250";
    const [movimientos] = await pool.query(movimientoSql, movimientoParams);

    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("reportes_supervisores_rutas", {
      user: req.session.user,
      asignaciones,
      movimientos,
      unidades,
      sedes,
      filtros: { semana: semanaInputDesdeFecha(semanaFecha), sede },
      semanaActual: semanaActualRutas(),
      success,
      error
    });
  } catch (error) {
    console.error("Error cargando rutas semanales de supervisores:", error);
    res.status(500).send("Error cargando rutas y choferes");
  }
});

router.post("/rutas", allowRoles(...ROLES_RUTAS), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRutasSupervisoresTables(pool);
    const semanaInput = String(req.body.semana || semanaActualRutas()).trim();
    const semanaInicio = lunesDesdeSemanaInput(semanaInput);
    const sede = texto(req.body.sede, 100);
    const ruta = texto(req.body.ruta, 150);
    const chofer = texto(req.body.chofer, 180);
    const observacion = texto(req.body.observacion, 255);
    const unidadId = Number(req.body.unidad_id) || null;
    const sedesPermitidas = await obtenerSedesPermitidas(req);

    if (!semanaInicio || !sede || !ruta || !chofer) throw new Error("Debe indicar semana, sede, ruta y chofer.");
    if (!usuarioPuedeUsarSede(sede, sedesPermitidas)) throw new Error("No tiene permiso para registrar esa sede.");

    await conn.beginTransaction();
    if (unidadId) {
      const [[unidad]] = await conn.query("SELECT id, sede FROM unidades WHERE id = ? AND COALESCE(activa, 1) = 1 LIMIT 1", [unidadId]);
      if (!unidad || !usuarioPuedeUsarSede(unidad.sede, sedesPermitidas)) throw new Error("La unidad seleccionada no está autorizada.");
    }

    const [[existente]] = await conn.query(
      `SELECT * FROM supervisor_rutas_semanales
       WHERE semana_inicio = ? AND sede = ? AND ruta = ?
       LIMIT 1 FOR UPDATE`,
      [semanaInicio, sede, ruta]
    );
    const nuevo = { semana_inicio: semanaInicio, sede, ruta, chofer, unidad_id: unidadId, observacion };

    if (existente) {
      const cambioChofer = texto(existente.chofer, 180).toUpperCase() !== chofer.toUpperCase();
      const cambioUnidad = Number(existente.unidad_id || 0) !== Number(unidadId || 0);
      const cambioDetalle = texto(existente.observacion) !== observacion;
      const reactivada = Number(existente.activo || 0) !== 1;
      await conn.query(
        `UPDATE supervisor_rutas_semanales
         SET chofer = ?, unidad_id = ?, observacion = ?, supervisor_id = ?, supervisor_nombre = ?, activo = 1
         WHERE id = ?`,
        [chofer, unidadId, observacion || null, req.session.user.id, nombreUsuario(req.session.user), existente.id]
      );
      if (cambioChofer || cambioUnidad || cambioDetalle || reactivada) {
        const motivo = texto(req.body.motivo, 255);
        if (!motivo) throw new Error("Debe indicar el motivo para cambiar una asignación existente.");
        const accion = reactivada ? "REACTIVAR" : cambioChofer && !cambioUnidad ? "CAMBIO_CHOFER" : cambioUnidad && !cambioChofer ? "CAMBIO_UNIDAD" : "ACTUALIZAR";
        await registrarMovimientoRuta(conn, existente.id, accion, existente, nuevo, req, motivo);
      }
      req.session.success = cambioChofer || cambioUnidad || cambioDetalle || reactivada
        ? `Asignación actualizada para la ruta ${ruta}.`
        : `La ruta ${ruta} ya tenía esa misma asignación.`;
    } else {
      const [result] = await conn.query(
        `INSERT INTO supervisor_rutas_semanales
          (semana_inicio, sede, ruta, chofer, unidad_id, observacion, supervisor_id, supervisor_nombre)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [semanaInicio, sede, ruta, chofer, unidadId, observacion || null, req.session.user.id, nombreUsuario(req.session.user)]
      );
      await registrarMovimientoRuta(conn, result.insertId, "CREAR", null, nuevo, req, req.body.motivo);
      req.session.success = `Ruta ${ruta} asignada a ${chofer}.`;
    }

    await conn.commit();
    res.redirect(`/reportes-supervisores/rutas?semana=${encodeURIComponent(semanaInput)}&sede=${encodeURIComponent(sede)}`);
  } catch (error) {
    await conn.rollback();
    console.error("Error guardando ruta semanal:", error);
    req.session.error = error.code === "ER_DUP_ENTRY" ? "Ya existe esa ruta para la semana y sede seleccionadas." : (error.message || "No se pudo guardar la ruta.");
    res.redirect("/reportes-supervisores/rutas");
  } finally {
    conn.release();
  }
});

router.post("/rutas/:id", allowRoles(...ROLES_RUTAS), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRutasSupervisoresTables(pool);
    const id = Number(req.params.id);
    const sede = texto(req.body.sede, 100);
    const ruta = texto(req.body.ruta, 150);
    const chofer = texto(req.body.chofer, 180);
    const observacion = texto(req.body.observacion, 255);
    const motivo = texto(req.body.motivo, 255);
    const unidadId = Number(req.body.unidad_id) || null;
    const sedesPermitidas = await obtenerSedesPermitidas(req);
    if (!id || !sede || !ruta || !chofer) throw new Error("Debe indicar sede, ruta y chofer.");

    await conn.beginTransaction();
    const [[anterior]] = await conn.query("SELECT * FROM supervisor_rutas_semanales WHERE id = ? AND activo = 1 FOR UPDATE", [id]);
    if (!anterior) throw new Error("La asignación ya no está activa.");
    if (!usuarioPuedeUsarSede(anterior.sede, sedesPermitidas) || !usuarioPuedeUsarSede(sede, sedesPermitidas)) {
      throw new Error("No tiene permiso para modificar esa sede.");
    }
    if (unidadId) {
      const [[unidad]] = await conn.query("SELECT id, sede FROM unidades WHERE id = ? AND COALESCE(activa, 1) = 1 LIMIT 1", [unidadId]);
      if (!unidad || !usuarioPuedeUsarSede(unidad.sede, sedesPermitidas)) throw new Error("La unidad seleccionada no está autorizada.");
    }

    const nuevo = { semana_inicio: anterior.semana_inicio, sede, ruta, chofer, unidad_id: unidadId, observacion };
    const cambioChofer = texto(anterior.chofer, 180).toUpperCase() !== chofer.toUpperCase();
    const cambioRuta = texto(anterior.ruta, 150).toUpperCase() !== ruta.toUpperCase() || anterior.sede !== sede;
    const cambioUnidad = Number(anterior.unidad_id || 0) !== Number(unidadId || 0);
    const cambioDetalle = texto(anterior.observacion) !== observacion;
    if (!cambioChofer && !cambioRuta && !cambioUnidad && !cambioDetalle) {
      await conn.rollback();
      req.session.success = "No había cambios por guardar.";
      return res.redirect(`/reportes-supervisores/rutas?semana=${encodeURIComponent(semanaInputDesdeFecha(anterior.semana_inicio))}`);
    }
    if (!motivo) throw new Error("Debe indicar el motivo del cambio.");

    await conn.query(
      `UPDATE supervisor_rutas_semanales
       SET sede = ?, ruta = ?, chofer = ?, unidad_id = ?, observacion = ?, supervisor_id = ?, supervisor_nombre = ?
       WHERE id = ?`,
      [sede, ruta, chofer, unidadId, observacion || null, req.session.user.id, nombreUsuario(req.session.user), id]
    );
    const accion = cambioChofer && !cambioRuta && !cambioUnidad ? "CAMBIO_CHOFER" : cambioRuta && !cambioChofer && !cambioUnidad ? "CAMBIO_RUTA" : cambioUnidad && !cambioChofer && !cambioRuta ? "CAMBIO_UNIDAD" : "ACTUALIZAR";
    await registrarMovimientoRuta(conn, id, accion, anterior, nuevo, req, motivo);
    await conn.commit();
    req.session.success = `Cambios guardados para la ruta ${ruta}.`;
    res.redirect(`/reportes-supervisores/rutas?semana=${encodeURIComponent(semanaInputDesdeFecha(anterior.semana_inicio))}&sede=${encodeURIComponent(sede)}`);
  } catch (error) {
    await conn.rollback();
    console.error("Error actualizando ruta semanal:", error);
    req.session.error = error.code === "ER_DUP_ENTRY" ? "Ya existe otra asignación con esa ruta, semana y sede." : (error.message || "No se pudo actualizar la ruta.");
    res.redirect("/reportes-supervisores/rutas");
  } finally {
    conn.release();
  }
});

router.post("/rutas/:id/retirar", allowRoles(...ROLES_RUTAS), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRutasSupervisoresTables(pool);
    const sedesPermitidas = await obtenerSedesPermitidas(req);
    await conn.beginTransaction();
    const [[anterior]] = await conn.query("SELECT * FROM supervisor_rutas_semanales WHERE id = ? AND activo = 1 FOR UPDATE", [Number(req.params.id)]);
    if (!anterior) throw new Error("La asignación ya no está activa.");
    if (!usuarioPuedeUsarSede(anterior.sede, sedesPermitidas)) throw new Error("No tiene permiso para retirar esa ruta.");
    await conn.query("UPDATE supervisor_rutas_semanales SET activo = 0, supervisor_id = ?, supervisor_nombre = ? WHERE id = ?", [req.session.user.id, nombreUsuario(req.session.user), anterior.id]);
    await registrarMovimientoRuta(conn, anterior.id, "RETIRAR", anterior, null, req, req.body.motivo || "Ruta retirada de la semana");
    await conn.commit();
    req.session.success = `Ruta ${anterior.ruta} retirada de la semana.`;
    res.redirect(`/reportes-supervisores/rutas?semana=${encodeURIComponent(semanaInputDesdeFecha(anterior.semana_inicio))}`);
  } catch (error) {
    await conn.rollback();
    console.error("Error retirando ruta semanal:", error);
    req.session.error = error.message || "No se pudo retirar la ruta.";
    res.redirect("/reportes-supervisores/rutas");
  } finally {
    conn.release();
  }
});

router.get("/reporte/excel", allowRoles(...ROLES_VER), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    const { sede, placa, importante } = req.query;
    const semana = String(req.query.semana || "").trim();
    const semanaReporteFecha = lunesDesdeSemanaInput(semana);
    const { reportes } = await consultarReportesPendientes(req, { sede, placa, importante, semana_reporte: semanaReporteFecha });
    const gruposSede = agruparPorSede(agruparReportesPorPlaca(reportes));
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Gas Tomza";
    workbook.created = new Date();

    if (gruposSede.length) {
      gruposSede.forEach(([sedeNombre, items]) => agregarHojaReportes(workbook, sedeNombre, items));
    } else {
      agregarHojaReportes(workbook, sede || "Reportes", []);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const nombreSede = sede ? nombreArchivoSeguro(sede) : "todas_las_sedes";
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=reportes_supervisores_${nombreSede}_${timestamp}.xlsx`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Error descargando Excel de reportes:", error);
    res.status(500).send("Error generando Excel de reportes");
  }
});

router.get("/historial", allowRoles(...ROLES_VER), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    const sedesPermitidas = await obtenerSedesPermitidas(req);
    const { sede, placa, fecha_desde, fecha_hasta } = req.query;
    const params = [];
    let sql = `
      SELECT
        rs.*,
        u.placa,
        c.trabajo_realizado,
        c.fecha AS fecha_correctivo,
        uc.usuario AS cerrado_por_usuario
      FROM reportes_supervisores rs
      JOIN unidades u ON u.id = rs.unidad_id
      LEFT JOIN correctivos c ON c.id = rs.correctivo_id
      LEFT JOIN usuarios uc ON uc.id = rs.cerrado_por
      WHERE rs.estado IN ('HISTORIAL','DESCARTADO')
    `;

    sql = aplicarFiltroSedes(sql, params, sedesPermitidas, "rs");

    if (sede) {
      sql += " AND rs.sede IN (?)";
      params.push(expandirSedesEquivalentes(sede));
    }
    if (placa) {
      const condicionesPlaca = [];
      agregarFiltroPlacaSql(condicionesPlaca, params, "u.placa", placa);
      if (condicionesPlaca.length) {
        sql += ` AND ${condicionesPlaca[0]}`;
      }
    }
    if (fecha_desde) {
      sql += " AND DATE(rs.fecha_cierre) >= ?";
      params.push(fecha_desde);
    }
    if (fecha_hasta) {
      sql += " AND DATE(rs.fecha_cierre) <= ?";
      params.push(fecha_hasta);
    }

    sql += " ORDER BY rs.fecha_cierre DESC, rs.sede, u.placa";
    const [reportes] = await pool.query(sql, params);

    res.render("reportes_supervisores_historial", {
      reportes,
      user: req.session.user,
      filtros: { sede, placa, fecha_desde, fecha_hasta },
      puedeEditar: ROLES_EDITAR.includes(req.session.user.rol)
    });
  } catch (error) {
    console.error("Error cargando historial de reportes:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/limpiar-tabla", allowRoles(...ROLES_EDITAR), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    const sede = String(req.body.sede || "").trim();
    const semana = String(req.body.semana || "").trim();
    const semanaReporteFecha = lunesDesdeSemanaInput(semana);
    const sedesPermitidas = await obtenerSedesPermitidas(req);

    if (!sede) {
      req.session.error = "Debe indicar la sede para reescribir la tabla.";
      return res.redirect("/reportes-supervisores");
    }
    const sedesReescritura = expandirSedesEquivalentes(sede);
    if (sedesPermitidas.length && !sedesReescritura.some(item => sedesPermitidas.includes(item))) {
      req.session.error = "No tiene permiso para reescribir esta sede.";
      return res.redirect("/reportes-supervisores");
    }

    const paramsReportes = [sedesReescritura];
    let sqlReportes = `SELECT id, descripcion_original
       FROM reportes_supervisores
       WHERE sede IN (?)
         AND estado IN ('PENDIENTE','EN_REVISION')`;
    if (semanaReporteFecha) {
      sqlReportes += " AND COALESCE(semana_reporte, DATE(fecha_reporte)) = ?";
      paramsReportes.push(semanaReporteFecha);
    }
    const [reportes] = await pool.query(sqlReportes, paramsReportes);

    for (const reporte of reportes) {
      await pool.query(
        "UPDATE reportes_supervisores SET descripcion_limpia = ?, actualizado_en = NOW() WHERE id = ?",
        [limpiarTextoReporte(reporte.descripcion_original), reporte.id]
      );
    }

    req.session.success = `Tabla de ${sede} reescrita correctamente.`;
    res.redirect(`/reportes-supervisores?sede=${encodeURIComponent(sede)}${semana ? `&semana=${encodeURIComponent(semana)}` : ""}`);
  } catch (error) {
    console.error("Error limpiando tabla de reportes:", error);
    req.session.error = "No se pudo reescribir la tabla.";
    res.redirect("/reportes-supervisores");
  }
});

router.post("/", allowRoles(...ROLES_CREAR), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    const { unidad_id, descripcion_original } = req.body;
    const tipoMantenimiento = normalizarTipoMantenimiento(
      req.body.tipo_mantenimiento,
      detectarTipoMantenimiento(req.body.descripcion_original, { origen: "REPORTE" })
    );
    const semanaActual = lunesDesdeSemanaInput(semanaDefaultReporte());
    const semanaManual = lunesDesdeSemanaInput(req.body.semana_reporte);
    const semanaReporte = puedeElegirSemanaReporte(req.session.user)
      ? (semanaManual || semanaActual)
      : semanaActual;
    if (!unidad_id || !String(descripcion_original || "").trim()) {
      req.session.error = "Debe seleccionar unidad y escribir el reporte.";
      return res.redirect("/reportes-supervisores");
    }

    const sedesPermitidas = await obtenerSedesPermitidas(req);
    const [[unidad]] = await pool.query("SELECT id, placa, sede FROM unidades WHERE id = ?", [unidad_id]);
    if (!unidad || (sedesPermitidas.length && !sedesPermitidas.includes(unidad.sede))) {
      req.session.error = "Unidad no autorizada para este usuario.";
      return res.redirect("/reportes-supervisores");
    }

    await pool.query(
      `INSERT INTO reportes_supervisores
       (unidad_id, sede, supervisor_id, supervisor_nombre, descripcion_original, descripcion_limpia, semana_reporte, tipo_mantenimiento)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        unidad.id,
        unidad.sede,
        req.session.user.id,
        req.session.user.nombre || req.session.user.usuario,
        descripcion_original.trim(),
        limpiarTextoReporte(descripcion_original),
        semanaReporte,
        tipoMantenimiento
      ]
    );

    req.session.success = `Reporte registrado para ${unidad.placa}. Semana: ${semanaInputDesdeFecha(semanaReporte) || "actual"}.`;
    res.redirect("/reportes-supervisores");
  } catch (error) {
    console.error("Error guardando reporte de supervisor:", error);
    req.session.error = "Error al guardar reporte.";
    res.redirect("/reportes-supervisores");
  }
});

router.post("/:id/editar", allowRoles(...ROLES_EDITAR), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    const { descripcion_limpia, nota_taller, importante, estado } = req.body;
    const tipoMantenimiento = normalizarTipoMantenimiento(
      req.body.tipo_mantenimiento,
      detectarTipoMantenimiento(req.body.descripcion_limpia || req.body.descripcion_original, { origen: "REPORTE" })
    );
    const descripcionLimpia = sanitizarReporteHtml(descripcion_limpia) || null;
    const marcadoRojo = tieneRojoReporte(descripcionLimpia);
    await pool.query(
      `UPDATE reportes_supervisores
       SET descripcion_limpia = ?,
           nota_taller = ?,
           importante = ?,
           tipo_mantenimiento = ?,
           estado = CASE WHEN ? IN ('PENDIENTE','EN_REVISION') THEN ? ELSE estado END,
           actualizado_en = NOW()
      WHERE id = ?
         AND estado IN ('PENDIENTE','EN_REVISION')`,
      [
        descripcionLimpia,
        nota_taller || null,
        importante === "1" || marcadoRojo ? 1 : 0,
        tipoMantenimiento,
        estado,
        estado,
        req.params.id
      ]
    );
    req.session.success = "Reporte actualizado.";
    res.redirect("/reportes-supervisores");
  } catch (error) {
    console.error("Error editando reporte:", error);
    req.session.error = "Error al editar reporte.";
    res.redirect("/reportes-supervisores");
  }
});

router.post("/:id/limpiar-ia", allowRoles(...ROLES_EDITAR), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    const [[reporte]] = await pool.query("SELECT descripcion_original FROM reportes_supervisores WHERE id = ?", [req.params.id]);
    if (!reporte) {
      req.session.error = "Reporte no encontrado.";
      return res.redirect("/reportes-supervisores");
    }

    await pool.query(
      "UPDATE reportes_supervisores SET descripcion_limpia = ?, actualizado_en = NOW() WHERE id = ?",
      [limpiarTextoReporte(reporte.descripcion_original), req.params.id]
    );
    req.session.success = "Texto limpiado con IA interna.";
    res.redirect("/reportes-supervisores");
  } catch (error) {
    console.error("Error limpiando texto:", error);
    req.session.error = "No se pudo limpiar el texto.";
    res.redirect("/reportes-supervisores");
  }
});

router.post("/:id/cerrar", allowRoles(...ROLES_EDITAR), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    const { motivo } = req.body;
    await pool.query(
      `UPDATE reportes_supervisores
       SET estado = 'HISTORIAL',
           cerrado_por = ?,
           fecha_cierre = NOW(),
           cierre_motivo = ?,
           cierre_confianza = NULL,
           actualizado_en = NOW()
       WHERE id = ?
         AND estado IN ('PENDIENTE','EN_REVISION')`,
      [req.session.user.id, motivo || "Cierre manual por taller/admin", req.params.id]
    );
    req.session.success = "Reporte movido al historial.";
    res.redirect("/reportes-supervisores");
  } catch (error) {
    console.error("Error cerrando reporte:", error);
    req.session.error = "No se pudo cerrar el reporte.";
    res.redirect("/reportes-supervisores");
  }
});

router.post("/:id/eliminar", allowRoles(...ROLES_EDITAR), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    const sedesPermitidas = await obtenerSedesPermitidas(req);
    const params = [req.params.id];
    let sqlReporte = `
      SELECT id
      FROM reportes_supervisores
      WHERE id = ?
        AND estado IN ('PENDIENTE','EN_REVISION')
    `;

    sqlReporte = aplicarFiltroSedes(sqlReporte, params, sedesPermitidas, "reportes_supervisores");
    const [[reporte]] = await pool.query(sqlReporte, params);

    if (!reporte) {
      req.session.error = "Reporte no encontrado o sin permiso para eliminarlo.";
      return res.redirect("/reportes-supervisores");
    }

    await pool.query("DELETE FROM reportes_supervisores_sugerencias WHERE reporte_id = ?", [reporte.id]);
    await pool.query("DELETE FROM reportes_supervisores WHERE id = ?", [reporte.id]);

    req.session.success = "Reporte eliminado.";
    res.redirect("/reportes-supervisores");
  } catch (error) {
    console.error("Error eliminando reporte:", error);
    req.session.error = "No se pudo eliminar el reporte.";
    res.redirect("/reportes-supervisores");
  }
});

router.post("/:id/reabrir", allowRoles(...ROLES_EDITAR), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    await pool.query(
      `UPDATE reportes_supervisores
       SET estado = 'PENDIENTE',
           cerrado_por = NULL,
           fecha_cierre = NULL,
           correctivo_id = NULL,
           cierre_motivo = NULL,
           cierre_confianza = NULL,
           actualizado_en = NOW()
       WHERE id = ?`,
      [req.params.id]
    );
    res.redirect("/reportes-supervisores");
  } catch (error) {
    console.error("Error reabriendo reporte:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/sugerencias/:id/confirmar", allowRoles(...ROLES_EDITAR), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    const [[sugerencia]] = await pool.query(
      `SELECT * FROM reportes_supervisores_sugerencias WHERE id = ? AND estado = 'PENDIENTE'`,
      [req.params.id]
    );
    if (!sugerencia) {
      req.session.error = "Sugerencia no encontrada.";
      return res.redirect("/reportes-supervisores");
    }

    await pool.query(
      `UPDATE reportes_supervisores
       SET estado = 'HISTORIAL',
           cerrado_por = ?,
           fecha_cierre = NOW(),
           correctivo_id = ?,
           cierre_motivo = ?,
           cierre_confianza = ?,
           actualizado_en = NOW()
       WHERE id = ?`,
      [
        req.session.user.id,
        sugerencia.correctivo_id,
        sugerencia.motivo,
        sugerencia.confianza,
        sugerencia.reporte_id
      ]
    );
    await pool.query(
      `UPDATE reportes_supervisores_sugerencias
       SET estado = 'CONFIRMADA', resuelto_por = ?, resuelto_en = NOW()
       WHERE id = ?`,
      [req.session.user.id, req.params.id]
    );
    req.session.success = "Sugerencia confirmada. El reporte pasó a historial.";
    res.redirect("/reportes-supervisores");
  } catch (error) {
    console.error("Error confirmando sugerencia:", error);
    req.session.error = "No se pudo confirmar la sugerencia.";
    res.redirect("/reportes-supervisores");
  }
});

router.post("/sugerencias/:id/descartar", allowRoles(...ROLES_EDITAR), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    await pool.query(
      `UPDATE reportes_supervisores_sugerencias
       SET estado = 'DESCARTADA', resuelto_por = ?, resuelto_en = NOW()
       WHERE id = ?`,
      [req.session.user.id, req.params.id]
    );
    req.session.success = "Sugerencia descartada.";
    res.redirect("/reportes-supervisores");
  } catch (error) {
    console.error("Error descartando sugerencia:", error);
    req.session.error = "No se pudo descartar la sugerencia.";
    res.redirect("/reportes-supervisores");
  }
});

module.exports = router;
