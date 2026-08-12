const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  agregarTallerParaMecanico,
  expandirSedesEquivalentes,
  etiquetaSede: etiquetaSedeTomza,
  esUsuarioTodasSedes,
  obtenerTodasSedes,
  obtenerSedesTransporte,
  sedeGranelDesdeUsuario
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
const ROLES_RESUMEN_EJECUTIVO = ["ADMIN", "TALLER", "PROVEEDURIA", "PROVEEDURIA_TALLER", "TRAMITES"];

const FAMILIAS_GASTO = [
  { clave: "llantas", nombre: "Llantas", color: "#2563eb", palabras: ["llanta", "llantas", "aro", "aros", "rin", "rines"] },
  { clave: "frenos", nombre: "Frenos y seguridad", color: "#dc2626", palabras: ["freno", "frenos", "fibra", "fibras", "clutch", "embrague", "seguridad", "pito"] },
  { clave: "motor", nombre: "Motor y transmisión", color: "#ea580c", palabras: ["motor", "turbo", "inyector", "caja", "transmision", "transmisión", "compresor", "arrancador", "alternador", "bomba", "manguera"] },
  { clave: "aceites", nombre: "Aceites y fluidos", color: "#0f766e", palabras: ["aceite", "engrase", "filtro", "filtros", "hidraulico", "hidráulico", "coolant", "agua", "radiador", "liquido", "líquido"] },
  { clave: "electrico", nombre: "Eléctrico y luces", color: "#7c3aed", palabras: ["luz", "luces", "bateria", "batería", "cable", "electrico", "eléctrico", "sensor", "marcha", "tablero", "velocimetro", "velocímetro"] },
  { clave: "carroceria", nombre: "Carrocería y estética", color: "#d97706", palabras: ["cabina", "puerta", "bumper", "cajon", "cajón", "rotulacion", "rotulación", "calcomania", "pintura", "pintar", "asiento", "vidrio", "parabrisas"] },
  { clave: "proveedor", nombre: "Pago de proveedor", color: "#0891b2", palabras: ["pago proveedor", "proveedor"] },
  { clave: "caja", nombre: "Caja chica", color: "#f59e0b", palabras: ["caja chica", "reintegro"] },
  { clave: "general", nombre: "General / otros", color: "#64748b", palabras: [] }
];

const FAMILIAS_MANTENIMIENTO_RESUMEN = FAMILIAS_GASTO.filter(f => !["proveedor", "caja"].includes(f.clave));

function fechaCostaRica(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function fechaMesKey(value) {
  if (!value) return "Sin fecha";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return fechaCostaRica(value).slice(0, 7);
  }
  const texto = String(value);
  if (/^\d{4}-\d{2}/.test(texto)) return texto.slice(0, 7);
  const fecha = new Date(value);
  return Number.isNaN(fecha.getTime()) ? "Sin fecha" : fechaCostaRica(fecha).slice(0, 7);
}

function expandirSedeFiltro(sede) {
  if (!sede) return [];
  return expandirSedesEquivalentes(sede);
}

function etiquetaSede(sede) {
  if (!sede) return "TODAS";
  return etiquetaSedeTomza(sede);
}

