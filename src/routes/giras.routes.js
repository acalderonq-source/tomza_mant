const express = require("express");
const router = express.Router();
const pool = require("../db");
const ExcelJS = require("exceljs");
const { esUsuarioTodasSedes, TODAS_SEDES } = require("../utils/sedes");

const ROLES_VER_GIRAS = ["ADMIN", "TALLER", "MECANICO", "SUPERVISOR", "SUPERVISOR_PESADO"];
const ROLES_GESTION_GIRAS = ["ADMIN", "TALLER"];

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

  if (esUsuarioTodasSedes(user)) {
    if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
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

function extraerJsonRespuesta(texto) {
  const raw = String(texto || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (error) {
      return null;
    }
  }
}

function dividirTemasFallback(texto) {
  const partes = String(texto || "")
    .split(/[,;\n.]+|(?=\b(?:Cambiar|Pintar|Quitar|Reparar|Llantas|Puerta|Rotulacion|Rotulación|Calcomania|Calcomanía|Asiento|Parabrisas|Palabrizas)\b)/i)
    .map(parte => parte.trim())
    .filter(Boolean);
  const mecanicoKeywords = [
    "freno", "motor", "aceite", "caja", "clutch", "embrague", "fuga", "bomba", "radiador", "manguera",
    "suspension", "suspensión", "llanta", "direccion", "dirección", "luces", "luz", "electrico", "eléctrico",
    "bateria", "batería", "arranque", "inyector", "agua", "temperatura", "escape", "rodamiento", "baja",
    "cambiar", "reparar", "soldar", "ajustar", "revisar"
  ];
  const esteticoKeywords = [
    "pintura", "golpe", "aboll", "ray", "rotul", "limpieza", "sucio", "sucia", "vidrio", "parabrisas",
    "tapicer", "asiento", "puerta", "bumper", "defensa", "carroceria", "carrocería", "lamina", "lámina",
    "cabina", "calcom", "aro", "aros", "gris", "fe", "feo", "estet", "estét", "capot", "parachoque",
    "guardabarro", "loder", "cinta reflectiva", "reflectiva", "lado izquierdo", "lado derecho", "rombo",
    "stiker", "sticker", "marchamo", "alma del bumber", "emblema", "cajon", "cajón", "palabrizas"
  ];

  const mecanico = [];
  const estetico = [];

  for (const parte of partes) {
    const lower = parte.toLowerCase();
    const esEstetico = esteticoKeywords.some(keyword => lower.includes(keyword));
    const esMecanico = mecanicoKeywords.some(keyword => lower.includes(keyword));

    if (esEstetico) {
      estetico.push(parte);
    } else {
      mecanico.push(parte);
    }
  }

  return {
    tema_mecanico: mecanico.join(", "),
    tema_estetico: estetico.join(", ")
  };
}

function normalizarFraseTema(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function partirTemas(value) {
  return String(value || "")
    .split(/[,;\n.]+|(?=\b(?:Cambiar|Pintar|Quitar|Reparar|Llantas|Puerta|Rotulacion|Rotulación|Calcomania|Calcomanía|Asiento|Parabrisas|Palabrizas)\b)/i)
    .map(parte => parte.trim())
    .filter(Boolean);
}

function limpiarTemasDivididos(temaMecanico, temaEstetico) {
  const esteticoKeywords = [
    "pint", "golpe", "aboll", "ray", "rotul", "calcom", "cabina", "aro", "aros", "gris", "puerta",
    "bumper", "bumber", "defensa", "carroceria", "carrocería", "lamina", "lámina", "rombo", "asiento",
    "tapicer", "stiker", "sticker", "marchamo", "parabrisas", "palabrizas", "emblema", "cajon", "cajón",
    "reflectiva", "alma del", "lado izquierdo", "lado derecho"
  ];
  const sinObservacion = /^(0\s*)?(sin\s+)?observaciones?$/i;
  const mecanico = [];
  const estetico = [];
  const vistosMecanico = new Set();
  const vistosEstetico = new Set();

  function agregar(lista, vistos, frase) {
    const limpia = frase.trim();
    const clave = normalizarFraseTema(limpia);
    if (!clave || sinObservacion.test(clave) || vistos.has(clave)) return;
    vistos.add(clave);
    lista.push(limpia);
  }

  for (const frase of partirTemas(temaEstetico)) {
    agregar(estetico, vistosEstetico, frase);
  }

  for (const frase of partirTemas(temaMecanico)) {
    const lower = frase.toLowerCase();
    const esEstetico = esteticoKeywords.some(keyword => lower.includes(keyword));
    if (esEstetico) {
      agregar(estetico, vistosEstetico, frase);
    } else {
      agregar(mecanico, vistosMecanico, frase);
    }
  }

  const esteticoKeys = new Set(estetico.map(normalizarFraseTema));
  const mecanicoSinDuplicados = mecanico.filter(frase => !esteticoKeys.has(normalizarFraseTema(frase)));

  return {
    tema_mecanico: mecanicoSinDuplicados.join(", "),
    tema_estetico: estetico.join(", ")
  };
}

function textoParaDividirRecomendacion(rec) {
  return String(rec.recomendacion || [rec.tema_mecanico, rec.tema_estetico].filter(Boolean).join(", ") || "").trim();
}

async function obtenerRecomendacionAutorizada(req, id) {
  const sedesPermitidas = sedesPermitidasGiras(req);
  const [[rec]] = await pool.query(
    `
    SELECT gr.*
    FROM giras_taller_recomendaciones gr
    JOIN giras_taller gt ON gt.id = gr.gira_id
    WHERE gr.id = ? AND gt.sede IN (?)
    LIMIT 1
    `,
    [id, sedesPermitidas]
  );

  return rec || null;
}

async function dividirTemasIA(texto) {
  const limpio = String(texto || "").trim();
  if (!limpio) return { tema_mecanico: "", tema_estetico: "" };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const fallback = dividirTemasFallback(limpio);
    return limpiarTemasDivididos(fallback.tema_mecanico, fallback.tema_estetico);
  }

  try {
    const prompt = [
      "Divide la observacion de una unidad en dos campos.",
      "Devuelve SOLO JSON valido con esta forma:",
      '{"tema_mecanico":"...","tema_estetico":"..."}',
      "Tema mecanico: frenos, motor, caja, clutch, fugas, luces, bateria, direccion, suspension, llantas, sistema electrico, consumos o fallas de funcionamiento.",
      "Tema estetico: pintura, golpes, rayones, rotulacion, limpieza, vidrios, carroceria, tapiceria, asientos o apariencia.",
      "No repitas la misma frase en ambas categorias. Si una frase habla de cabina, aros, calcomanias, rotulacion, bumper, cajon, rombo, marchamo, sticker, puerta golpeada o pintura, va en tema_estetico.",
      "Si dice 0 observaciones, sin observaciones o no tiene nada real, devuelve ambos campos vacios.",
      "No inventes informacion. Si una categoria no tiene nada, devuelve string vacio.",
      `Observacion: ${limpio}`
    ].join("\n");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL_GIRAS || process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
        temperature: 0,
        max_output_tokens: 500
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const fallback = dividirTemasFallback(limpio);
      return limpiarTemasDivididos(fallback.tema_mecanico, fallback.tema_estetico);
    }

    const output = data.output_text || (data.output || []).flatMap(item => item.content || []).map(content => content.text || "").join("\n");
    const json = extraerJsonRespuesta(output);
    if (!json) {
      const fallback = dividirTemasFallback(limpio);
      return limpiarTemasDivididos(fallback.tema_mecanico, fallback.tema_estetico);
    }

    return limpiarTemasDivididos(
      String(json.tema_mecanico || "").trim(),
      String(json.tema_estetico || "").trim()
    );
  } catch (error) {
    console.warn("No se pudo dividir temas con IA, usando fallback:", error.message);
    const fallback = dividirTemasFallback(limpio);
    return limpiarTemasDivididos(fallback.tema_mecanico, fallback.tema_estetico);
  }
}

