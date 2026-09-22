const crypto = require("crypto");
const express = require("express");
const ExcelJS = require("exceljs");
const router = express.Router();
const pool = require("../db");
const {
  getSedesPermitidas,
  expandirSedesOperativasRepuestosAceites,
  sedeOperativaRepuestosAceites,
  esSedeGranel,
  esSedeTransportadoraDetalle
} = require("../utils/sedes");

const ROLES_LAVADO_VER = ["ADMIN", "TALLER", "MECANICO", "SUPERVISOR", "SUPERVISOR_PESADO"];
const ROLES_LAVADO_CREAR = ["ADMIN", "TALLER", "MECANICO", "SUPERVISOR", "SUPERVISOR_PESADO"];
const ROLES_LAVADO_ADMIN = ["ADMIN", "TALLER"];
const SEGMENTOS = ["HINOS", "GRANELES", "OTROS"];
const MAX_FOTO_BASE64_LENGTH = 3 * 1024 * 1024;
const DIA_MS = 24 * 60 * 60 * 1000;

const FOTOS_LAVADO = [
  { clave: "adelante", nombre: "Adelante" },
  { clave: "medio_izquierdo", nombre: "Medio lado izquierdo" },
  { clave: "medio_derecho", nombre: "Medio lado derecho" },
  { clave: "atras", nombre: "Atrás" },
  { clave: "cabina", nombre: "Cabina" }
];

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function esUsuarioMecanicoLimitado(user) {
  const usuario = String(user?.usuario || "").trim().toLowerCase();
  return user?.rol === "MECANICO" ||
    usuario.startsWith("mecanico") ||
    usuario.startsWith("mecanicos");
}

function puedeVerLavado(user) {
  return ROLES_LAVADO_VER.includes(user?.rol) || esUsuarioMecanicoLimitado(user);
}

function puedeCrearLavado(user) {
  return ROLES_LAVADO_CREAR.includes(user?.rol) || esUsuarioMecanicoLimitado(user);
}

function puedeAdministrarLavado(user) {
  return ROLES_LAVADO_ADMIN.includes(user?.rol);
}

function normalizarTexto(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function normalizarPlaca(value) {
  return normalizarTexto(value).replace(/[^A-Z0-9]/g, "");
}

function fechaCostaRica() {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const valor = tipo => partes.find(parte => parte.type === tipo)?.value || "";
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

function fechaUTC(fecha) {
  const match = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) return null;
  return date;
}

function fechaISO(date) {
  return date.toISOString().slice(0, 10);
}

function sumarDias(fecha, dias) {
  const date = fechaUTC(fecha);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + dias);
  return fechaISO(date);
}

