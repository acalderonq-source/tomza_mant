const express = require("express");
const router = express.Router();
const pool = require("../db");
const calcularPuntos = require("../utils/puntajeCorrectivos");
const ExcelJS = require("exceljs");
const {
  ensureReportesSupervisoresTables,
  registrarSugerenciasParaCorrectivo
} = require("../utils/reportesSupervisoresDb");
const { SEDES_GRANEL, esUsuarioTodasSedes, etiquetaSede, getSedesPermitidas } = require("../utils/sedes");
const { agregarFiltroPlacaSql } = require("../utils/placas");

// =====================================================
// MIDDLEWARE DE AUTENTICACIÓN
// =====================================================
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

// =====================================================
// OBTENER SEDE SEGÚN USUARIO
// =====================================================
function obtenerSedeFiltro(req) {
  if (!req.session.user) return null;
  if (esUsuarioTodasSedes(req.session.user)) {
    if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS")
      return req.session.sedeSeleccionada;
    return null;
  }
  return req.session.sedeSeleccionada || req.session.user.sede || null;
}

function puedeReprogramarMantenimientos(user) {
  return ["ADMIN", "TALLER"].includes(user.rol);
}

function obtenerFiltroMecanicosPorSede(sedeFiltro, soloIds = false) {
  let sql = soloIds
    ? "SELECT id FROM mecanicos WHERE activo = 1"
    : "SELECT id, nombre FROM mecanicos WHERE activo = 1";
  const params = [];
  const sede = String(sedeFiltro || "").trim();
  const sedeUpper = sede.toUpperCase();
  const esGranel = SEDES_GRANEL.some(s => s.toUpperCase() === sedeUpper) || sedeUpper.includes("GRANEL");

  if (sedeUpper === "TRANSPORTADORA" || esGranel) {
    sql += " AND sede IN (?)";
    params.push(["Transportadora", ...SEDES_GRANEL]);
  } else if (sede) {
    sql += " AND sede = ?";
    params.push(sede);
  }

  sql += " ORDER BY nombre";
  return { sql, params };
}

const FAMILIAS_MANTENIMIENTO = [
  {
    clave: "frenos_seguridad",
    nombre: "Frenos y seguridad",
    color: "#dc2626",
    palabras: [
      "freno", "frenos", "fibra", "fibras", "clutch", "embrague", "direccion",
      "dirección", "pito", "alarma", "seguridad", "bomba hidraulica", "bomba hidráulica"
    ]
  },
  {
    clave: "motor_transmision",
    nombre: "Motor y transmisión",
    color: "#ea580c",
    palabras: [
      "motor", "caja", "transmision", "transmisión", "inyector", "turbo", "arrancador",
      "alternador", "compresor", "bomba", "fuga de aire", "manguera", "sensor", "tacometro", "tacómetro"
    ]
  },
  {
    clave: "aceites_fluidos",
    nombre: "Aceites y fluidos",
    color: "#0f766e",
    palabras: [
      "aceite", "aceites", "engrase", "engrasar", "hidraulico", "hidráulico", "agua",
      "radiador", "coolant", "liquido", "líquido", "filtro", "filtros", "nivel"
    ]
  },
  {
    clave: "electrico_luces",
    nombre: "Eléctrico y luces",
    color: "#2563eb",
    palabras: [
      "luz", "luces", "electrico", "eléctrico", "bateria", "batería", "baterias", "baterías",
      "corto", "cable", "cables", "marcha", "direccional", "tablero", "velocimetro", "velocímetro"
    ]
  },
  {
    clave: "llantas_carroceria",
    nombre: "Llantas, carrocería y otros",
    color: "#6d28d9",
    palabras: [
      "llanta", "llantas", "aro", "aros", "rotulacion", "rotulación", "calcomania",
      "calcomanía", "cabina", "puerta", "bumper", "golpe", "cajon", "cajón", "asiento",
      "escobilla", "parabrisas", "lamina", "lámina", "pintar", "pintura"
    ]
  }
];

const SEDES_CILINDREROS = [
  "ALAJUELA",
  "CARTAGO",
  "GUAPILES",
  "LA CRUZ",
  "NICOYA",
  "OROTINA",
  "PEREZ ZELEDON",
  "RIO CLARO",
  "SAN CARLOS"
];

const ORDEN_NEGOCIOS_MANTENIMIENTO = ["TRANSPORTADORA", "CILINDREROS", "GRANELES", "OTROS"];
const SUBGRUPOS_BASE_MANTENIMIENTO = {
  TRANSPORTADORA: ["Cabezales", "Cisternas y carretas"],
  CILINDREROS: ["Alajuela", "Cartago", "Guapiles", "La Cruz", "Nicoya", "Orotina", "Perez Zeledon", "Rio Claro", "San Carlos"],
  GRANELES: SEDES_GRANEL.map(sede => etiquetaSede(sede)),
  OTROS: ["Taller", "Tecnicos", "Otros"]
};

function normalizarTextoIA(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizarClaveNegocio(texto) {
  return normalizarTextoIA(texto).toUpperCase().replace(/\s+/g, " ").trim();
}

function recortarTexto(texto, limite = 220) {
  const limpio = String(texto || "")
    .replace(/\s*\|\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limpio) return "-";
  return limpio.length > limite ? `${limpio.slice(0, limite - 3)}...` : limpio;
}

function dividirTrabajosMantenimiento(texto) {
  const limpio = String(texto || "")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/\r?\n+/g, " | ")
    .replace(/\b\d+\s*[\).:-]\s*/g, " | ")
    .replace(/\s+/g, " ")
    .trim();

  if (!limpio) return [];

  const partes = limpio
    .split(/\s+\|\s+|;|,(?=\s*[a-zA-ZÁÉÍÓÚáéíóúÑñ])/)
    .map(parte => parte.replace(/^[-.:,\s]+|[-.:,\s]+$/g, "").trim())
    .filter(parte => parte.length >= 3);

  return partes.length ? partes : [limpio];
}