async function columnExists(tableName, columnName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return Number(row.count) > 0;
}

async function normalizarRecomendaciones(value) {
  if (!value) return [];
  const lista = Array.isArray(value) ? value : Object.values(value);
  const normalizadas = [];

  for (const item of lista) {
    const observacionUnidad = String(item.observacion_unidad || item.recomendacion || "").trim();
    let temaMecanico = String(item.tema_mecanico || "").trim();
    let temaEstetico = String(item.tema_estetico || "").trim();

    if (observacionUnidad && (!temaMecanico && !temaEstetico)) {
      const dividido = await dividirTemasIA(observacionUnidad);
      temaMecanico = dividido.tema_mecanico;
      temaEstetico = dividido.tema_estetico;
    }

    const recomendacion = observacionUnidad || [temaMecanico, temaEstetico].filter(Boolean).join("\n");
    const normalizada = {
      placa: String(item.placa || "").trim().toUpperCase(),
      tema_mecanico: temaMecanico,
      tema_estetico: temaEstetico,
      recomendacion
    };

    if (normalizada.placa && (normalizada.recomendacion || normalizada.tema_mecanico || normalizada.tema_estetico)) {
      normalizadas.push(normalizada);
    }
  }

  return normalizadas;
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS giras_taller_recomendaciones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      gira_id INT NOT NULL,
      sede VARCHAR(100) NOT NULL,
      placa VARCHAR(50) NOT NULL,
      recomendacion TEXT NULL,
      tema_mecanico TEXT NULL,
      tema_estetico TEXT NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_giras_rec_gira (gira_id),
      INDEX idx_giras_rec_sede_placa (sede, placa)
    )
  `);

  const columns = [
    ["tema_mecanico", "TEXT NULL"],
    ["tema_estetico", "TEXT NULL"]
  ];

  for (const [column, definition] of columns) {
    if (!(await columnExists("giras_taller_recomendaciones", column))) {
      await pool.query(`ALTER TABLE giras_taller_recomendaciones ADD COLUMN ${column} ${definition}`);
    }
  }
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
    let recomendaciones = [];

    if (giras.length) {
      const ids = giras.map(gira => gira.id);
      const [rows] = await pool.query(
        `
        SELECT
          gr.*,
          DATE_FORMAT(gt.fecha, '%d/%m/%Y') AS fecha_formato,
          gt.inspector,
          gt.estado
        FROM giras_taller_recomendaciones gr
        JOIN giras_taller gt ON gt.id = gr.gira_id
        WHERE gr.gira_id IN (?)
        ORDER BY gr.sede, gr.placa, gt.fecha DESC, gr.id DESC
        `,
        [ids]
      );
      recomendaciones = rows;
    }

    const recomendacionesPorSede = recomendaciones.reduce((map, item) => {
      if (!map[item.sede]) map[item.sede] = [];
      map[item.sede].push(item);
      return map;
    }, {});

    const girasPorSede = giras.reduce((map, gira) => {
      if (!map[gira.sede]) map[gira.sede] = [];
      map[gira.sede].push(gira);
      return map;
    }, {});

    const sedesConContenido = sedesPermitidas.filter(sede => (girasPorSede[sede] || []).length || (recomendacionesPorSede[sede] || []).length);
    const sedesTabs = sedesConContenido.length ? sedesConContenido : sedesPermitidas;
    const sedeActiva = (sedeFiltro && sedesTabs.includes(sedeFiltro)) ? sedeFiltro : sedesTabs[0];
    const resumen = {
      total: giras.length,
      abiertas: giras.filter(g => g.estado === "ABIERTA").length,
      seguimiento: giras.filter(g => g.estado === "EN_SEGUIMIENTO").length,
      cerradas: giras.filter(g => g.estado === "CERRADA").length,
      recomendaciones: recomendaciones.length
    };

    res.render("giras_listado", {
      user: req.session.user,
      giras,
      resumen,
      sedesPermitidas,
      sedesTabs,
      sedeActiva,
      recomendacionesPorSede,
      girasPorSede,
      filtros: { sede: sedeFiltro, estado: estadoFiltro, fecha_desde: fechaDesde, fecha_hasta: fechaHasta },
      puedeEditar: puedeGestionar(req.session.user),
      etiquetaEstado
    });
  } catch (error) {
    console.error("ERROR listado giras:", error);
    res.status(500).send("Error interno");
  }
});

router.get("/reporte/excel", async (req, res) => {
  try {
    await ensureGirasTable();

    const sedesPermitidas = sedesPermitidasGiras(req);
    const sedeFiltro = String(req.query.sede || "").trim();
    const estadoFiltro = String(req.query.estado || "").trim().toUpperCase();
    const fechaDesde = String(req.query.fecha_desde || "").trim();
    const fechaHasta = String(req.query.fecha_hasta || "").trim();

    let sql = `
      SELECT
        gr.sede,
        gr.placa,
        gr.tema_mecanico,
        gr.tema_estetico,
        gr.recomendacion,
        DATE_FORMAT(gt.fecha, '%d/%m/%Y') AS fecha_formato,
        gt.fecha,
        gt.inspector,
        gt.estado,
        gt.observaciones,
        gt.pendientes,
        gt.acciones_recomendadas
      FROM giras_taller_recomendaciones gr
      JOIN giras_taller gt ON gt.id = gr.gira_id
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

    sql += " ORDER BY gr.sede, gr.placa, gt.fecha DESC, gr.id DESC";

    const [rows] = await pool.query(sql, params);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Gas Tomza";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Temas por unidad", {
      views: [{ state: "frozen", ySplit: 1 }]
    });

    sheet.columns = [
      { header: "Sede", key: "sede", width: 18 },
      { header: "Placa", key: "placa", width: 14 },
      { header: "Tema mecánico", key: "tema_mecanico", width: 42 },
      { header: "Tema estético", key: "tema_estetico", width: 42 },
      { header: "Fecha", key: "fecha_formato", width: 14 },
      { header: "Inspector", key: "inspector", width: 24 },
      { header: "Estado", key: "estado", width: 18 },
      { header: "Observación original", key: "recomendacion", width: 48 },
      { header: "Recomendación de taller", key: "acciones_recomendadas", width: 42 },
      { header: "Pendientes", key: "pendientes", width: 42 }
    ];

    rows.forEach(row => {
      sheet.addRow({
        sede: row.sede,
        placa: row.placa,
        tema_mecanico: row.tema_mecanico || "",
        tema_estetico: row.tema_estetico || "",
        fecha_formato: row.fecha_formato || "",
        inspector: row.inspector || "",
        estado: etiquetaEstado(row.estado),
        recomendacion: row.recomendacion || "",
        acciones_recomendadas: row.acciones_recomendadas || "",
        pendientes: row.pendientes || ""
      });
    });

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
    header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };

    sheet.eachRow((row, rowNumber) => {
      row.eachCell(cell => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFD9E2EF" } },
          left: { style: "thin", color: { argb: "FFD9E2EF" } },
          bottom: { style: "thin", color: { argb: "FFD9E2EF" } },
          right: { style: "thin", color: { argb: "FFD9E2EF" } }
        };
        cell.alignment = { vertical: "top", wrapText: true };
      });

      if (rowNumber > 1 && rowNumber % 2 === 0) {
        row.eachCell(cell => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        });
      }
    });

    sheet.autoFilter = {
      from: "A1",
      to: "J1"
    };

    const resumen = workbook.addWorksheet("Resumen");
    resumen.columns = [
      { header: "Dato", key: "dato", width: 28 },
      { header: "Valor", key: "valor", width: 40 }
    ];
    resumen.addRows([
      { dato: "Fecha de descarga", valor: new Date().toLocaleString("es-CR") },
      { dato: "Sede filtrada", valor: sedeFiltro || "Todas permitidas" },
      { dato: "Estado filtrado", valor: estadoFiltro ? etiquetaEstado(estadoFiltro) : "Todos" },
      { dato: "Desde", valor: fechaDesde || "-" },
      { dato: "Hasta", valor: fechaHasta || "-" },
      { dato: "Unidades en reporte", valor: rows.length }
    ]);
    resumen.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    resumen.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };

    const buffer = await workbook.xlsx.writeBuffer();
    const nombreSede = (sedeFiltro || "todas").replace(/\s+/g, "_").toLowerCase();
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=giras_temas_${nombreSede}_${timestamp}.xlsx`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("ERROR descargando Excel de giras:", error);
    res.status(500).send("Error descargando Excel");
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
      recomendaciones: [],
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

    const recomendaciones = await normalizarRecomendaciones(req.body.recomendaciones);
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const [result] = await connection.query(
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

      for (const recomendacion of recomendaciones) {
        await connection.query(
          `
          INSERT INTO giras_taller_recomendaciones
            (gira_id, sede, placa, recomendacion, tema_mecanico, tema_estetico)
          VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            result.insertId,
            sede,
            recomendacion.placa,
            recomendacion.recomendacion,
            recomendacion.tema_mecanico || null,
            recomendacion.tema_estetico || null
          ]
        );
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

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
    const [recomendaciones] = await pool.query(
      "SELECT placa, recomendacion, tema_mecanico, tema_estetico FROM giras_taller_recomendaciones WHERE gira_id = ? ORDER BY id",
      [req.params.id]
    );

    res.render("giras_form", {
      user: req.session.user,
      sedesPermitidas,
      gira: { ...gira, fecha_input: fechaInput(gira.fecha) },
      recomendaciones,
      hoy: new Date().toISOString().slice(0, 10)
    });
  } catch (error) {
    console.error("ERROR editar gira:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/ia/dividir-temas", async (req, res) => {
  try {
    if (!puedeGestionar(req.session.user)) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    const observacion = String(req.body.observacion || "").trim();
    if (!observacion) {
      return res.status(400).json({ ok: false, error: "Debe escribir una observación para dividir." });
    }

    const dividido = await dividirTemasIA(observacion);
    res.json({
      ok: true,
      tema_mecanico: dividido.tema_mecanico,
      tema_estetico: dividido.tema_estetico,
      modo: process.env.OPENAI_API_KEY ? "ia" : "fallback"
    });
  } catch (error) {
    console.error("ERROR dividiendo temas de gira:", error);
    res.status(500).json({ ok: false, error: "No se pudo dividir la observación." });
  }
});

router.post("/recomendaciones/:id/redividir", async (req, res) => {
  try {
    await ensureGirasTable();

    if (!puedeGestionar(req.session.user)) return res.status(403).send("No autorizado");

    const rec = await obtenerRecomendacionAutorizada(req, req.params.id);
    if (!rec) return res.status(404).send("Recomendación no encontrada");

    const texto = textoParaDividirRecomendacion(rec);
    if (!texto) return res.redirect(req.get("Referer") || "/giras");

    const dividido = await dividirTemasIA(texto);
    await pool.query(
      `
      UPDATE giras_taller_recomendaciones
      SET tema_mecanico = ?,
          tema_estetico = ?
      WHERE id = ?
      `,
      [dividido.tema_mecanico || null, dividido.tema_estetico || null, req.params.id]
    );

    res.redirect(req.get("Referer") || "/giras");
  } catch (error) {
    console.error("ERROR redividiendo recomendación:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/recomendaciones/:id/cambiar-lados", async (req, res) => {
  try {
    await ensureGirasTable();

    if (!puedeGestionar(req.session.user)) return res.status(403).send("No autorizado");

    const rec = await obtenerRecomendacionAutorizada(req, req.params.id);
    if (!rec) return res.status(404).send("Recomendación no encontrada");

    await pool.query(
      `
      UPDATE giras_taller_recomendaciones
      SET tema_mecanico = ?,
          tema_estetico = ?
      WHERE id = ?
      `,
      [rec.tema_estetico || null, rec.tema_mecanico || null, req.params.id]
    );

    res.redirect(req.get("Referer") || "/giras");
  } catch (error) {
    console.error("ERROR cambiando lados:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/sede/redividir", async (req, res) => {
  try {
    await ensureGirasTable();

    if (!puedeGestionar(req.session.user)) return res.status(403).send("No autorizado");

    const sede = String(req.body.sede || "").trim();
    const sedesPermitidas = sedesPermitidasGiras(req);
    if (!sedesPermitidas.includes(sede)) return res.status(403).send("No autorizado");

    const [recs] = await pool.query(
      `
      SELECT gr.*
      FROM giras_taller_recomendaciones gr
      JOIN giras_taller gt ON gt.id = gr.gira_id
      WHERE gt.sede = ?
      ORDER BY gr.id
      `,
      [sede]
    );

    for (const rec of recs) {
      const texto = textoParaDividirRecomendacion(rec);
      if (!texto) continue;
      const dividido = await dividirTemasIA(texto);
      await pool.query(
        `
        UPDATE giras_taller_recomendaciones
        SET tema_mecanico = ?,
            tema_estetico = ?
        WHERE id = ?
        `,
        [dividido.tema_mecanico || null, dividido.tema_estetico || null, rec.id]
      );
    }

    res.redirect(`/giras?sede=${encodeURIComponent(sede)}`);
  } catch (error) {
    console.error("ERROR redividiendo sede:", error);
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

    const recomendaciones = await normalizarRecomendaciones(req.body.recomendaciones);
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      await connection.query(
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

      await connection.query("DELETE FROM giras_taller_recomendaciones WHERE gira_id = ?", [req.params.id]);
      for (const recomendacion of recomendaciones) {
        await connection.query(
          `
          INSERT INTO giras_taller_recomendaciones
            (gira_id, sede, placa, recomendacion, tema_mecanico, tema_estetico)
          VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            req.params.id,
            sede,
            recomendacion.placa,
            recomendacion.recomendacion,
            recomendacion.tema_mecanico || null,
            recomendacion.tema_estetico || null
          ]
        );
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

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
    await pool.query(
      `DELETE gr
       FROM giras_taller_recomendaciones gr
       JOIN giras_taller gt ON gt.id = gr.gira_id
       WHERE gr.gira_id = ? AND gt.sede IN (?)`,
      [req.params.id, sedesPermitidas]
    );
    await pool.query("DELETE FROM giras_taller WHERE id = ? AND sede IN (?)", [req.params.id, sedesPermitidas]);
    res.redirect("/giras");
  } catch (error) {
    console.error("ERROR eliminar gira:", error);
    res.status(500).send("Error interno");
  }
});

module.exports = router;