function semanaDesdeFecha(fecha) {
  const date = fechaUTC(fecha);
  if (!date) return "";
  const dia = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dia);
  const inicioAnio = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const numero = Math.ceil((((date - inicioAnio) / DIA_MS) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(numero).padStart(2, "0")}`;
}

function limitesSemana(value) {
  const match = String(value || "").match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const anio = Number(match[1]);
  const numero = Number(match[2]);
  if (anio < 2020 || anio > 2100 || numero < 1 || numero > 53) return null;

  const eneroCuatro = new Date(Date.UTC(anio, 0, 4));
  const dia = eneroCuatro.getUTCDay() || 7;
  const lunes = new Date(eneroCuatro);
  lunes.setUTCDate(eneroCuatro.getUTCDate() - dia + 1 + ((numero - 1) * 7));
  const inicio = fechaISO(lunes);
  if (semanaDesdeFecha(inicio) !== `${anio}-W${String(numero).padStart(2, "0")}`) return null;
  return { inicio, fin: sumarDias(inicio, 6) };
}

function normalizarSemana(value) {
  const semana = String(value || "").trim();
  return limitesSemana(semana) ? semana : semanaDesdeFecha(fechaCostaRica());
}

function formatearFecha(fecha) {
  const match = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(fecha || "");
}

function etiquetaSemana(semana) {
  const limites = limitesSemana(semana);
  return limites ? `${formatearFecha(limites.inicio)} al ${formatearFecha(limites.fin)}` : semana;
}

function semanaVecina(semana, dias) {
  const limites = limitesSemana(semana);
  return limites ? semanaDesdeFecha(sumarDias(limites.inicio, dias)) : normalizarSemana();
}

function nombreArchivo(value) {
  return normalizarTexto(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "todas";
}

function cedisLavado(sede) {
  const sedeNormalizada = normalizarTexto(sede);
  if (sedeNormalizada === "TRANSPORTADORA" || esSedeTransportadoraDetalle(sede)) {
    return "Transportadora";
  }
  return sedeOperativaRepuestosAceites(sede) || String(sede || "Sin sede");
}

function segmentoLavado({ sede, negocio, placa } = {}) {
  const sedeNormalizada = normalizarTexto(sede);
  const negocioNormalizado = normalizarTexto(negocio);
  const placaNormalizada = normalizarPlaca(placa);

  if (
    sedeNormalizada === "TRANSPORTADORA" ||
    esSedeTransportadoraDetalle(sede) ||
    sedeNormalizada === "TALLER" ||
    sedeNormalizada === "TECNICOS" ||
    placaNormalizada.startsWith("EE")
  ) return "OTROS";

  if (esSedeGranel(sede) || negocioNormalizado.includes("GRANEL")) return "GRANELES";
  return "HINOS";
}

function sedesLavadoPermitidas(req) {
  const base = getSedesPermitidas(req);
  const user = req.session.user || {};
  const sedeUsuario = String(user.sede || "");

  if (user.rol === "SUPERVISOR" && !esSedeGranel(sedeUsuario)) {
    return [...new Set(expandirSedesOperativasRepuestosAceites(base))];
  }

  return [...new Set(base)];
}

async function ensureLavadoTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lavado_unidades (
      id INT AUTO_INCREMENT PRIMARY KEY,
      numero_lavado VARCHAR(30) NOT NULL UNIQUE,
      unidad_id INT NOT NULL,
      placa VARCHAR(80) NOT NULL,
      sede VARCHAR(100) NOT NULL,
      fecha DATE NOT NULL,
      observaciones TEXT NULL,
      creado_por INT NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_lavado_fecha (fecha),
      INDEX idx_lavado_sede_fecha (sede, fecha),
      INDEX idx_lavado_unidad_fecha (unidad_id, fecha),
      CONSTRAINT fk_lavado_unidad
        FOREIGN KEY (unidad_id) REFERENCES unidades(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lavado_unidades_fotos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lavado_id INT NOT NULL,
      angulo_clave VARCHAR(80) NOT NULL,
      angulo_nombre VARCHAR(120) NOT NULL,
      foto_nombre VARCHAR(255) NULL,
      foto_tipo VARCHAR(100) NULL,
      foto_base64 LONGTEXT NOT NULL,
      foto_hash CHAR(64) NOT NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_lavado_foto_hash (foto_hash),
      INDEX idx_lavado_fotos_lavado (lavado_id),
      CONSTRAINT fk_lavado_fotos_lavado
        FOREIGN KEY (lavado_id) REFERENCES lavado_unidades(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

function normalizarFotoBase64(value) {
  return String(value || "").trim();
}

function hashFoto(fotoBase64) {
  return crypto.createHash("sha256").update(normalizarFotoBase64(fotoBase64)).digest("hex");
}

async function siguienteNumeroLavado(connection, fecha) {
  const year = String(fecha || fechaCostaRica()).slice(0, 4);
  const [[row]] = await connection.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(numero_lavado, '-', -1) AS UNSIGNED)), 0) + 1 AS siguiente
     FROM lavado_unidades
     WHERE numero_lavado LIKE ?`,
    [`LAV-${year}-%`]
  );
  return `LAV-${year}-${String(Number(row.siguiente || 1)).padStart(4, "0")}`;
}

