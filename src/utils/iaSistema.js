const pool = require("../db");

function puedeVerCompras(user) {
  return ["ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"].includes(user.rol);
}

function puedeVerOperaciones(user) {
  return user.rol !== "CONTABILIDAD";
}

function puedeVerMinae(user) {
  return ["ADMIN", "TRAMITES"].includes(user.rol);
}

function obtenerSedeFiltro(req) {
  const user = req.session.user;
  if (!user) return null;

  if (user.rol === "ADMIN") {
    if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
      return req.session.sedeSeleccionada;
    }
    return null;
  }

  return req.session.sedeSeleccionada || user.sede || null;
}

function aplicarSede(alias, sedeFiltro, params, column = "sede") {
  if (!sedeFiltro) return "";
  params.push(sedeFiltro);
  return ` AND ${alias}.${column} = ?`;
}

async function safeQuery(sql, params = [], fallback = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    console.warn("IA query omitida:", error.code || error.message);
    return fallback;
  }
}

function rowsToPlain(rows) {
  return (rows || []).map(row => {
    const limpio = {};
    Object.entries(row).forEach(([key, value]) => {
      if (value instanceof Date) {
        limpio[key] = value.toISOString().slice(0, 10);
      } else {
        limpio[key] = value;
      }
    });
    return limpio;
  });
}