function puedeUsarOficinaDiaDia(user) {
  return user && ROLES_OFICINA_DIA_DIA.includes(user.rol);
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function normalizarTexto(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizarPlacaLocal(placa) {
  return String(placa || "").toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
}

function esPlacaReal(placa) {
  const limpia = normalizarPlacaLocal(placa);
  return /^CL\d{5,6}$/.test(limpia) || /^C\d{5,6}$/.test(limpia) || /^S\d{5,6}$/.test(limpia);
}

function clasificarTexto(texto, familias = FAMILIAS_GASTO, fallbackClave = "general") {
  const normalizado = normalizarTexto(texto);
  let mejor = familias.find(f => f.clave === fallbackClave) || familias[familias.length - 1];
  let puntajeMejor = 0;

  familias.forEach(familia => {
    const puntaje = familia.palabras.reduce((total, palabra) => {
      const normalizada = normalizarTexto(palabra);
      if (!normalizada || !normalizado.includes(normalizada)) return total;
      return total + (normalizada.includes(" ") ? 3 : 1);
    }, 0);
    if (puntaje > puntajeMejor) {
      mejor = familia;
      puntajeMejor = puntaje;
    }
  });

  return mejor;
}

function recortarResumen(texto, limite = 150) {
  const limpio = String(texto || "").replace(/\s+/g, " ").trim();
  if (!limpio) return "-";
  return limpio.length > limite ? `${limpio.slice(0, limite - 3)}...` : limpio;
}

function describirGasto(item) {
  const descripcion = recortarResumen(item.descripcion, 85);
  const proveedor = recortarResumen(item.proveedor, 45);

  if (descripcion !== "-" && proveedor !== "-") return `${descripcion} · ${proveedor}`;
  if (descripcion !== "-") return descripcion;
  if (proveedor !== "-") return proveedor;
  return "Sin detalle";
}

function sumarGrupo(map, key, base = {}) {
  const nombre = key || "No registrado";
  if (!map.has(nombre)) {
    map.set(nombre, { nombre, total: 0, registros: 0, ...base });
  }
  return map.get(nombre);
}

function ordenarTop(map, limite = 10) {
  return Array.from(map.values())
    .sort((a, b) => Number(b.total || 0) - Number(a.total || 0) || String(a.nombre).localeCompare(String(b.nombre), "es"))
    .slice(0, limite);
}

function ordenarTopConteo(map, limite = 10) {
  return Array.from(map.values())
    .sort((a, b) => Number(b.registros || 0) - Number(a.registros || 0) || String(a.nombre).localeCompare(String(b.nombre), "es"))
    .slice(0, limite);
}

function armarFiltrosFecha(alias, fechaDesde, fechaHasta, params) {
  const partes = [];
  if (fechaDesde) {
    partes.push(`${alias} >= ?`);
    params.push(fechaDesde);
  }
  if (fechaHasta) {
    partes.push(`${alias} <= ?`);
    params.push(fechaHasta);
  }
  return partes;
}

async function resolverSedesUsuario(req) {
  const extras = await safeQuery(
    "SELECT sede FROM usuarios_sedes WHERE usuario_id = ?",
    [req.session.user.id],
    []
  );

  const esUsuarioPesados = req.session.user.rol === "SUPERVISOR_PESADO" ||
    String(req.session.user.usuario || "").trim().toLowerCase() === "pesados";
  const usuarioTodasSedes = esUsuarioTodasSedes(req.session.user);
  const sedeGranelUsuario = sedeGranelDesdeUsuario(req.session.user);
  const sedesPermitidas = usuarioTodasSedes
    ? await obtenerTodasSedes(pool)
    : sedeGranelUsuario
    ? [sedeGranelUsuario]
    : esUsuarioPesados
    ? await obtenerSedesTransporte(pool)
    : agregarTallerParaMecanico(req.session.user, [
        req.session.user.sede,
        ...extras.map(e => e.sede)
      ]);

  let sedeFiltro = null;
  if (usuarioTodasSedes) {
    if (req.query.sede && req.query.sede !== "TODAS") sedeFiltro = req.query.sede;
    else if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") sedeFiltro = req.session.sedeSeleccionada;
  } else if (req.query.sede && sedesPermitidas.includes(req.query.sede)) {
    sedeFiltro = req.query.sede;
  } else if (req.session.sedeSeleccionada && sedesPermitidas.includes(req.session.sedeSeleccionada)) {
    sedeFiltro = req.session.sedeSeleccionada;
  } else {
    sedeFiltro = sedeGranelUsuario || req.session.user.sede || null;
  }

  return {
    usuarioTodasSedes,
    sedesPermitidas,
    sedeFiltro,
    sedesFiltro: expandirSedeFiltro(sedeFiltro),
    sedeSeleccionadaVista: etiquetaSede(sedeFiltro)
  };
}

async function obtenerResumenEjecutivo({ fechaDesde, fechaHasta, sedesFiltro }) {
  const paramsOrdenes = [];
  const condicionesOrdenes = armarFiltrosFecha("o.fecha", fechaDesde, fechaHasta, paramsOrdenes);
  const whereOrdenes = condicionesOrdenes.length ? `WHERE ${condicionesOrdenes.join(" AND ")}` : "";

  const ordenesLineas = await safeQuery(`
    SELECT
      'ORDEN' AS fuente,
      o.id,
      o.fecha,
      o.po_numero,
      p.nombre AS proveedor,
      u.placa AS placa_registrada,
      UPPER(TRIM(COALESCE(
        REPLACE(REGEXP_SUBSTR(UPPER(COALESCE(d.codigo, '')), 'CL[[:space:]]*[0-9]{5,6}|C[[:space:]]*[0-9]{5,6}|S[[:space:]]*[0-9]{5,6}'), ' ', ''),
        CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 THEN REPLACE(NULLIF(UPPER(TRIM(o.placa_unidad)), ''), ' ', '') END,
        CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 THEN REPLACE(REGEXP_SUBSTR(UPPER(COALESCE(o.observaciones, '')), 'CL[[:space:]]*[0-9]{5,6}|C[[:space:]]*[0-9]{5,6}|S[[:space:]]*[0-9]{5,6}'), ' ', '') END,
        NULL
      ))) AS placa,
      u.sede AS sede,
      COALESCE(d.descripcion, o.observaciones, 'Orden de compra') AS descripcion,
      CASE
        WHEN d.id IS NULL THEN COALESCE(o.total, 0)
        ELSE COALESCE(d.subtotal, d.cantidad * d.precio_unitario, 0)
      END AS monto
    FROM ordenes_compra o
    LEFT JOIN proveedores p ON p.id = o.proveedor_id
    LEFT JOIN (
      SELECT orden_compra_id, COUNT(*) AS tiene_placas
      FROM ordenes_compra_detalle
      WHERE REGEXP_SUBSTR(UPPER(COALESCE(codigo, '')), 'CL[[:space:]]*[0-9]{5,6}|C[[:space:]]*[0-9]{5,6}|S[[:space:]]*[0-9]{5,6}') IS NOT NULL
      GROUP BY orden_compra_id
    ) placas_detalle ON placas_detalle.orden_compra_id = o.id
    LEFT JOIN ordenes_compra_detalle d ON d.orden_compra_id = o.id AND COALESCE(placas_detalle.tiene_placas, 0) > 0
    LEFT JOIN unidades u ON REPLACE(UPPER(TRIM(u.placa)), ' ', '') = UPPER(TRIM(COALESCE(
      REPLACE(REGEXP_SUBSTR(UPPER(COALESCE(d.codigo, '')), 'CL[[:space:]]*[0-9]{5,6}|C[[:space:]]*[0-9]{5,6}|S[[:space:]]*[0-9]{5,6}'), ' ', ''),
      CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 THEN REPLACE(NULLIF(UPPER(TRIM(o.placa_unidad)), ''), ' ', '') END,
      CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 THEN REPLACE(REGEXP_SUBSTR(UPPER(COALESCE(o.observaciones, '')), 'CL[[:space:]]*[0-9]{5,6}|C[[:space:]]*[0-9]{5,6}|S[[:space:]]*[0-9]{5,6}'), ' ', '') END
    )))
    ${whereOrdenes}
  `, paramsOrdenes, []);

  const pagosParams = [];
  const fechaPago = "COALESCE(pp.fecha_pago, pp.fecha_solicitud, DATE(pp.creado_en))";
  const condicionesPagos = armarFiltrosFecha(fechaPago, fechaDesde, fechaHasta, pagosParams);
  const wherePagos = condicionesPagos.length ? `WHERE ${condicionesPagos.join(" AND ")}` : "";
  const pagosProveedor = await safeQuery(`
    SELECT
      'PAGO_PROVEEDOR' AS fuente,
      pp.id,
      ${fechaPago} AS fecha,
      NULL AS po_numero,
      pp.proveedor_nombre AS proveedor,
      u.placa AS placa_registrada,
      NULLIF(pp.placa, '') AS placa,
      u.sede AS sede,
      COALESCE(pp.concepto, pp.numero_factura, 'Pago de proveedor') AS descripcion,
      COALESCE(pp.monto, 0) AS monto
    FROM pagos_proveedor pp
    LEFT JOIN unidades u ON REPLACE(UPPER(TRIM(u.placa)), ' ', '') = REPLACE(UPPER(TRIM(pp.placa)), ' ', '')
    ${wherePagos}
  `, pagosParams, []);

  const cajaParams = [];
  const condicionesCaja = armarFiltrosFecha("cc.fecha", fechaDesde, fechaHasta, cajaParams);
  const whereCaja = condicionesCaja.length ? `WHERE ${condicionesCaja.join(" AND ")}` : "";
  const cajaChica = await safeQuery(`
    SELECT
      'CAJA_CHICA' AS fuente,
      cc.id,
      cc.fecha,
      NULL AS po_numero,
      'Caja chica' AS proveedor,
      NULL AS placa_registrada,
      NULL AS placa,
      'General' AS sede,
      COALESCE(cc.observacion, 'Reintegro de caja chica') AS descripcion,
      COALESCE(cc.monto, 0) AS monto
    FROM caja_chica_reintegros cc
    ${whereCaja}
  `, cajaParams, []);

  const aplicaSede = (item) => !sedesFiltro.length || sedesFiltro.includes(item.sede);
  const gastos = [...ordenesLineas, ...pagosProveedor, ...cajaChica]
    .filter(aplicaSede)
    .map(item => {
      const placaLimpia = normalizarPlacaLocal(item.placa_registrada || item.placa);
      const placaReal = Boolean(item.placa_registrada) || esPlacaReal(placaLimpia);
      const sedeReal = Boolean(String(item.sede || "").trim()) && item.sede !== "General";
      const familia = item.fuente === "PAGO_PROVEEDOR"
        ? clasificarTexto(`${item.descripcion} ${item.proveedor}`, FAMILIAS_GASTO, "proveedor")
        : item.fuente === "CAJA_CHICA"
        ? FAMILIAS_GASTO.find(f => f.clave === "caja")
        : clasificarTexto(`${item.descripcion} ${item.proveedor}`);
      return {
        ...item,
        placa: placaReal ? placaLimpia : "",
        sede: sedeReal ? item.sede : "",
        tienePlacaReal: placaReal,
        tieneSedeReal: sedeReal,
        monto: Number(item.monto || 0),
        familia
      };
    })
    .filter(item => item.monto > 0);

  const porFuente = new Map();
  const porCategoria = new Map();
  const porProveedor = new Map();
  const porSede = new Map();
  const porPlaca = new Map();
  const porMes = new Map();
  const porDetalleGeneral = new Map();

  gastos.forEach(item => {
    const fuenteNombre = item.fuente === "ORDEN" ? "Órdenes de compra" : item.fuente === "PAGO_PROVEEDOR" ? "Pago proveedor" : "Caja chica";
    const fuente = sumarGrupo(porFuente, fuenteNombre);
    fuente.total += item.monto;
    fuente.registros += 1;

    const categoria = sumarGrupo(porCategoria, item.familia.nombre, { color: item.familia.color });
    categoria.total += item.monto;
    categoria.registros += 1;

    const proveedor = sumarGrupo(porProveedor, item.proveedor || "No registrado");
    proveedor.total += item.monto;
    proveedor.registros += 1;

    if (item.tieneSedeReal && item.tienePlacaReal) {
      const sede = sumarGrupo(porSede, etiquetaSedeTomza(item.sede));
      sede.total += item.monto;
      sede.registros += 1;
    }

    if (item.tienePlacaReal && item.tieneSedeReal) {
      const placa = sumarGrupo(porPlaca, item.placa, { sede: etiquetaSedeTomza(item.sede) });
      placa.total += item.monto;
      placa.registros += 1;
    }

    const mesKey = fechaMesKey(item.fecha);
    const mes = sumarGrupo(porMes, mesKey);
    mes.total += item.monto;
    mes.registros += 1;

    if (item.familia?.clave === "general") {
      const detalle = sumarGrupo(porDetalleGeneral, describirGasto(item));
      detalle.total += item.monto;
      detalle.registros += 1;
    }
  });

  const paramsMant = [];
  const condicionesPreventivos = armarFiltrosFecha("m.fecha_programada", fechaDesde, fechaHasta, paramsMant);
  if (sedesFiltro.length) {
    condicionesPreventivos.push("u.sede IN (?)");
    paramsMant.push(sedesFiltro);
  }
  const wherePreventivos = condicionesPreventivos.length ? `WHERE ${condicionesPreventivos.join(" AND ")}` : "";

  const paramsCorrectivos = [];
  const condicionesCorrectivos = armarFiltrosFecha("DATE(c.fecha)", fechaDesde, fechaHasta, paramsCorrectivos);
  if (sedesFiltro.length) {
    condicionesCorrectivos.push("COALESCE(u.sede, c.sede) IN (?)");
    paramsCorrectivos.push(sedesFiltro);
  }
  const whereCorrectivos = condicionesCorrectivos.length ? `WHERE ${condicionesCorrectivos.join(" AND ")}` : "";

  const preventivos = await safeQuery(`
    SELECT
      'PREVENTIVO' AS tipo_registro,
      m.id,
      u.placa,
      u.sede,
      m.estado,
      m.fecha_programada AS fecha,
      COALESCE(m.ejecucion, m.plan, m.tipo, '-') AS detalle
    FROM mantenimientos m
    JOIN unidades u ON u.id = m.unidad_id
    ${wherePreventivos}
    ORDER BY m.fecha_programada DESC, m.id DESC
    LIMIT 1500
  `, paramsMant, []);

  const correctivos = await safeQuery(`
    SELECT
      'CORRECTIVO' AS tipo_registro,
      c.id,
      u.placa,
      COALESCE(u.sede, c.sede) AS sede,
      'CERRADO' AS estado,
      c.fecha,
      CONCAT_WS(' ', c.trabajo_realizado, c.pendiente, GROUP_CONCAT(DISTINCT ct.trabajo SEPARATOR ' '), GROUP_CONCAT(DISTINCT ct.repuestos SEPARATOR ' ')) AS detalle
    FROM correctivos c
    JOIN unidades u ON u.id = c.unidad_id
    LEFT JOIN correctivo_trabajos ct ON ct.correctivo_id = c.id
    ${whereCorrectivos}
    GROUP BY c.id, u.placa, u.sede, c.sede, c.fecha, c.trabajo_realizado, c.pendiente
    ORDER BY c.fecha DESC, c.id DESC
    LIMIT 1500
  `, paramsCorrectivos, []);

  const mantenimientos = [...preventivos, ...correctivos].map(item => {
    const familia = clasificarTexto(item.detalle, FAMILIAS_MANTENIMIENTO_RESUMEN);
    return {
      ...item,
      familia,
      detalle: recortarResumen(item.detalle)
    };
  });

  const mantPorTipo = new Map();
  const mantPorFamilia = new Map();
  const mantPorSede = new Map();
  const mantPorPlaca = new Map();

  mantenimientos.forEach(item => {
    const tipo = sumarGrupo(mantPorTipo, item.tipo_registro);
    tipo.registros += 1;

    const familia = sumarGrupo(mantPorFamilia, item.familia.nombre, { color: item.familia.color });
    familia.registros += 1;

    if (item.sede) {
      const sede = sumarGrupo(mantPorSede, etiquetaSedeTomza(item.sede));
      sede.registros += 1;
    }

    if (esPlacaReal(item.placa) && item.sede) {
      const placa = sumarGrupo(mantPorPlaca, normalizarPlacaLocal(item.placa), { sede: etiquetaSedeTomza(item.sede) });
      placa.registros += 1;
    }
  });

  const totalGastos = gastos.reduce((sum, item) => sum + item.monto, 0);
  const fuentes = ordenarTop(porFuente, 10);
  const categorias = ordenarTop(porCategoria, 12);
  const detalleGeneralOtros = ordenarTop(porDetalleGeneral, 5);
  const proveedores = ordenarTop(porProveedor, 12);
  const sedes = ordenarTop(porSede, 12);
  const placas = ordenarTop(porPlaca, 15);
  const totalGastoConUnidad = Array.from(porPlaca.values()).reduce((sum, item) => sum + Number(item.total || 0), 0);
  const unidadesConGasto = porPlaca.size;
  const [flotaRow] = await safeQuery(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN COALESCE(activa, 1) = 1 THEN 1 ELSE 0 END) AS activas,
       SUM(CASE WHEN COALESCE(activa, 1) = 0 THEN 1 ELSE 0 END) AS inactivas,
       SUM(CASE WHEN COALESCE(varada, 0) = 1 THEN 1 ELSE 0 END) AS varadas
     FROM unidades
     ${sedesFiltro.length ? "WHERE sede IN (?)" : ""}`,
    sedesFiltro.length ? [sedesFiltro] : [],
    [{ total: 0, activas: 0, inactivas: 0, varadas: 0 }]
  );
  const totalUnidadesFlota = Number(flotaRow.total || 0);
  const unidadesActivasFlota = Number(flotaRow.activas || 0);
  const unidadesInactivasFlota = Number(flotaRow.inactivas || 0);
  const unidadesVaradasFlota = Number(flotaRow.varadas || 0);
  const costoPromedioPorUnidad = unidadesConGasto ? totalGastoConUnidad / unidadesConGasto : 0;
  const costoPromedioPorUnidadFlota = totalUnidadesFlota ? totalGastoConUnidad / totalUnidadesFlota : 0;
  const totalGastoSinUnidad = Math.max(totalGastos - totalGastoConUnidad, 0);
  const meses = Array.from(porMes.values()).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));
  const familiasMant = ordenarTopConteo(mantPorFamilia, 10);
  const sedesMant = ordenarTopConteo(mantPorSede, 10);
  const placasMant = ordenarTopConteo(mantPorPlaca, 12);
  const tiposMant = ordenarTopConteo(mantPorTipo, 5);

  const conclusiones = [];
  if (categorias[0]) conclusiones.push(`El mayor gasto está en ${categorias[0].nombre}, con ₡${Math.round(categorias[0].total).toLocaleString("es-CR")}.`);
  if (categorias[0]?.nombre === "General / otros" && detalleGeneralOtros.length) {
    const desglose = detalleGeneralOtros
      .slice(0, 4)
      .map(item => `${item.nombre} (₡${Math.round(item.total).toLocaleString("es-CR")})`)
      .join("; ");
    conclusiones.push(`Ese monto de General / otros se fue principalmente en: ${desglose}.`);
  }
  if (proveedores[0]) conclusiones.push(`El proveedor con mayor monto es ${proveedores[0].nombre}, acumulando ₡${Math.round(proveedores[0].total).toLocaleString("es-CR")}.`);
  if (placas[0]) conclusiones.push(`La placa con más gasto registrado es ${placas[0].nombre} (${placas[0].sede}), con ₡${Math.round(placas[0].total).toLocaleString("es-CR")}.`);
  if (unidadesConGasto) conclusiones.push(`El costo promedio por unidad es ₡${Math.round(costoPromedioPorUnidad).toLocaleString("es-CR")}, calculado sobre ${unidadesConGasto.toLocaleString("es-CR")} placa(s) con gasto en el periodo.`);
  if (familiasMant[0]) conclusiones.push(`El mantenimiento más frecuente es ${familiasMant[0].nombre}, con ${familiasMant[0].registros.toLocaleString("es-CR")} registro(s).`);
  if (sedesMant[0]) conclusiones.push(`La sede con más movimiento de taller es ${sedesMant[0].nombre}, con ${sedesMant[0].registros.toLocaleString("es-CR")} mantenimiento(s).`);

  return {
    totalGastos,
    totalRegistrosGasto: gastos.length,
    totalMantenimientos: mantenimientos.length,
    costoUnidad: {
      totalGastoConUnidad,
      totalUnidadesFlota,
      unidadesActivasFlota,
      unidadesInactivasFlota,
      unidadesVaradasFlota,
      unidadesConGasto,
      costoPromedioPorUnidad,
      costoPromedioPorUnidadFlota,
      totalGastoSinUnidad,
      formula: "Total de gastos con placa real registrada / cantidad de placas con gasto en el periodo"
    },
    fuentes,
    categorias,
    detalleGeneralOtros,
    proveedores,
    sedes,
    placas,
    meses,
    tiposMant,
    familiasMant,
    sedesMant,
    placasMant,
    recientesGasto: gastos
      .filter(item => item.tienePlacaReal && item.tieneSedeReal)
      .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))
      .slice(0, 12),
    recientesMantenimiento: mantenimientos.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0)).slice(0, 12),
    conclusiones
  };
}

// =========================================================
// DASHBOARD PRINCIPAL
// =========================================================

router.get("/resumen-ejecutivo", requireAuth, async (req, res) => {
  try {
    if (!ROLES_RESUMEN_EJECUTIVO.includes(req.session.user.rol)) {
      return res.status(403).send("No autorizado");
    }

    const fechaDesde = String(req.query.fecha_desde || "").trim();
    const fechaHasta = String(req.query.fecha_hasta || "").trim();
    const contextoSedes = await resolverSedesUsuario(req);
    const resumen = await obtenerResumenEjecutivo({
      fechaDesde,
      fechaHasta,
      sedesFiltro: contextoSedes.sedesFiltro
    });

    res.render("dashboard_resumen_ejecutivo", {
      user: req.session.user,
      resumen,
      filtros: {
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        sede: contextoSedes.sedeFiltro || "TODAS"
      },
      sedes: contextoSedes.sedesPermitidas,
      usuarioTodasSedes: contextoSedes.usuarioTodasSedes,
      sedeSeleccionada: contextoSedes.sedeSeleccionadaVista,
      etiquetaSede: etiquetaSedeTomza
    });
  } catch (error) {
    console.error("ERROR resumen ejecutivo:", error);
    res.status(500).send("Error cargando resumen ejecutivo");
  }
});

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
    const sedeGranelUsuario = sedeGranelDesdeUsuario(req.session.user);
    const sedesPermitidas = usuarioTodasSedes
      ? await obtenerTodasSedes(pool)
      : sedeGranelUsuario
      ? [sedeGranelUsuario]
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
        sedeFiltro = sedeGranelUsuario || req.session.user.sede;
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
