const express = require("express");
const router = express.Router();
const pool = require("../db");
const ExcelJS = require("exceljs");
const {
  ensureReportesSupervisoresTables,
  limpiarTextoReporte
} = require("../utils/reportesSupervisoresDb");
const { agregarTallerParaMecanico } = require("../utils/sedes");
const { agregarFiltroPlacaSql } = require("../utils/placas");
const { normalizarTipoMantenimiento } = require("../utils/tipoMantenimiento");

const ROLES_VER = ["ADMIN", "TALLER", "MECANICO", "SUPERVISOR", "SUPERVISOR_PESADO"];
const ROLES_CREAR = ["ADMIN", "TALLER", "SUPERVISOR", "SUPERVISOR_PESADO"];
const ROLES_EDITAR = ["ADMIN", "TALLER"];

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
      return [req.session.sedeSeleccionada];
    }
    return [];
  }

  const [extras] = await pool.query("SELECT sede FROM usuarios_sedes WHERE usuario_id = ?", [user.id]);
  const sedes = agregarTallerParaMecanico(user, [user.sede, ...extras.map(e => e.sede)]);

  if (req.session.sedeSeleccionada && sedes.includes(req.session.sedeSeleccionada)) {
    return [req.session.sedeSeleccionada];
  }

  return sedes;
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
  const fecha = new Date(`${String(value).slice(0, 10)}T12:00:00`);
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
    sql += " AND rs.sede = ?";
    params.push(sede);
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
    const sedesPermitidas = await obtenerSedesPermitidas(req);
    const { sede, placa, importante, correctivo_id } = req.query;
    const semana = String(req.query.semana || "").trim();
    const semanaReporteFecha = lunesDesdeSemanaInput(semana);
    const { reportes } = await consultarReportesPendientes(req, { sede, placa, importante, semana_reporte: semanaReporteFecha });
    const unidades = await cargarUnidades(req);
    const sugerencias = await obtenerSugerenciasPendientes(sedesPermitidas, correctivo_id || null);
    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("reportes_supervisores", {
      reportes,
      unidades,
      sugerencias,
      user: req.session.user,
      filtros: { sede, placa, importante, correctivo_id, semana },
      semanaDefault: semanaDefaultReporte(),
      puedeCrear: ROLES_CREAR.includes(req.session.user.rol),
      puedeEditar: ROLES_EDITAR.includes(req.session.user.rol),
      renderReporteHtml,
      success,
      error
    });
  } catch (error) {
    console.error("Error cargando reportes de supervisores:", error);
    res.status(500).send("Error interno");
  }
});

router.get("/reporte/excel", allowRoles(...ROLES_VER), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    const { sede, placa, importante } = req.query;
    const semana = String(req.query.semana || "").trim();
    const semanaReporteFecha = lunesDesdeSemanaInput(semana);
    const { reportes } = await consultarReportesPendientes(req, { sede, placa, importante, semana_reporte: semanaReporteFecha });
    const gruposSede = agruparPorSede(reportes);
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
      sql += " AND rs.sede = ?";
      params.push(sede);
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
    if (sedesPermitidas.length && !sedesPermitidas.includes(sede)) {
      req.session.error = "No tiene permiso para reescribir esta sede.";
      return res.redirect("/reportes-supervisores");
    }

    const paramsReportes = [sede];
    let sqlReportes = `SELECT id, descripcion_original
       FROM reportes_supervisores
       WHERE sede = ?
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
    const tipoMantenimiento = normalizarTipoMantenimiento(req.body.tipo_mantenimiento);
    const semanaReporte = lunesDesdeSemanaInput(req.body.semana_reporte) || lunesDesdeSemanaInput(semanaDefaultReporte());
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
    const tipoMantenimiento = normalizarTipoMantenimiento(req.body.tipo_mantenimiento);
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