function normalizarTexto(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function detectarIntencion(pregunta = "") {
  const texto = normalizarTexto(pregunta);
  const incluye = (...palabras) => palabras.some(palabra => texto.includes(palabra));
  const placas = [...new Set((String(pregunta).toUpperCase().match(/\b[A-Z]{1,4}\d{3,6}\b/g) || [])
    .filter(valor => !/^F\d+$/i.test(valor)))];
  const poNumeros = [...new Set((String(pregunta).match(/\b20\d{2}-\d{1,5}\b/g) || []))];
  const posiblesFacturas = [...new Set((String(pregunta).match(/\b(?:factura|fac|f)[\s#:.-]*([A-Z0-9-]{3,})/gi) || [])
    .map(match => match.replace(/^(factura|fac|f)[\s#:.-]*/i, "").trim().toUpperCase())
    .filter(Boolean))];

  return {
    original: pregunta,
    texto,
    placas,
    poNumeros,
    posiblesFacturas,
    temas: {
      mantenimientos: incluye("mantenimiento", "mant", "taller", "atrasado", "pendiente", "programado", "cerrar"),
      unidades: incluye("unidad", "unidades", "placa", "varada", "varado", "flota", "activa", "inactiva") || placas.length > 0,
      compras: incluye("compra", "compras", "orden", "po", "proveedor", "factura", "pagar", "abono", "nota de credito", "nc", "vencida") || poNumeros.length > 0 || posiblesFacturas.length > 0,
      llantas: incluye("llanta", "llantas", "cotizacion", "cotizar", "comprada", "recibida"),
      dekra: incluye("dekra", "rtv", "revision tecnica"),
      minae: incluye("minae", "tramite", "cita", "vencimiento", "permiso"),
      resumen: incluye("resumen", "urgente", "prioridad", "prioridades", "que hago", "que debo", "hoy", "manana", "recomendacion")
    }
  };
}

function agregarPrioridad(prioridades, tipo, nivel, titulo, detalle, url = null) {
  prioridades.push({ tipo, nivel, titulo, detalle, url });
}

function crearAnalisisDeterministico(contexto) {
  const prioridades = [];
  const operaciones = contexto.resumen.operaciones || {};
  const compras = contexto.resumen.compras || {};
  const minae = contexto.resumen.minae || {};

  if (compras.facturas && Number(compras.facturas.vencidas || 0) > 0) {
    agregarPrioridad(
      prioridades,
      "Finanzas",
      "ALTA",
      "Facturas vencidas",
      `${compras.facturas.vencidas} factura(s) vencida(s). Priorice pago, abono o revisión de NC.`,
      "/compras/facturas?vencida=1"
    );
  }

  if (operaciones.mantenimientos && Number(operaciones.mantenimientos.atrasados || 0) > 0) {
    agregarPrioridad(
      prioridades,
      "Taller",
      "ALTA",
      "Mantenimientos atrasados",
      `${operaciones.mantenimientos.atrasados} mantenimiento(s) fuera de fecha.`,
      "/mantenimientos?filtro=atrasados"
    );
  }

  if (operaciones.unidades && Number(operaciones.unidades.varadas || 0) > 0) {
    agregarPrioridad(
      prioridades,
      "Flota",
      "ALTA",
      "Unidades varadas",
      `${operaciones.unidades.varadas} unidad(es) varada(s). Revise razón y prioridad operativa.`,
      "/unidades?varado=1"
    );
  }

  const llantasCompradas = (operaciones.llantas || []).find(item => item.estado === "COMPRADA");
  if (llantasCompradas && Number(llantasCompradas.cantidad || 0) > 0) {
    agregarPrioridad(
      prioridades,
      "Llantas",
      "MEDIA",
      "Llantas compradas sin recibir",
      `${llantasCompradas.cantidad} solicitud(es) comprada(s) pendientes de llegada.`,
      "/llantas"
    );
  }

  if (minae.proximos && minae.proximos.length > 0) {
    agregarPrioridad(
      prioridades,
      "MINAE",
      "MEDIA",
      "Trámites próximos",
      `${minae.proximos.length} trámite(s) no finalizado(s) con vencimiento registrado.`,
      "/minae"
    );
  }

  return {
    prioridades: prioridades.slice(0, 8),
    lectura: prioridades.length
      ? "Hay elementos que requieren seguimiento. Atienda primero nivel ALTA."
      : "No se detectan urgencias fuertes con los datos disponibles."
  };
}

async function obtenerContextoSistema(req, pregunta = "") {
  const user = req.session.user;
  const sedeFiltro = obtenerSedeFiltro(req);
  const intencion = detectarIntencion(pregunta);
  const contexto = {
    fecha: new Date().toISOString().slice(0, 10),
    pregunta,
    intencion,
    usuario: {
      nombre: user.nombre || user.usuario,
      usuario: user.usuario,
      rol: user.rol,
      sede: sedeFiltro || "TODAS"
    },
    permisos: {
      compras: puedeVerCompras(user),
      operaciones: puedeVerOperaciones(user),
      minae: puedeVerMinae(user)
    },
    resumen: {}
  };

  if (puedeVerOperaciones(user)) {
    const paramsUnidades = [];
    const whereUnidades = `WHERE 1=1${aplicarSede("u", sedeFiltro, paramsUnidades)}`;
    const [unidadesResumen] = await safeQuery(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN COALESCE(u.activa, 1) = 1 THEN 1 ELSE 0 END) AS activas,
         SUM(CASE WHEN COALESCE(u.activa, 1) = 0 THEN 1 ELSE 0 END) AS inactivas,
         SUM(CASE WHEN COALESCE(u.varada, 0) = 1 THEN 1 ELSE 0 END) AS varadas
       FROM unidades u
       ${whereUnidades}`,
      paramsUnidades,
      [{ total: 0, activas: 0, inactivas: 0, varadas: 0 }]
    );

    const paramsVaradas = [];
    const whereVaradas = `WHERE COALESCE(u.varada, 0) = 1${aplicarSede("u", sedeFiltro, paramsVaradas)}`;
    const unidadesVaradas = await safeQuery(
      `SELECT u.placa, u.sede, u.razon_varada
       FROM unidades u
       ${whereVaradas}
       ORDER BY u.sede, u.placa
       LIMIT 10`,
      paramsVaradas
    );

    const paramsMant = [];
    const sedeMant = aplicarSede("u", sedeFiltro, paramsMant);
    const [mantenimientosResumen] = await safeQuery(
      `SELECT
         SUM(CASE WHEN m.estado != 'CERRADO' THEN 1 ELSE 0 END) AS pendientes,
         SUM(CASE WHEN m.estado != 'CERRADO' AND DATE(m.fecha_programada) < CURDATE() THEN 1 ELSE 0 END) AS atrasados,
         SUM(CASE WHEN m.estado != 'CERRADO' AND DATE(m.fecha_programada) = CURDATE() THEN 1 ELSE 0 END) AS hoy,
         SUM(CASE WHEN m.estado != 'CERRADO' AND DATE(m.fecha_programada) = DATE_ADD(CURDATE(), INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS manana
       FROM mantenimientos m
       JOIN unidades u ON u.id = m.unidad_id
       WHERE 1=1${sedeMant}`,
      paramsMant,
      [{ pendientes: 0, atrasados: 0, hoy: 0, manana: 0 }]
    );

    const paramsProximos = [];
    const sedeProximos = aplicarSede("u", sedeFiltro, paramsProximos);
    const mantenimientosProximos = await safeQuery(
      `SELECT u.placa, u.sede, m.tipo, m.estado, m.plan, DATE_FORMAT(m.fecha_programada, '%Y-%m-%d') AS fecha
       FROM mantenimientos m
       JOIN unidades u ON u.id = m.unidad_id
       WHERE m.estado != 'CERRADO'
         AND DATE(m.fecha_programada) >= CURDATE()
         ${sedeProximos}
       ORDER BY m.fecha_programada ASC, u.placa
       LIMIT 10`,
      paramsProximos
    );

    const paramsAtrasados = [];
    const sedeAtrasados = aplicarSede("u", sedeFiltro, paramsAtrasados);
    const mantenimientosAtrasados = await safeQuery(
      `SELECT u.placa, u.sede, m.tipo, m.estado, m.plan, DATE_FORMAT(m.fecha_programada, '%Y-%m-%d') AS fecha
       FROM mantenimientos m
       JOIN unidades u ON u.id = m.unidad_id
       WHERE m.estado != 'CERRADO'
         AND DATE(m.fecha_programada) < CURDATE()
         ${sedeAtrasados}
       ORDER BY m.fecha_programada ASC, u.placa
       LIMIT 10`,
      paramsAtrasados
    );

    let busquedaPlacas = [];
    if (intencion.placas.length) {
      const paramsPlacas = [intencion.placas];
      const sedePlacas = aplicarSede("u", sedeFiltro, paramsPlacas);
      busquedaPlacas = await safeQuery(
        `SELECT
           u.placa,
           u.sede,
           u.activa,
           u.varada,
           u.razon_varada,
           m.id AS mantenimiento_id,
           m.tipo,
           m.estado AS mantenimiento_estado,
           m.plan,
           DATE_FORMAT(m.fecha_programada, '%Y-%m-%d') AS fecha_programada
         FROM unidades u
         LEFT JOIN mantenimientos m ON m.unidad_id = u.id AND m.estado != 'CERRADO'
         WHERE u.placa IN (?)
           ${sedePlacas}
         ORDER BY u.placa, m.fecha_programada ASC
         LIMIT 30`,
        paramsPlacas
      );
    }

    const paramsLlantas = [];
    const sedeLlantas = aplicarSede("s", sedeFiltro, paramsLlantas);
    const llantasResumen = await safeQuery(
      `SELECT s.estado, COUNT(*) AS cantidad
       FROM solicitudes_llantas s
       WHERE 1=1${sedeLlantas}
       GROUP BY s.estado`,
      paramsLlantas
    );

    const paramsDekra = [];
    const sedeDekra = aplicarSede("d", sedeFiltro, paramsDekra);
    const dekraResumen = await safeQuery(
      `SELECT d.estado, COUNT(*) AS cantidad
       FROM dekra_control d
       WHERE 1=1${sedeDekra}
       GROUP BY d.estado`,
      paramsDekra
    );

    contexto.resumen.operaciones = {
      unidades: unidadesResumen || {},
      unidadesVaradas: rowsToPlain(unidadesVaradas),
      mantenimientos: mantenimientosResumen || {},
      mantenimientosAtrasados: rowsToPlain(mantenimientosAtrasados),
      proximosMantenimientos: rowsToPlain(mantenimientosProximos),
      busquedaPlacas: rowsToPlain(busquedaPlacas),
      llantas: rowsToPlain(llantasResumen),
      dekra: rowsToPlain(dekraResumen)
    };
  }

  if (puedeVerCompras(user)) {
    const [facturasOrdenes] = await safeQuery(
      `SELECT
         COUNT(*) AS pendientes,
         COALESCE(SUM(GREATEST(o.total - COALESCE(o.nota_credito_monto, 0) - COALESCE(o.abono_monto, 0), 0)), 0) AS monto,
         SUM(CASE WHEN o.fecha_vencimiento_factura IS NOT NULL AND o.fecha_vencimiento_factura < CURDATE() THEN 1 ELSE 0 END) AS vencidas
       FROM ordenes_compra o
       WHERE o.facturada = 1
         AND COALESCE(o.pagada, 0) = 0
         AND GREATEST(o.total - COALESCE(o.nota_credito_monto, 0) - COALESCE(o.abono_monto, 0), 0) > 0`,
      [],
      [{ pendientes: 0, monto: 0, vencidas: 0 }]
    );

    const [facturasIndependientes] = await safeQuery(
      `SELECT
         COUNT(*) AS pendientes,
         COALESCE(SUM(GREATEST(f.monto - COALESCE(f.nota_credito_monto, 0) - COALESCE(f.abono_monto, 0), 0)), 0) AS monto
       FROM facturas f
       WHERE COALESCE(f.pagada, 0) = 0
         AND GREATEST(f.monto - COALESCE(f.nota_credito_monto, 0) - COALESCE(f.abono_monto, 0), 0) > 0`,
      [],
      [{ pendientes: 0, monto: 0 }]
    );

    const facturasPendientes = await safeQuery(
      `SELECT
         o.po_numero,
         o.factura,
         p.nombre AS proveedor,
         o.fecha_vencimiento_factura,
         GREATEST(o.total - COALESCE(o.nota_credito_monto, 0) - COALESCE(o.abono_monto, 0), 0) AS saldo
       FROM ordenes_compra o
       JOIN proveedores p ON p.id = o.proveedor_id
       WHERE o.facturada = 1
         AND COALESCE(o.pagada, 0) = 0
         AND GREATEST(o.total - COALESCE(o.nota_credito_monto, 0) - COALESCE(o.abono_monto, 0), 0) > 0
       ORDER BY o.fecha_vencimiento_factura ASC, p.nombre
       LIMIT 10`
    );

    const facturasPorProveedor = await safeQuery(
      `SELECT proveedor, COUNT(*) AS cantidad, SUM(saldo) AS saldo
       FROM (
         SELECT p.nombre AS proveedor,
                GREATEST(o.total - COALESCE(o.nota_credito_monto, 0) - COALESCE(o.abono_monto, 0), 0) AS saldo
         FROM ordenes_compra o
         JOIN proveedores p ON p.id = o.proveedor_id
         WHERE o.facturada = 1
           AND COALESCE(o.pagada, 0) = 0
           AND GREATEST(o.total - COALESCE(o.nota_credito_monto, 0) - COALESCE(o.abono_monto, 0), 0) > 0
         UNION ALL
         SELECT f.proveedor_nombre AS proveedor,
                GREATEST(f.monto - COALESCE(f.nota_credito_monto, 0) - COALESCE(f.abono_monto, 0), 0) AS saldo
         FROM facturas f
         WHERE COALESCE(f.pagada, 0) = 0
           AND GREATEST(f.monto - COALESCE(f.nota_credito_monto, 0) - COALESCE(f.abono_monto, 0), 0) > 0
       ) pendientes
       GROUP BY proveedor
       ORDER BY saldo DESC
       LIMIT 10`
    );

    const ordenesAbiertas = await safeQuery(
      `SELECT o.po_numero, p.nombre AS proveedor, o.estado, o.total, DATE_FORMAT(o.fecha, '%Y-%m-%d') AS fecha
       FROM ordenes_compra o
       JOIN proveedores p ON p.id = o.proveedor_id
       WHERE o.estado NOT IN ('RECIBIDA_TOTAL')
       ORDER BY o.fecha DESC
       LIMIT 10`
    );

    let busquedaCompras = [];
    if (intencion.poNumeros.length || intencion.posiblesFacturas.length) {
      const condiciones = [];
      const paramsBusqueda = [];
      if (intencion.poNumeros.length) {
        condiciones.push("o.po_numero IN (?)");
        paramsBusqueda.push(intencion.poNumeros);
      }
      if (intencion.posiblesFacturas.length) {
        condiciones.push("UPPER(o.factura) IN (?)");
        paramsBusqueda.push(intencion.posiblesFacturas);
      }

      busquedaCompras = await safeQuery(
        `SELECT o.po_numero, o.factura, p.nombre AS proveedor, o.estado, o.total, o.pagada,
                o.fecha_vencimiento_factura, o.observaciones
         FROM ordenes_compra o
         JOIN proveedores p ON p.id = o.proveedor_id
         WHERE ${condiciones.join(" OR ")}
         ORDER BY o.fecha DESC
         LIMIT 20`,
        paramsBusqueda
      );
    }

    contexto.resumen.compras = {
      facturas: {
        pendientes: Number(facturasOrdenes.pendientes || 0) + Number(facturasIndependientes.pendientes || 0),
        montoPendiente: Number(facturasOrdenes.monto || 0) + Number(facturasIndependientes.monto || 0),
        vencidas: Number(facturasOrdenes.vencidas || 0)
      },
      facturasPendientes: rowsToPlain(facturasPendientes),
      facturasPorProveedor: rowsToPlain(facturasPorProveedor),
      busquedaCompras: rowsToPlain(busquedaCompras),
      ordenesAbiertas: rowsToPlain(ordenesAbiertas)
    };
  }

  if (puedeVerMinae(user)) {
    const paramsMinae = [];
    const sedeMinae = aplicarSede("mt", sedeFiltro, paramsMinae);
    const minaeResumen = await safeQuery(
      `SELECT mt.estado, COUNT(*) AS cantidad
       FROM minae_tramites mt
       WHERE 1=1${sedeMinae}
       GROUP BY mt.estado`,
      paramsMinae
    );

    const paramsMinaeCriticos = [];
    const sedeMinaeCriticos = aplicarSede("mt", sedeFiltro, paramsMinaeCriticos);
    const minaeCriticos = await safeQuery(
      `SELECT mt.tipo, mt.sede, mt.negocio, mt.estado, mt.vencimiento, u.placa
       FROM minae_tramites mt
       JOIN unidades u ON u.id = mt.unidad_id
       WHERE mt.estado != 'FINALIZADO'
         AND mt.vencimiento IS NOT NULL
         ${sedeMinaeCriticos}
       ORDER BY mt.vencimiento ASC
       LIMIT 10`,
      paramsMinaeCriticos
    );

    contexto.resumen.minae = {
      resumen: rowsToPlain(minaeResumen),
      proximos: rowsToPlain(minaeCriticos)
    };
  }

  contexto.analisis = crearAnalisisDeterministico(contexto);

  return contexto;
}

function respuestaSinApiKey(contexto, pregunta) {
  const partes = [
    "La IA todavia no esta conectada porque falta configurar OPENAI_API_KEY en el archivo .env.",
    "Cuando se configure, podre responder preguntas sobre los datos del sistema con el contexto permitido para tu usuario.",
    "",
    "Mientras tanto, hice una lectura basica del sistema:",
    `Usuario: ${contexto.usuario.usuario} (${contexto.usuario.rol}) - Sede: ${contexto.usuario.sede}`
  ];

  if (contexto.resumen.operaciones) {
    const mant = contexto.resumen.operaciones.mantenimientos || {};
    const unidades = contexto.resumen.operaciones.unidades || {};
    partes.push(`Unidades: ${unidades.total || 0} total, ${unidades.varadas || 0} varadas.`);
    partes.push(`Mantenimientos: ${mant.pendientes || 0} pendientes, ${mant.atrasados || 0} atrasados, ${mant.manyana || mant.manana || 0} manana.`);
  }

  if (contexto.resumen.compras) {
    partes.push(`Facturas pendientes: ${contexto.resumen.compras.facturas.pendientes}, monto pendiente: ${contexto.resumen.compras.facturas.montoPendiente}.`);
  }

  if (contexto.analisis && contexto.analisis.prioridades.length) {
    partes.push("");
    partes.push("Prioridades detectadas:");
    contexto.analisis.prioridades.slice(0, 5).forEach((item, index) => {
      partes.push(`${index + 1}. [${item.nivel}] ${item.titulo}: ${item.detalle}`);
    });
  }

  partes.push("");
  partes.push(`Pregunta recibida: ${pregunta}`);
  return partes.join("\n");
}

function extraerTextoRespuesta(data) {
  if (data.output_text) return data.output_text;

  const textos = [];
  (data.output || []).forEach(item => {
    (item.content || []).forEach(content => {
      if (content.text) textos.push(content.text);
      if (content.type === "output_text" && content.text) textos.push(content.text);
    });
  });

  return textos.join("\n").trim() || "No pude generar una respuesta.";
}

async function preguntarIA(contexto, pregunta) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      modo: "sin_api_key",
      respuesta: respuestaSinApiKey(contexto, pregunta)
    };
  }

  const systemPrompt = [
    "Eres el asistente interno de Gas Tomza para el sistema de mantenimiento, compras y tramites.",
    "Piensa como un coordinador operativo senior: primero entiende la pregunta, luego cruza los datos disponibles, y al final recomienda acciones.",
    "Responde en español claro, practico y con criterio.",
    "Usa solo el contexto JSON entregado. No inventes datos que no esten ahi.",
    "Dale más peso a contexto.intencion, contexto.analisis.prioridades y a las listas especificas de busqueda.",
    "Si la pregunta menciona una placa, PO o factura, revisa primero busquedaPlacas o busquedaCompras.",
    "Si hay prioridades nivel ALTA, deben salir arriba.",
    "Formato recomendado: 1) Respuesta directa, 2) Hallazgos, 3) Qué hacer, 4) Dónde abrir.",
    "Si falta informacion, dilo y sugiere donde revisar dentro del sistema.",
    "No prometas que hiciste cambios. La IA solo analiza y orienta; no edita datos.",
    "No muestres contraseñas, tokens, SQL ni datos tecnicos sensibles.",
    "Evita respuestas largas si no hacen falta, pero no seas superficial."
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }]
        },
        {
          role: "user",
          content: [{
            type: "input_text",
            text: `Contexto del sistema:\n${JSON.stringify(contexto, null, 2)}\n\nPregunta del usuario:\n${pregunta}`
          }]
        }
      ],
      max_output_tokens: 1100,
      temperature: 0.2
    })
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data.error && data.error.message ? data.error.message : "Error consultando IA";
    throw new Error(message);
  }

  return {
    modo: "openai",
    respuesta: extraerTextoRespuesta(data)
  };
}

module.exports = {
  detectarIntencion,
  obtenerContextoSistema,
  preguntarIA
};