async function cargarUnidades(req) {
  const sedesPermitidas = sedesLavadoPermitidas(req);
  const [rows] = await pool.query(
    `SELECT id, placa, sede, marca, modelo, anio, negocio
     FROM unidades
     WHERE sede IN (?) AND COALESCE(activa, 1) = 1
     ORDER BY sede, placa`,
    [sedesPermitidas]
  );

  return rows.map(unidad => ({
    ...unidad,
    cedis: cedisLavado(unidad.sede),
    segmento: segmentoLavado(unidad)
  }));
}

function filtrarPorPlaca(items, placa) {
  const filtro = normalizarPlaca(placa);
  if (!filtro) return items;
  return items.filter(item => normalizarPlaca(item.placa).includes(filtro));
}

async function obtenerPanelSemanal(req) {
  await ensureLavadoTables();
  const semana = normalizarSemana(req.query.semana);
  const limites = limitesSemana(semana);
  const sedesPermitidas = sedesLavadoPermitidas(req);
  const unidades = await cargarUnidades(req);
  const sedes = [...new Set(unidades.map(unidad => unidad.cedis))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "es"));

  const sedeSolicitada = String(req.query.sede || "TODAS").trim();
  const sede = sedeSolicitada !== "TODAS" && sedes.includes(sedeSolicitada) ? sedeSolicitada : "TODAS";
  const segmentoSolicitado = normalizarTexto(req.query.segmento || "TODOS");
  const segmento = SEGMENTOS.includes(segmentoSolicitado) ? segmentoSolicitado : "TODOS";
  const placa = String(req.query.placa || "").trim();
  const supervisorSolicitado = String(req.query.supervisor || "TODOS").trim();
  const puedeFiltrarSupervisor = puedeAdministrarLavado(req.session.user);

  const [lavadosRows] = await pool.query(
    `SELECT
       lu.id,
       lu.numero_lavado,
       lu.unidad_id,
       lu.placa,
       lu.sede,
       DATE_FORMAT(lu.fecha, '%Y-%m-%d') AS fecha_iso,
       DATE_FORMAT(lu.fecha, '%d/%m/%Y') AS fecha_formato,
       lu.observaciones,
       lu.creado_por,
       DATE_FORMAT(lu.creado_en, '%d/%m/%Y %H:%i') AS creado_formato,
       us.nombre AS creado_por_nombre,
       us.usuario AS creado_por_usuario,
       u.marca,
       u.modelo,
       u.anio,
       u.negocio,
       COALESCE(foto_resumen.fotos_total, 0) AS fotos_total
     FROM lavado_unidades lu
     LEFT JOIN usuarios us ON us.id = lu.creado_por
     LEFT JOIN unidades u ON u.id = lu.unidad_id
     LEFT JOIN (
       SELECT lavado_id, COUNT(*) AS fotos_total
       FROM lavado_unidades_fotos
       GROUP BY lavado_id
     ) foto_resumen ON foto_resumen.lavado_id = lu.id
     WHERE lu.sede IN (?) AND lu.fecha BETWEEN ? AND ?
     ORDER BY lu.fecha DESC, lu.creado_en DESC`,
    [sedesPermitidas, limites.inicio, limites.fin]
  );

  const lavadosBase = lavadosRows.map(lavado => ({
    ...lavado,
    cedis: cedisLavado(lavado.sede),
    segmento: segmentoLavado(lavado)
  }));

  const supervisores = [...new Map(
    lavadosBase
      .filter(lavado => lavado.creado_por)
      .map(lavado => [String(lavado.creado_por), {
        id: String(lavado.creado_por),
        nombre: lavado.creado_por_nombre || lavado.creado_por_usuario || "Sin nombre"
      }])
  ).values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const supervisor = puedeFiltrarSupervisor && supervisores.some(item => item.id === supervisorSolicitado)
    ? supervisorSolicitado
    : "TODOS";

  const coincideSede = item => sede === "TODAS" || item.cedis === sede;
  const coincideSegmento = item => segmento === "TODOS" || item.segmento === segmento;
  const coincideSupervisor = item => supervisor === "TODOS" || String(item.creado_por) === supervisor;

  const unidadesPorSedeYPlaca = filtrarPorPlaca(unidades.filter(coincideSede), placa);
  const unidadesFiltradas = unidadesPorSedeYPlaca.filter(coincideSegmento);
  const lavadosPorSedeYPlaca = filtrarPorPlaca(lavadosBase.filter(coincideSede).filter(coincideSupervisor), placa);
  const lavados = lavadosPorSedeYPlaca.filter(coincideSegmento);

  const fotosPorLavado = {};
  if (lavados.length) {
    const [fotos] = await pool.query(
      `SELECT id, lavado_id, angulo_clave, angulo_nombre
       FROM lavado_unidades_fotos
       WHERE lavado_id IN (?)
       ORDER BY id ASC`,
      [lavados.map(item => item.id)]
    );
    fotos.forEach(foto => {
      if (!fotosPorLavado[foto.lavado_id]) fotosPorLavado[foto.lavado_id] = [];
      fotosPorLavado[foto.lavado_id].push(foto);
    });
  }

  const idsLavados = new Set(lavados.map(item => Number(item.unidad_id)));
  const unidadesNoLavadas = unidadesFiltradas.filter(unidad => !idsLavados.has(Number(unidad.id)));
  const lavadas = unidadesFiltradas.length - unidadesNoLavadas.length;
  const cumplimiento = unidadesFiltradas.length
    ? Math.round((lavadas / unidadesFiltradas.length) * 1000) / 10
    : 0;

  const resumenSegmentos = SEGMENTOS.map(nombre => {
    const esperadas = unidadesPorSedeYPlaca.filter(unidad => unidad.segmento === nombre);
    const ids = new Set(
      lavadosPorSedeYPlaca
        .filter(lavado => lavado.segmento === nombre)
        .map(lavado => Number(lavado.unidad_id))
    );
    const totalLavadas = esperadas.filter(unidad => ids.has(Number(unidad.id))).length;
    return {
      nombre,
      total: esperadas.length,
      lavadas: totalLavadas,
      pendientes: Math.max(esperadas.length - totalLavadas, 0),
      cumplimiento: esperadas.length ? Math.round((totalLavadas / esperadas.length) * 100) : 0
    };
  });

  return {
    semana,
    semanaAnterior: semanaVecina(semana, -7),
    semanaSiguiente: semanaVecina(semana, 7),
    limites,
    etiquetaPeriodo: etiquetaSemana(semana),
    sedes,
    supervisores,
    filtros: { semana, sede, segmento, placa, supervisor },
    unidades: unidadesFiltradas,
    lavados,
    fotosPorLavado,
    unidadesNoLavadas,
    resumenSegmentos,
    metricas: {
      unidades: unidadesFiltradas.length,
      lavadas,
      pendientes: unidadesNoLavadas.length,
      cumplimiento
    },
    puedeCrear: puedeCrearLavado(req.session.user),
    puedeFiltrarSupervisor
  };
}