function obtenerFamiliaConPuntaje(texto) {
  const normalizado = normalizarTextoIA(texto);
  let mejorFamilia = FAMILIAS_MANTENIMIENTO[FAMILIAS_MANTENIMIENTO.length - 1];
  let mejorPuntaje = 0;

  for (const familia of FAMILIAS_MANTENIMIENTO) {
    const puntaje = familia.palabras.reduce((total, palabra) => {
      const palabraNormalizada = normalizarTextoIA(palabra);
      if (!normalizado.includes(palabraNormalizada)) return total;
      return total + (palabraNormalizada.includes(" ") ? 3 : 1);
    }, 0);

    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejorFamilia = familia;
    }
  }

  return { familia: mejorFamilia, puntaje: mejorPuntaje };
}

function clasificarFamiliaMantenimiento(texto) {
  return obtenerFamiliaConPuntaje(texto).familia;
}

function analizarFamiliasMantenimiento(texto) {
  const trabajos = dividirTrabajosMantenimiento(texto);
  const resumen = new Map();

  for (const trabajo of trabajos) {
    const { familia, puntaje } = obtenerFamiliaConPuntaje(trabajo);
    const clasificado = {
      texto: recortarTexto(trabajo, 180),
      familiaClave: familia.clave,
      familiaNombre: familia.nombre,
      familiaColor: familia.color,
      puntaje
    };

    if (!resumen.has(familia.clave)) {
      resumen.set(familia.clave, {
        clave: familia.clave,
        nombre: familia.nombre,
        color: familia.color,
        cantidad: 0,
        trabajos: []
      });
    }

    const grupo = resumen.get(familia.clave);
    grupo.cantidad += 1;
    grupo.trabajos.push(clasificado);
  }

  const familias = [...resumen.values()].sort((a, b) => b.cantidad - a.cantidad);
  const principal = familias[0]
    ? FAMILIAS_MANTENIMIENTO.find(f => f.clave === familias[0].clave)
    : FAMILIAS_MANTENIMIENTO[FAMILIAS_MANTENIMIENTO.length - 1];

  return {
    principal,
    familias,
    trabajosClasificados: familias.flatMap(familia => familia.trabajos)
  };
}

function crearResumenFamilias() {
  return FAMILIAS_MANTENIMIENTO.map(familia => ({
    ...familia,
    total: 0,
    preventivos: [],
    correctivos: []
  }));
}

function prepararItemMantenimiento(row, tipoRegistro) {
  const textoBase = tipoRegistro === "PREVENTIVO"
    ? [row.ejecucion, row.plan, row.pendiente, row.tipo].filter(Boolean).join(" ")
    : [row.trabajo_realizado, row.trabajos_detalle, row.repuestos, row.pendiente].filter(Boolean).join(" ");
  const analisisFamilias = analizarFamiliasMantenimiento(textoBase);
  const familia = analisisFamilias.principal;
  const sedeEtiqueta = etiquetaSede(row.sede);

  return {
    id: row.id,
    tipoRegistro,
    familiaClave: familia.clave,
    familiaNombre: familia.nombre,
    familiaColor: familia.color,
    placa: row.placa,
    sede: row.sede,
    sedeEtiqueta,
    fecha: row.fecha_formato || "-",
    estado: row.estado || (tipoRegistro === "CORRECTIVO" ? "CERRADO" : "-"),
    mecanicos: row.mecanicos || "-",
    detalle: recortarTexto(textoBase),
    familiasDetectadas: analisisFamilias.familias,
    trabajosClasificados: analisisFamilias.trabajosClasificados
  };
}

function obtenerNegocioMantenimiento(item) {
  const sede = normalizarClaveNegocio(item.sede);
  const placa = String(item.placa || "").toUpperCase().replace(/\s+/g, "");

  if (sede.includes("GRANEL")) {
    return {
      grupo: "GRANELES",
      subgrupo: item.sedeEtiqueta || "Granel"
    };
  }

  if (sede === "TRANSPORTADORA") {
    return {
      grupo: "TRANSPORTADORA",
      subgrupo: placa.startsWith("S") ? "Cisternas y carretas" : "Cabezales"
    };
  }

  if (SEDES_CILINDREROS.includes(sede)) {
    return {
      grupo: "CILINDREROS",
      subgrupo: item.sedeEtiqueta || item.sede || "Sin sede"
    };
  }

  return {
    grupo: "OTROS",
    subgrupo: item.sedeEtiqueta || item.sede || "Sin sede"
  };
}