function redirectNuevoConError(res, fecha, error) {
  const semana = semanaDesdeFecha(fecha) || normalizarSemana();
  return res.redirect(`/lavado-unidades/nuevo?semana=${encodeURIComponent(semana)}&error=${encodeURIComponent(error)}`);
}

router.use(requireAuth);

router.use((req, res, next) => {
  if (!puedeVerLavado(req.session.user)) return res.status(403).send("No autorizado");
  next();
});

router.get("/", async (req, res) => {
  try {
    const panel = await obtenerPanelSemanal(req);
    res.render("lavado_unidades/index", {
      ...panel,
      success: req.query.success || "",
      error: req.query.error || "",
      user: req.session.user
    });
  } catch (error) {
    console.error("ERROR panel semanal lavado unidades:", error);
    res.status(500).send("Error interno");
  }
});

router.get("/fotos/:id", async (req, res) => {
  try {
    const fotoId = Number(req.params.id);
    if (!Number.isInteger(fotoId) || fotoId <= 0) return res.sendStatus(404);

    const [[foto]] = await pool.query(
      `SELECT lf.foto_base64, lf.foto_tipo, lu.sede
       FROM lavado_unidades_fotos lf
       JOIN lavado_unidades lu ON lu.id = lf.lavado_id
       WHERE lf.id = ?
       LIMIT 1`,
      [fotoId]
    );

    if (!foto || !sedesLavadoPermitidas(req).includes(foto.sede)) return res.sendStatus(404);

    const contenido = String(foto.foto_base64 || "");
    const dataUrl = contenido.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
    const mime = dataUrl?.[1] || (String(foto.foto_tipo || "").startsWith("image/") ? foto.foto_tipo : "image/jpeg");
    const base64 = dataUrl?.[2] || contenido;
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length) return res.sendStatus(404);

    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buffer);
  } catch (error) {
    console.error("ERROR mostrando foto de lavado:", error);
    res.sendStatus(500);
  }
});

router.get("/nuevo", async (req, res) => {
  try {
    await ensureLavadoTables();
    if (!puedeCrearLavado(req.session.user)) return res.redirect("/lavado-unidades");

    const semana = normalizarSemana(req.query.semana);
    const limites = limitesSemana(semana);
    const hoy = fechaCostaRica();
    const todasUnidades = await cargarUnidades(req);
    const sedes = [...new Set(todasUnidades.map(unidad => unidad.cedis))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "es"));
    const sedeSolicitada = String(req.query.sede || "TODAS").trim();
    const sede = sedeSolicitada !== "TODAS" && sedes.includes(sedeSolicitada) ? sedeSolicitada : "TODAS";
    const segmentoSolicitado = normalizarTexto(req.query.segmento || "TODOS");
    const segmento = SEGMENTOS.includes(segmentoSolicitado) ? segmentoSolicitado : "TODOS";

    let unidades = todasUnidades.filter(unidad => sede === "TODAS" || unidad.cedis === sede);
    unidades = unidades.filter(unidad => segmento === "TODOS" || unidad.segmento === segmento);

    const [lavadas] = await pool.query(
      `SELECT unidad_id
       FROM lavado_unidades
       WHERE sede IN (?) AND fecha BETWEEN ? AND ?`,
      [sedesLavadoPermitidas(req), limites.inicio, limites.fin]
    );
    const idsLavados = new Set(lavadas.map(item => Number(item.unidad_id)));
    unidades = unidades.filter(unidad => !idsLavados.has(Number(unidad.id)));

    const puedeRegistrarSemana = limites.inicio <= hoy;
    const fechaMaxima = limites.fin < hoy ? limites.fin : hoy;
    const fechaPredeterminada = hoy >= limites.inicio && hoy <= limites.fin ? hoy : limites.inicio;

    res.render("lavado_unidades/nuevo", {
      unidades,
      fotos: FOTOS_LAVADO,
      semana,
      etiquetaPeriodo: etiquetaSemana(semana),
      fechaMinima: limites.inicio,
      fechaMaxima,
      fechaPredeterminada,
      puedeRegistrarSemana,
      filtros: { sede, segmento },
      error: req.query.error || "",
      user: req.session.user
    });
  } catch (error) {
    console.error("ERROR form lavado unidades:", error);
    res.status(500).send("Error interno");
  }
});