function agruparPorNegocio(items) {
  const grupos = new Map();

  for (const nombre of ORDEN_NEGOCIOS_MANTENIMIENTO) {
    const subgrupos = new Map();
    for (const subgrupo of SUBGRUPOS_BASE_MANTENIMIENTO[nombre] || []) {
      subgrupos.set(subgrupo, {
        nombre: subgrupo,
        total: 0,
        preventivos: 0,
        correctivos: 0,
        placas: new Map()
      });
    }

    grupos.set(nombre, {
      nombre,
      total: 0,
      preventivos: 0,
      correctivos: 0,
      subgrupos
    });
  }

  for (const item of items) {
    const negocio = obtenerNegocioMantenimiento(item);
    if (!grupos.has(negocio.grupo)) {
      grupos.set(negocio.grupo, {
        nombre: negocio.grupo,
        total: 0,
        preventivos: 0,
        correctivos: 0,
        subgrupos: new Map()
      });
    }

    const grupo = grupos.get(negocio.grupo);
    grupo.total += 1;
    if (item.tipoRegistro === "PREVENTIVO") grupo.preventivos += 1;
    if (item.tipoRegistro === "CORRECTIVO") grupo.correctivos += 1;

    if (!grupo.subgrupos.has(negocio.subgrupo)) {
      grupo.subgrupos.set(negocio.subgrupo, {
        nombre: negocio.subgrupo,
        total: 0,
        preventivos: 0,
        correctivos: 0,
        placas: new Map()
      });
    }

    const subgrupo = grupo.subgrupos.get(negocio.subgrupo);
    subgrupo.total += 1;
    if (item.tipoRegistro === "PREVENTIVO") subgrupo.preventivos += 1;
    if (item.tipoRegistro === "CORRECTIVO") subgrupo.correctivos += 1;

    if (!subgrupo.placas.has(item.placa)) {
      subgrupo.placas.set(item.placa, {
        placa: item.placa,
        sedeEtiqueta: item.sedeEtiqueta,
        total: 0,
        preventivos: 0,
        correctivos: 0,
        items: []
      });
    }

    const placa = subgrupo.placas.get(item.placa);
    placa.total += 1;
    if (item.tipoRegistro === "PREVENTIVO") placa.preventivos += 1;
    if (item.tipoRegistro === "CORRECTIVO") placa.correctivos += 1;
    placa.items.push(item);
  }

  return [...grupos.values()]
    .map(grupo => ({
      ...grupo,
      subgrupos: [...grupo.subgrupos.values()]
        .map(subgrupo => ({
          ...subgrupo,
          placas: [...subgrupo.placas.values()]
            .sort((a, b) => String(a.placa).localeCompare(String(b.placa), "es"))
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    }));
}

function agruparDashboardMantenimientos(preventivosRows, correctivosRows) {
  const familias = crearResumenFamilias();
  const familiasPorClave = new Map(familias.map(f => [f.clave, f]));
  const preventivos = preventivosRows.map(row => prepararItemMantenimiento(row, "PREVENTIVO"));
  const correctivos = correctivosRows.map(row => prepararItemMantenimiento(row, "CORRECTIVO"));
  const items = [...preventivos, ...correctivos];

  for (const item of preventivos) {
    const familiasItem = item.familiasDetectadas?.length ? item.familiasDetectadas : [{ clave: item.familiaClave }];
    for (const familiaItem of familiasItem) {
      const familia = familiasPorClave.get(familiaItem.clave);
      if (!familia) continue;
      familia.total += 1;
      familia.preventivos.push(item);
    }
  }

  for (const item of correctivos) {
    const familiasItem = item.familiasDetectadas?.length ? item.familiasDetectadas : [{ clave: item.familiaClave }];
    for (const familiaItem of familiasItem) {
      const familia = familiasPorClave.get(familiaItem.clave);
      if (!familia) continue;
      familia.total += 1;
      familia.correctivos.push(item);
    }
  }

  const total = items.length;
  const familiaPrincipal = [...familias].sort((a, b) => b.total - a.total)[0] || null;

  return {
    total,
    preventivos,
    correctivos,
    familias,
    familiaPrincipal,
    negocios: agruparPorNegocio(items)
  };
}

function aplicarFiltroSedesDashboard(req, condiciones, params, aliasUnidad = "u") {
  const user = req.session.user;
  const sedeQuery = String(req.query.sede || "").trim();
  const sedesPermitidas = getSedesPermitidas(req).filter(Boolean);
  const usuarioTodas = esUsuarioTodasSedes(user);

  if (sedeQuery && sedeQuery !== "TODAS" && (usuarioTodas || sedesPermitidas.includes(sedeQuery))) {
    condiciones.push(`${aliasUnidad}.sede = ?`);
    params.push(sedeQuery);
    return sedeQuery;
  }

  if (!usuarioTodas && sedesPermitidas.length) {
    condiciones.push(`${aliasUnidad}.sede IN (?)`);
    params.push(sedesPermitidas);
  }

  return "TODAS";
}

async function unidadColumnExists(columnName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'unidades'
       AND COLUMN_NAME = ?`,
    [columnName]
  );
  return Number(row.count) > 0;
}

async function ensureUnidadEstadoColumns() {
  const columns = [
    ["activa", "TINYINT(1) NOT NULL DEFAULT 1"],
    ["varada", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["razon_varada", "TEXT NULL"]
  ];

  for (const [column, definition] of columns) {
    if (!(await unidadColumnExists(column))) {
      await pool.query(`ALTER TABLE unidades ADD COLUMN ${column} ${definition}`);
    }
  }
}

function redirectMantenimientos(req, res) {
  const returnTo = String(req.body.return_to || "");
  if (returnTo.startsWith("/mantenimientos")) {
    return res.redirect(returnTo);
  }
  return res.redirect("/mantenimientos");
}

function obtenerIdsMantenimiento(value) {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map(id => String(id)).filter(id => /^\d+$/.test(id)))];
}

function obtenerValoresSeleccionados(body) {
  const seleccion = body.mecanicos !== undefined ? body.mecanicos : body["mecanicos[]"];
  if (seleccion === undefined) return [];
  if (Array.isArray(seleccion)) return seleccion.filter(Boolean).map(String);
  if (typeof seleccion === "object" && seleccion !== null) return Object.values(seleccion).filter(Boolean).map(String);
  return [String(seleccion)];
}

function obtenerValorCampoMecanico(body, nombreCampo, idMecanico, indiceOrdenado = -1) {
  const id = String(idMecanico);
  const planoPorId = body[`${nombreCampo}[${id}]`];
  if (planoPorId !== undefined) {
    return String(planoPorId || "").trim();
  }

  const planoPorIndice = indiceOrdenado >= 0 ? body[`${nombreCampo}[${indiceOrdenado}]`] : undefined;
  if (planoPorIndice !== undefined) {
    return String(planoPorIndice || "").trim();
  }

  const campos = body[nombreCampo];
  if (!campos) return "";

  if (Object.prototype.hasOwnProperty.call(campos, id)) {
    return String(campos[id] || "").trim();
  }

  if (Array.isArray(campos) && indiceOrdenado >= 0 && campos[indiceOrdenado] !== undefined) {
    return String(campos[indiceOrdenado] || "").trim();
  }

  return "";
}

async function obtenerReportesPendientesSupervisores(sedeFiltro) {
  await ensureReportesSupervisoresTables(pool);

  const params = [];
  let sql = `
    SELECT
      rs.id,
      rs.unidad_id,
      rs.sede,
      rs.supervisor_nombre,
      rs.descripcion_original,
      rs.descripcion_limpia,
      rs.importante,
      rs.fecha_reporte,
      u.placa
    FROM reportes_supervisores rs
    JOIN unidades u ON u.id = rs.unidad_id
    WHERE rs.estado IN ('PENDIENTE','EN_REVISION')
  `;

  if (sedeFiltro) {
    sql += " AND rs.sede = ?";
    params.push(sedeFiltro);
  }

  sql += " ORDER BY rs.importante DESC, rs.sede, u.placa, rs.fecha_reporte DESC";
  const [reportes] = await pool.query(sql, params);
  return reportes;
}

async function obtenerReporteSupervisorAutorizado(reporteId, sedeFiltro) {
  if (!reporteId) return null;
  await ensureReportesSupervisoresTables(pool);

  const params = [reporteId];
  let sql = `
    SELECT
      rs.*,
      u.placa
    FROM reportes_supervisores rs
    JOIN unidades u ON u.id = rs.unidad_id
    WHERE rs.id = ?
      AND rs.estado IN ('PENDIENTE','EN_REVISION')
  `;

  if (sedeFiltro) {
    sql += " AND rs.sede = ?";
    params.push(sedeFiltro);
  }

  sql += " LIMIT 1";
  const [[reporte]] = await pool.query(sql, params);
  return reporte || null;
}

// =====================================================
// LISTADO DE CORRECTIVOS
// =====================================================
router.get("/correctivos", requireAuth, async (req, res) => {
  try {
    const sedeFiltro = obtenerSedeFiltro(req);
    const condiciones = [];
    const params = [];
    if (sedeFiltro) {
      condiciones.push("c.sede = ?");
      params.push(sedeFiltro);
    }
    const where = condiciones.length ? "WHERE " + condiciones.join(" AND ") : "";
    const [rows] = await pool.query(
      `
      SELECT
        c.id,
        DATE_FORMAT(c.fecha, '%d/%m/%Y %H:%i') AS fecha_formato,
        u.placa,
        c.trabajo_realizado,
        c.pendiente,
        COALESCE(GROUP_CONCAT(DISTINCT m.nombre SEPARATOR ' — '), '—') AS mecanicos
      FROM correctivos c
      JOIN unidades u ON u.id = c.unidad_id
      LEFT JOIN correctivo_trabajos ct ON ct.correctivo_id = c.id
      LEFT JOIN mecanicos m ON m.id = ct.mecanico_id
      ${where}
      GROUP BY c.id, c.fecha, u.placa, c.trabajo_realizado, c.pendiente
      ORDER BY c.fecha DESC
      `,
      params
    );
    const reportesPendientes = ["MECANICO", "ADMIN", "TALLER"].includes(req.session.user.rol)
      ? await obtenerReportesPendientesSupervisores(sedeFiltro)
      : [];

    res.render("correctivos", {
      correctivos: rows,
      reportesPendientes,
      user: req.session.user
    });
  } catch (error) {
    console.error("❌ ERROR listado correctivos:", error);
    res.status(500).send("Error interno");
  }
});

// =====================================================
// EXPORTAR A EXCEL (solo ADMIN)
// =====================================================
router.get("/exportar", requireAuth, async (req, res) => {
  try {
    if (req.session.user.rol !== "ADMIN")
      return res.status(403).send("No autorizado");
    const [rows] = await pool.query(`
      SELECT u.placa, u.sede, 'PREVENTIVO' AS tipo, DATE_FORMAT(m.fecha_programada,'%d/%m/%Y') AS fecha, m.estado, m.ejecucion
      FROM mantenimientos m JOIN unidades u ON u.id = m.unidad_id WHERE m.estado = 'CERRADO'
      UNION ALL
      SELECT u.placa, u.sede, 'CORRECTIVO' AS tipo, DATE_FORMAT(c.fecha,'%d/%m/%Y') AS fecha, 'CERRADO' AS estado, c.trabajo_realizado AS ejecucion
      FROM correctivos c JOIN unidades u ON u.id = c.unidad_id
      ORDER BY fecha DESC
    `);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Mantenimientos");
    sheet.columns = [
      { header: "Placa", key: "placa", width: 15 },
      { header: "Sede", key: "sede", width: 20 },
      { header: "Tipo", key: "tipo", width: 15 },
      { header: "Fecha", key: "fecha", width: 15 },
      { header: "Estado", key: "estado", width: 15 },
      { header: "Ejecución", key: "ejecucion", width: 50 }
    ];
    sheet.addRows(rows);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=mantenimientos.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Error exportando:", err);
    res.status(500).send("Error exportando datos");
  }
});

// =====================================================
// DASHBOARD IA DE MANTENIMIENTOS
// =====================================================
router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const fechaDesde = String(req.query.fecha_desde || "").trim();
    const fechaHasta = String(req.query.fecha_hasta || "").trim();

    const condicionesPreventivos = [];
    const condicionesCorrectivos = [];
    const paramsPreventivos = [];
    const paramsCorrectivos = [];

    const sedeSeleccionada = aplicarFiltroSedesDashboard(req, condicionesPreventivos, paramsPreventivos, "u");
    aplicarFiltroSedesDashboard(req, condicionesCorrectivos, paramsCorrectivos, "u");

    if (fechaDesde) {
      condicionesPreventivos.push("DATE(m.fecha_programada) >= ?");
      condicionesCorrectivos.push("DATE(c.fecha) >= ?");
      paramsPreventivos.push(fechaDesde);
      paramsCorrectivos.push(fechaDesde);
    }

    if (fechaHasta) {
      condicionesPreventivos.push("DATE(m.fecha_programada) <= ?");
      condicionesCorrectivos.push("DATE(c.fecha) <= ?");
      paramsPreventivos.push(fechaHasta);
      paramsCorrectivos.push(fechaHasta);
    }

    const wherePreventivos = condicionesPreventivos.length ? `WHERE ${condicionesPreventivos.join(" AND ")}` : "";
    const whereCorrectivos = condicionesCorrectivos.length ? `WHERE ${condicionesCorrectivos.join(" AND ")}` : "";

    const [preventivosRows] = await pool.query(
      `
      SELECT
        m.id,
        u.placa,
        u.sede,
        m.tipo,
        m.estado,
        m.prioridad,
        m.plan,
        m.ejecucion,
        m.pendiente,
        DATE_FORMAT(m.fecha_programada, '%d/%m/%Y') AS fecha_formato,
        COALESCE(GROUP_CONCAT(DISTINCT mec.nombre ORDER BY mec.nombre SEPARATOR ', '), '-') AS mecanicos
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      LEFT JOIN mantenimiento_mecanicos mm ON mm.mantenimiento_id = m.id
      LEFT JOIN mecanicos mec ON mec.id = mm.mecanico_id
      ${wherePreventivos}
      GROUP BY m.id, u.placa, u.sede, m.tipo, m.estado, m.prioridad, m.plan, m.ejecucion, m.pendiente, m.fecha_programada
      ORDER BY m.fecha_programada DESC, m.id DESC
      LIMIT 1200
      `,
      paramsPreventivos
    );

    const [correctivosRows] = await pool.query(
      `
      SELECT
        c.id,
        u.placa,
        COALESCE(u.sede, c.sede) AS sede,
        'CERRADO' AS estado,
        c.trabajo_realizado,
        c.pendiente,
        DATE_FORMAT(c.fecha, '%d/%m/%Y') AS fecha_formato,
        COALESCE(GROUP_CONCAT(DISTINCT ct.trabajo SEPARATOR ' | '), '') AS trabajos_detalle,
        COALESCE(GROUP_CONCAT(DISTINCT ct.repuestos SEPARATOR ' | '), '') AS repuestos,
        COALESCE(GROUP_CONCAT(DISTINCT mec.nombre ORDER BY mec.nombre SEPARATOR ', '), '-') AS mecanicos
      FROM correctivos c
      JOIN unidades u ON u.id = c.unidad_id
      LEFT JOIN correctivo_trabajos ct ON ct.correctivo_id = c.id
      LEFT JOIN mecanicos mec ON mec.id = ct.mecanico_id
      ${whereCorrectivos}
      GROUP BY c.id, u.placa, c.sede, u.sede, c.trabajo_realizado, c.pendiente, c.fecha
      ORDER BY c.fecha DESC, c.id DESC
      LIMIT 1200
      `,
      paramsCorrectivos
    );

    const [sedesRows] = await pool.query(`
      SELECT DISTINCT sede
      FROM unidades
      WHERE sede IS NOT NULL AND TRIM(sede) <> ''
      ORDER BY sede
    `);

    const sedesPermitidas = getSedesPermitidas(req).filter(Boolean);
    const puedeTodas = esUsuarioTodasSedes(req.session.user);
    const sedesFiltro = sedesRows
      .map(row => row.sede)
      .filter(sede => puedeTodas || sedesPermitidas.includes(sede))
      .map(sede => ({ valor: sede, etiqueta: etiquetaSede(sede) }));

    const dashboard = agruparDashboardMantenimientos(preventivosRows, correctivosRows);

    res.render("mantenimientos_dashboard", {
      user: req.session.user,
      filtros: {
        sede: sedeSeleccionada,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta
      },
      sedesFiltro,
      dashboard,
      familias: FAMILIAS_MANTENIMIENTO
    });
  } catch (error) {
    console.error("ERROR dashboard IA mantenimientos:", error);
    res.status(500).send("Error cargando dashboard de mantenimientos");
  }
});

// =====================================================
// FORMULARIO NUEVO CORRECTIVO
// =====================================================
router.get("/correctivos/nuevo", requireAuth, async (req, res) => {
  try {
    if (!["MECANICO", "ADMIN", "TALLER"].includes(req.session.user.rol))
      return res.redirect("/mantenimientos");
    let sedeFiltro = obtenerSedeFiltro(req);
    const reporteAtendido = await obtenerReporteSupervisorAutorizado(req.query.reporte_id, sedeFiltro);
    if (!sedeFiltro && reporteAtendido) {
      sedeFiltro = reporteAtendido.sede;
    }
    if (!sedeFiltro) return res.status(400).send("No hay sede seleccionada");
    const [unidades] = await pool.query("SELECT id, placa FROM unidades WHERE sede = ? ORDER BY placa", [sedeFiltro]);
    const { sql: sqlMecanicos, params: paramsMecanicos } = obtenerFiltroMecanicosPorSede(sedeFiltro);
    const [mecanicos] = await pool.query(sqlMecanicos, paramsMecanicos);
    res.render("correctivos_nuevo", { unidades, mecanicos, reporteAtendido, user: req.session.user });
  } catch (error) {
    console.error("❌ ERROR form correctivo:", error);
    res.status(500).send("Error interno");
  }
});

// =====================================================
// GUARDAR CORRECTIVO (POST)
// =====================================================
router.post("/correctivos", requireAuth, async (req, res) => {
  try {
    if (!["MECANICO", "ADMIN", "TALLER"].includes(req.session.user.rol)) {
      return res.status(403).send("No autorizado");
    }
    await ensureUnidadEstadoColumns();
    const { unidad_id, pendiente, trabajo_general, reporte_id } = req.body;
    const pendienteTexto = String(pendiente || "").trim();
    if (!unidad_id) return res.status(400).send("Debe seleccionar una unidad.");
    const mecanicosArray = obtenerValoresSeleccionados(req.body);
    if (mecanicosArray.length === 0) return res.status(400).send("Debe seleccionar al menos un mecánico.");

    const sedeFiltro = obtenerSedeFiltro(req);
    const [[unidadCorrectivo]] = await pool.query("SELECT id, sede FROM unidades WHERE id = ?", [unidad_id]);
    if (!unidadCorrectivo) return res.status(400).send("Unidad no encontrada.");
    const sedeCorrectivo = sedeFiltro || unidadCorrectivo.sede;
    const { sql: sqlMecanicos, params: paramsMecanicos } = obtenerFiltroMecanicosPorSede(sedeCorrectivo, true);
    const [todosMecanicos] = await pool.query(sqlMecanicos, paramsMecanicos);
    const idsOrdenados = todosMecanicos.map(m => String(m.id));

    let resumenGeneral = "";
    for (const idMec of mecanicosArray) {
      const idx = idsOrdenados.indexOf(idMec);
      const trabajo = obtenerValorCampoMecanico(req.body, "trabajos", idMec, idx);
      if (trabajo.length > 0) {
        resumenGeneral += trabajo + " | ";
      }
    }
    if (!resumenGeneral.trim() && trabajo_general && String(trabajo_general).trim()) {
      resumenGeneral = String(trabajo_general).trim() + " | ";
    }
    if (!resumenGeneral.trim()) return res.status(400).send("Debe escribir al menos un trabajo.");

    const puntos = calcularPuntos(resumenGeneral);
    const [result] = await pool.query(
      `INSERT INTO correctivos (unidad_id, sede, trabajo_realizado, pendiente, creado_por, puntos)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [unidad_id, sedeCorrectivo, resumenGeneral, pendienteTexto || null, req.session.user.id, puntos]
    );
    const correctivoId = result.insertId;

    if (pendienteTexto) {
      await pool.query(
        `UPDATE unidades
         SET varada = 1,
             razon_varada = ?
         WHERE id = ?`,
        [`Pendiente de taller: ${pendienteTexto}`, unidad_id]
      );
    } else {
      await pool.query(
        `UPDATE unidades
         SET varada = 0,
             razon_varada = NULL
         WHERE id = ?`,
        [unidad_id]
      );
    }

    for (const idMec of mecanicosArray) {
      let trabajo = null, repuesto = null;
      const idx = idsOrdenados.indexOf(idMec);
      trabajo = obtenerValorCampoMecanico(req.body, "trabajos", idMec, idx) || null;
      repuesto = obtenerValorCampoMecanico(req.body, "repuestos", idMec, idx) || null;
      if (trabajo || repuesto) {
        await pool.query(
          `INSERT INTO correctivo_trabajos (correctivo_id, mecanico_id, trabajo, repuestos)
           VALUES (?, ?, ?, ?)`,
          [correctivoId, idMec, trabajo, repuesto]
        );
      }
    }

    const reporteAtendido = await obtenerReporteSupervisorAutorizado(reporte_id, sedeFiltro);
    if (reporteAtendido && String(reporteAtendido.unidad_id) === String(unidad_id)) {
      await pool.query(
        `UPDATE reportes_supervisores
         SET estado = 'HISTORIAL',
             cerrado_por = ?,
             fecha_cierre = NOW(),
             correctivo_id = ?,
             cierre_motivo = ?,
             cierre_confianza = 1,
             actualizado_en = NOW()
         WHERE id = ?`,
        [
          req.session.user.id,
          correctivoId,
          "Cerrado por mecánico al completar correctivo desde el reporte.",
          reporteAtendido.id
        ]
      );
      await pool.query(
        `UPDATE reportes_supervisores_sugerencias
         SET estado = CASE WHEN estado = 'PENDIENTE' THEN 'CONFIRMADA' ELSE estado END,
             resuelto_por = COALESCE(resuelto_por, ?),
             resuelto_en = COALESCE(resuelto_en, NOW())
         WHERE reporte_id = ?`,
        [req.session.user.id, reporteAtendido.id]
      );
    }

    const sugerencias = await registrarSugerenciasParaCorrectivo(pool, correctivoId);
    if (sugerencias.length && ["ADMIN", "TALLER"].includes(req.session.user.rol)) {
      return res.redirect(`/reportes-supervisores?correctivo_id=${correctivoId}`);
    }

    res.redirect("/mantenimientos/correctivos");
  } catch (error) {
    console.error("❌ ERROR guardar correctivo:", error);
    res.status(500).send("Error interno al guardar el correctivo");
  }
});