router.get("/exportar", async (req, res) => {
  try {
    const panel = await obtenerPanelSemanal(req);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Tomza Mantenimiento";
    workbook.created = new Date();

    const resumen = workbook.addWorksheet("Resumen");
    resumen.columns = [{ width: 28 }, { width: 24 }];
    resumen.addRows([
      ["LAVADO SEMANAL DE UNIDADES", ""],
      ["Semana", panel.semana],
      ["Periodo", panel.etiquetaPeriodo],
      ["CEDIS", panel.filtros.sede],
      ["Segmento", panel.filtros.segmento],
      ["Unidades esperadas", panel.metricas.unidades],
      ["Lavadas", panel.metricas.lavadas],
      ["Pendientes", panel.metricas.pendientes],
      ["Cumplimiento", `${panel.metricas.cumplimiento}%`]
    ]);
    resumen.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 14 };
    resumen.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123B7A" } };
    resumen.getColumn(1).font = { bold: true };

    const lavadas = workbook.addWorksheet("Lavadas");
    lavadas.columns = [
      { header: "Orden", key: "orden", width: 18 },
      { header: "Fecha", key: "fecha", width: 14 },
      { header: "CEDIS", key: "cedis", width: 20 },
      { header: "Segmento", key: "segmento", width: 14 },
      { header: "Placa", key: "placa", width: 16 },
      { header: "Marca", key: "marca", width: 18 },
      { header: "Modelo", key: "modelo", width: 22 },
      { header: "Registrado por", key: "usuario", width: 28 },
      { header: "Capturado", key: "capturado", width: 20 },
      { header: "Fotos", key: "fotos", width: 10 },
      { header: "Observaciones", key: "observaciones", width: 45 }
    ];
    panel.lavados.forEach(item => lavadas.addRow({
      orden: item.numero_lavado,
      fecha: item.fecha_formato,
      cedis: item.cedis,
      segmento: item.segmento,
      placa: item.placa,
      marca: item.marca || "",
      modelo: item.modelo || "",
      usuario: item.creado_por_nombre || item.creado_por_usuario || "",
      capturado: item.creado_formato,
      fotos: Number(item.fotos_total || 0),
      observaciones: item.observaciones || ""
    }));

    const pendientes = workbook.addWorksheet("No lavadas");
    pendientes.columns = [
      { header: "CEDIS", key: "cedis", width: 20 },
      { header: "Segmento", key: "segmento", width: 14 },
      { header: "Placa", key: "placa", width: 16 },
      { header: "Sede registrada", key: "sede", width: 22 },
      { header: "Marca", key: "marca", width: 18 },
      { header: "Modelo", key: "modelo", width: 22 },
      { header: "Año", key: "anio", width: 10 }
    ];
    panel.unidadesNoLavadas.forEach(item => pendientes.addRow(item));

    [lavadas, pendientes].forEach(sheet => {
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123B7A" } };
      sheet.eachRow(row => { row.alignment = { vertical: "middle", wrapText: true }; });
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=lavados_${panel.semana}_${nombreArchivo(panel.filtros.sede)}.xlsx`
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("ERROR exportando lavado semanal:", error);
    res.status(500).send("No fue posible generar el archivo.");
  }
});

router.post("/", async (req, res) => {
  let connection;
  const fecha = String(req.body.fecha || "").trim();

  try {
    await ensureLavadoTables();
    if (!puedeCrearLavado(req.session.user)) return res.status(403).send("No autorizado para crear lavados.");

    const unidadId = Number.parseInt(req.body.unidad_id, 10);
    const observaciones = String(req.body.observaciones || "").trim() || null;
    if (!unidadId) return redirectNuevoConError(res, fecha, "Debe seleccionar una unidad de la lista.");
    if (!fechaUTC(fecha)) return redirectNuevoConError(res, fecha, "Debe colocar una fecha válida.");
    if (fecha > fechaCostaRica()) return redirectNuevoConError(res, fecha, "No puede registrar un lavado con fecha futura.");

    const [[unidad]] = await pool.query(
      `SELECT id, placa, sede, marca, modelo, anio, negocio
       FROM unidades
       WHERE id = ? AND COALESCE(activa, 1) = 1
       LIMIT 1`,
      [unidadId]
    );

    if (!unidad || !sedesLavadoPermitidas(req).includes(unidad.sede)) {
      return redirectNuevoConError(res, fecha, "No está autorizado para registrar esa unidad.");
    }

    const semana = semanaDesdeFecha(fecha);
    const limites = limitesSemana(semana);
    const [[lavadoExistente]] = await pool.query(
      `SELECT numero_lavado
       FROM lavado_unidades
       WHERE unidad_id = ? AND fecha BETWEEN ? AND ?
       LIMIT 1`,
      [unidadId, limites.inicio, limites.fin]
    );
    if (lavadoExistente) {
      return redirectNuevoConError(
        res,
        fecha,
        `${unidad.placa} ya fue registrada esta semana en ${lavadoExistente.numero_lavado}.`
      );
    }

    const fotosBase64 = req.body.fotos_base64 || {};
    const fotosNombre = req.body.fotos_nombre || {};
    const fotosTipo = req.body.fotos_tipo || {};
    const fotos = FOTOS_LAVADO.map(item => {
      const fotoBase64 = normalizarFotoBase64(fotosBase64[item.clave]);
      return {
        ...item,
        foto_base64: fotoBase64,
        foto_nombre: String(fotosNombre[item.clave] || "").trim() || `lavado_${item.clave}.jpg`,
        foto_tipo: String(fotosTipo[item.clave] || "").trim() || "image/jpeg",
        foto_hash: fotoBase64 ? hashFoto(fotoBase64) : ""
      };
    });

    const faltantes = fotos.filter(foto => !foto.foto_base64);
    if (faltantes.length) {
      return redirectNuevoConError(res, fecha, `Debe subir foto de: ${faltantes.map(foto => foto.nombre).join(", ")}.`);
    }

    const fotoInvalida = fotos.some(foto =>
      !String(foto.foto_tipo || "").startsWith("image/") ||
      !/^data:image\/[a-z0-9.+-]+;base64,/i.test(foto.foto_base64) ||
      foto.foto_base64.length > MAX_FOTO_BASE64_LENGTH
    );
    if (fotoInvalida) {
      return redirectNuevoConError(res, fecha, "Una foto no es válida o es demasiado grande.");
    }

    const hashes = fotos.map(foto => foto.foto_hash);
    if (new Set(hashes).size !== hashes.length) {
      return redirectNuevoConError(res, fecha, "Hay fotos repetidas dentro de este mismo lavado.");
    }

    const [duplicadas] = await pool.query(
      `SELECT lu.numero_lavado, lu.placa, DATE_FORMAT(lu.fecha, '%d/%m/%Y') AS fecha_formato
       FROM lavado_unidades_fotos lf
       JOIN lavado_unidades lu ON lu.id = lf.lavado_id
       WHERE lf.foto_hash IN (?)
       LIMIT 1`,
      [hashes]
    );
    if (duplicadas.length) {
      const duplicada = duplicadas[0];
      return redirectNuevoConError(
        res,
        fecha,
        `Una foto ya fue usada en ${duplicada.numero_lavado} (${duplicada.placa}, ${duplicada.fecha_formato}). Tome una foto nueva.`
      );
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const numeroLavado = await siguienteNumeroLavado(connection, fecha);
    const [result] = await connection.query(
      `INSERT INTO lavado_unidades
       (numero_lavado, unidad_id, placa, sede, fecha, observaciones, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [numeroLavado, unidad.id, unidad.placa, unidad.sede, fecha, observaciones, req.session.user.id || null]
    );

    for (const foto of fotos) {
      await connection.query(
        `INSERT INTO lavado_unidades_fotos
         (lavado_id, angulo_clave, angulo_nombre, foto_nombre, foto_tipo, foto_base64, foto_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          result.insertId,
          foto.clave,
          foto.nombre,
          foto.foto_nombre,
          foto.foto_tipo,
          foto.foto_base64,
          foto.foto_hash
        ]
      );
    }

    await connection.commit();
    const params = new URLSearchParams({
      semana,
      sede: String(req.body.sede_retorno || "TODAS"),
      segmento: String(req.body.segmento_retorno || "TODOS"),
      success: `Orden ${numeroLavado} guardada correctamente.`
    });
    res.redirect(`/lavado-unidades?${params.toString()}`);
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") {
      const mensaje = String(error.message || "").includes("uq_lavado_unidad_semana")
        ? "Esa unidad ya tiene un lavado registrado en la semana seleccionada."
        : "Una de las fotos ya existe en un lavado anterior. Tome fotos nuevas.";
      return redirectNuevoConError(res, fecha, mensaje);
    }
    console.error("ERROR guardar lavado unidades:", error);
    res.status(500).send("Error interno");
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