// =====================================================
// AGREGAR MÁS TRABAJOS / REPUESTOS A UN CORRECTIVO EXISTENTE
// =====================================================
router.get("/correctivos/:id/agregar", requireAuth, async (req, res) => {
  try {
    const correctivoId = req.params.id;
    const [[correctivo]] = await pool.query(
      `SELECT c.*, u.placa FROM correctivos c JOIN unidades u ON u.id = c.unidad_id WHERE c.id = ?`,
      [correctivoId]
    );
    if (!correctivo) return res.status(404).send("Correctivo no encontrado");
    const sedeFiltro = obtenerSedeFiltro(req);
    const { sql: sqlMecanicos, params: paramsMecanicos } = obtenerFiltroMecanicosPorSede(sedeFiltro);
    const [mecanicosDisponibles] = await pool.query(sqlMecanicos, paramsMecanicos);
    res.render("correctivos_agregar", { correctivo, mecanicosDisponibles, user: req.session.user });
  } catch (error) {
    console.error("❌ Error al cargar formulario de agregado:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/correctivos/:id/agregar", requireAuth, async (req, res) => {
  try {
    const correctivoId = req.params.id;
    const { mecanicos, trabajos, repuestos } = req.body;
    let mecanicosArray = [];
    if (mecanicos) {
      mecanicosArray = Array.isArray(mecanicos) ? mecanicos.filter(Boolean) : [mecanicos];
    }
    if (mecanicosArray.length === 0) return res.status(400).send("Debe seleccionar al menos un mecánico.");
    for (const idMec of mecanicosArray) {
      let trabajo = (trabajos && trabajos[idMec]) ? trabajos[idMec].trim() : null;
      let repuesto = (repuestos && repuestos[idMec]) ? repuestos[idMec].trim() : null;
      if (trabajo || repuesto) {
        await pool.query(
          `INSERT INTO correctivo_trabajos (correctivo_id, mecanico_id, trabajo, repuestos)
           VALUES (?, ?, ?, ?)`,
          [correctivoId, idMec, trabajo, repuesto]
        );
      }
    }
    res.redirect("/mantenimientos/correctivos");
  } catch (error) {
    console.error("❌ Error al guardar información adicional:", error);
    res.status(500).send("Error interno al agregar más información");
  }
});

// =====================================================
// MANTENIMIENTOS PREVENTIVOS
// =====================================================
router.get("/", requireAuth, async (req, res) => {
  try {
    const { filtro, placa, tipo, prioridad, fecha_desde, fecha_hasta, mecanico_id } = req.query;
    let condiciones = [], params = [];
    if (filtro === "pendientes") condiciones.push("m.estado != 'CERRADO'");
    else if (filtro === "realizados") condiciones.push("m.estado = 'CERRADO'");

    if (placa && placa.trim() !== "") {
      agregarFiltroPlacaSql(condiciones, params, "u.placa", placa);
    }
    if (tipo && tipo !== "") {
      condiciones.push("m.tipo = ?");
      params.push(tipo);
    }
    if (prioridad && prioridad !== "") {
      condiciones.push("m.prioridad = ?");
      params.push(prioridad);
    }
    if (fecha_desde && fecha_desde !== "") {
      condiciones.push("m.fecha_programada >= ?");
      params.push(fecha_desde);
    }
    if (fecha_hasta && fecha_hasta !== "") {
      condiciones.push("m.fecha_programada <= ?");
      params.push(fecha_hasta);
    }
    if (mecanico_id && mecanico_id !== "") {
      condiciones.push(`EXISTS (
        SELECT 1
        FROM mantenimiento_mecanicos mm
        WHERE mm.mantenimiento_id = m.id AND mm.mecanico_id = ?
      )`);
      params.push(mecanico_id);
    }

    const sedeFiltro = obtenerSedeFiltro(req);
    if (sedeFiltro) {
      condiciones.push("u.sede = ?");
      params.push(sedeFiltro);
    }
    if (req.session.user.rol === "MECANICO") {
      condiciones.push("DATE(m.fecha_programada) <= CURDATE()");
    }
    const where = condiciones.length ? "WHERE " + condiciones.join(" AND ") : "";
    const [mantenimientos] = await pool.query(
      `
      SELECT
        m.id,
        u.placa,
        u.sede,
        m.tipo,
        m.estado,
        m.prioridad,
        m.fecha_programada,
        DATE_FORMAT(m.fecha_programada, '%d/%m/%Y') AS fecha_formato,
        m.ejecucion,
        m.pendiente,
        COALESCE(GROUP_CONCAT(DISTINCT mec.nombre ORDER BY mec.nombre SEPARATOR ', '), '—') AS mecanicos
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      LEFT JOIN mantenimiento_mecanicos mm ON mm.mantenimiento_id = m.id
      LEFT JOIN mecanicos mec ON mec.id = mm.mecanico_id
      ${where}
      GROUP BY m.id, u.placa, u.sede, m.tipo, m.estado, m.prioridad, m.fecha_programada, m.ejecucion, m.pendiente
      ORDER BY m.fecha_programada DESC, m.id DESC
      `,
      params
    );

    const { sql: sqlMecanicos, params: paramsMecanicos } = obtenerFiltroMecanicosPorSede(sedeFiltro);
    const [mecanicos] = await pool.query(sqlMecanicos, paramsMecanicos);
    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("mantenimientos", {
      mantenimientos,
      user: req.session.user,
      filtro,
      filtros: { filtro, placa, tipo, prioridad, fecha_desde, fecha_hasta, mecanico_id },
      mecanicos,
      sedeSeleccionada: sedeFiltro || "TODAS",
      puedeReprogramar: puedeReprogramarMantenimientos(req.session.user),
      success,
      error
    });
  } catch (error) {
    console.error("❌ ERROR listado mantenimientos:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/reprogramar", requireAuth, async (req, res) => {
  try {
    if (!puedeReprogramarMantenimientos(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    const ids = obtenerIdsMantenimiento(req.body.mantenimientos_ids);
    const nuevaFecha = String(req.body.nueva_fecha || "").trim();

    if (!ids.length) {
      req.session.error = "Debe seleccionar al menos un mantenimiento.";
      return redirectMantenimientos(req, res);
    }

    if (!nuevaFecha) {
      req.session.error = "Debe indicar la nueva fecha.";
      return redirectMantenimientos(req, res);
    }

    const sedeFiltro = obtenerSedeFiltro(req);
    let sql = `
      UPDATE mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      SET m.fecha_programada = ?
      WHERE m.id IN (?)
        AND m.estado != 'CERRADO'
    `;
    const params = [nuevaFecha, ids];

    if (sedeFiltro) {
      sql += " AND u.sede = ?";
      params.push(sedeFiltro);
    }

    const [result] = await pool.query(sql, params);
    req.session.success = `${result.affectedRows} mantenimiento${result.affectedRows === 1 ? "" : "s"} reprogramado${result.affectedRows === 1 ? "" : "s"} para ${nuevaFecha}.`;
    return redirectMantenimientos(req, res);
  } catch (error) {
    console.error("❌ ERROR reprogramando mantenimientos:", error);
    req.session.error = "Error interno al reprogramar mantenimientos.";
    return redirectMantenimientos(req, res);
  }
});

router.post("/:id/reprogramar", requireAuth, async (req, res) => {
  try {
    if (!puedeReprogramarMantenimientos(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    const id = String(req.params.id || "");
    const nuevaFecha = String(req.body.nueva_fecha || "").trim();

    if (!/^\d+$/.test(id) || !nuevaFecha) {
      req.session.error = "Debe indicar el mantenimiento y la nueva fecha.";
      return redirectMantenimientos(req, res);
    }

    const sedeFiltro = obtenerSedeFiltro(req);
    let sql = `
      UPDATE mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      SET m.fecha_programada = ?
      WHERE m.id = ?
        AND m.estado != 'CERRADO'
    `;
    const params = [nuevaFecha, id];

    if (sedeFiltro) {
      sql += " AND u.sede = ?";
      params.push(sedeFiltro);
    }

    const [result] = await pool.query(sql, params);
    req.session.success = result.affectedRows
      ? `Mantenimiento reprogramado para ${nuevaFecha}.`
      : "No se reprogramó. Puede que ya esté cerrado o no tengas permiso para esa sede.";
    return redirectMantenimientos(req, res);
  } catch (error) {
    console.error("❌ ERROR reprogramando mantenimiento:", error);
    req.session.error = "Error interno al reprogramar mantenimiento.";
    return redirectMantenimientos(req, res);
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const sedeFiltro = obtenerSedeFiltro(req);
    let sql = `SELECT m.id, m.tipo, m.estado, m.prioridad, m.plan, m.ejecucion, m.pendiente, u.placa, u.sede
               FROM mantenimientos m JOIN unidades u ON u.id = m.unidad_id WHERE m.id = ?`;
    let params = [req.params.id];
    if (sedeFiltro) {
      sql += " AND u.sede = ?";
      params.push(sedeFiltro);
    }
    const [rows] = await pool.query(sql, params);
    if (!rows.length) return res.send("Mantenimiento no encontrado");
    const { sql: sqlMecanicos, params: paramsMecanicos } = obtenerFiltroMecanicosPorSede(sedeFiltro);
    const [mecanicos] = await pool.query(sqlMecanicos, paramsMecanicos);
    const [mecanicosAsignados] = await pool.query(
      `SELECT m.id, m.nombre FROM mantenimiento_mecanicos mm JOIN mecanicos m ON m.id = mm.mecanico_id WHERE mm.mantenimiento_id = ?`,
      [req.params.id]
    );
    res.render("mantenimiento_detalle", { mantenimiento: rows[0], user: req.session.user, mecanicos, mecanicosAsignados });
  } catch (error) {
    console.error("❌ ERROR detalle mantenimiento:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/:id/plan", requireAuth, async (req, res) => {
  try {
    if (!["ADMIN", "TALLER"].includes(req.session.user.rol)) return res.status(403).send("No autorizado");
    const { plan } = req.body;
    await pool.query("UPDATE mantenimientos SET plan = ? WHERE id = ?", [plan, req.params.id]);
    res.redirect(`/mantenimientos/${req.params.id}`);
  } catch (error) {
    console.error("❌ ERROR guardando plan:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/:id/ejecucion", requireAuth, async (req, res) => {
  try {
    if (!["ADMIN", "MECANICO"].includes(req.session.user.rol)) return res.status(403).send("No autorizado");
    const { ejecucion, pendiente } = req.body;
    let mecanicos = [];
    if (req.body.mecanicos !== undefined) {
      mecanicos = Array.isArray(req.body.mecanicos) ? req.body.mecanicos.filter(Boolean) : [req.body.mecanicos];
    }
    if (mecanicos.length === 0) return res.status(400).send("Debe asignar al menos un mecánico antes de cerrar.");
    await pool.query(`UPDATE mantenimientos SET ejecucion = ?, pendiente = ?, estado = 'CERRADO', fecha_cierre = NOW() WHERE id = ?`, [ejecucion, pendiente, req.params.id]);
    await pool.query("DELETE FROM mantenimiento_mecanicos WHERE mantenimiento_id = ?", [req.params.id]);
    for (const mecanicoId of mecanicos) {
      await pool.query("INSERT INTO mantenimiento_mecanicos (mantenimiento_id, mecanico_id) VALUES (?, ?)", [req.params.id, mecanicoId]);
    }
    res.redirect("/mantenimientos");
  } catch (error) {
    console.error("❌ ERROR cerrar mantenimiento:", error);
    res.status(500).send("Error interno");
  }
});

module.exports = router;
