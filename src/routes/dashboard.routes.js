const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  agregarTallerParaMecanico,
  expandirSedesEquivalentes,
  etiquetaSede: etiquetaSedeTomza,
  esUsuarioPesados,
  esUsuarioTodasSedes,
  obtenerTodasSedes,
  obtenerSedesTransporte,
  sedeGranelDesdeUsuario
} = require("../utils/sedes");
const { extraerPlacasTexto, normalizarPlaca } = require("../utils/placas");
const { ensureNumeroMantenimientoColumn } = require("../utils/mantenimientosNumero");
const { ensureTipoMantenimientoColumns, normalizarTipoMantenimiento } = require("../utils/tipoMantenimiento");

const DB_CONNECTION_ERRORS = new Set(["ECONNRESET", "PROTOCOL_CONNECTION_LOST", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED"]);
const RESUMEN_EJECUTIVO_CACHE_MS = Number(process.env.RESUMEN_EJECUTIVO_CACHE_MS || 1000 * 60);
const RESUMEN_EJECUTIVO_STALE_MS = Number(process.env.RESUMEN_EJECUTIVO_STALE_MS || 1000 * 60 * 5);
const resumenEjecutivoCache = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function safeQuery(sql, params = [], fallback = []) {
  for (let intento = 1; intento <= 3; intento += 1) {
    try {
      const [rows] = await pool.query(sql, params);
      return rows;
    } catch (error) {
      const temporal = DB_CONNECTION_ERRORS.has(error.code);
      if (temporal && intento < 3) {
        console.warn(`Reintentando consulta de dashboard por error MySQL: ${error.code} (${intento}/3)`);
        await sleep(300 * intento);
        continue;
      }

      console.warn("Dashboard query omitida:", error.code || error.message);
      return fallback;
    }
  }

  return fallback;
}

const ROLES_OFICINA_DIA_DIA = ["ADMIN", "TALLER", "PROVEEDURIA_TALLER"];
const ROLES_RESUMEN_EJECUTIVO = ["ADMIN", "TALLER", "PROVEEDURIA", "PROVEEDURIA_TALLER", "TRAMITES"];

const FAMILIAS_GASTO = [
  { clave: "llantas", nombre: "Llantas", color: "#2563eb", palabras: ["llanta", "llantas", "aro", "aros", "rin", "rines"] },
  { clave: "frenos", nombre: "Frenos y seguridad", color: "#dc2626", palabras: ["freno", "frenos", "fibra", "fibras", "friccion", "fricción", "seguridad", "pito", "zapata", "zapatas", "tambor", "tambores", "disco", "discos", "plato"] },
  { clave: "motor", nombre: "Motor y transmisión", color: "#ea580c", palabras: ["motor", "turbo", "inyector", "inyectores", "inyeccion", "inyección", "caja", "transmision", "transmisión", "clutch", "embrague", "compresor", "bomba", "manguera", "cabezote", "culata", "overh", "overhaul", "isx", "detroit", "s60", "s-60", "manifold", "multiple", "múltiple", "piston", "pistón", "block", "viela", "vielas", "cigueñal", "ciguenal", "diferencial", "rockwell", "sincronizador", "fan c", "kysor", "tubo", "union", "unión", "codo", "abrazadera", "abrasadera"] },
  { clave: "aceites", nombre: "Aceites y fluidos", color: "#0f766e", palabras: ["aceite", "aceites", "mobil", "movil", "pico", "liasa", "pico liasa", "pico & liasa", "pico y liasa", "engrase", "filtro", "filtros", "hidraulico", "hidráulico", "coolant", "agua", "radiador", "liquido", "líquido"] },
  { clave: "suspension", nombre: "Suspensión y dirección", color: "#16a34a", palabras: ["suspension", "suspensión", "resorte", "resortes", "amortiguador", "balancin", "balancín", "rotula", "rótula", "barra", "direccion", "dirección", "tensor", "buje", "bushing", "pin", "muelle"] },
  { clave: "rodamientos", nombre: "Rodamientos y retenes", color: "#0e7490", palabras: ["roll", "rol ", "rodamiento", "cojinete", "reten", "retén", "retenedor", "sello", "camisa", "bocina", "porta roll"] },
  { clave: "electrico", nombre: "Eléctrico y luces", color: "#7c3aed", palabras: ["luz", "luces", "bateria", "batería", "cable", "electrico", "eléctrico", "sensor", "marcha", "tablero", "velocimetro", "velocímetro", "selenoide", "solenoide", "relay", "flasher", "halogeno", "halógeno", "bombillo", "switch", "fusible", "conector", "terminal", "alternador", "alternadores", "arrancador", "arrancadores", "programador", "programadores", "modulo", "módulo", "sam chassis", "sam chasis"] },
  { clave: "carroceria", nombre: "Carrocería y estética", color: "#d97706", palabras: ["cabina", "puerta", "bumper", "bumber", "cajon", "cajón", "rotulacion", "rotulación", "calcomania", "calcomanía", "pintura", "pintar", "asiento", "vidrio", "parabrisas", "espejo", "retrovisor", "grada", "estribo", "suministro", "suministros", "materiales", "almacen de materiales", "almacén de materiales", "capris", "herramienta", "herramientas", "broca", "brocha", "spray", "loctite", "sellador", "pegamento", "cincho", "cinchos", "soldadura", "guante", "gaza", "tornillo", "tuerca", "arandela"] },
  { clave: "general", nombre: "Gastos generales", color: "#64748b", palabras: ["general", "generales", "general taller", "gastos generales", "caja chica", "reintegro", "pantalla", "pantallas", "tablet", "tablets", "equipo taller", "lamina", "lámina", "tubo cuadrado", "plywood", "tubo negro", "estructura", "estructural", "silicon", "silicone", "sellador", "materiales", "almacen de materiales", "almacén de materiales", "viatico", "viáticos", "viaticos", "hospedaje", "mensajeria", "mensajería", "encomienda", "control de plaga", "recarga de oxigeno", "recarga de oxígeno", "oxigeno", "oxígeno"] }
];

const FAMILIAS_GASTO_OPERATIVO = FAMILIAS_GASTO;
const FAMILIAS_MANTENIMIENTO_RESUMEN = [
  {
    clave: "motor",
    nombre: "Motor",
    color: "#ea580c",
    palabras: ["motor", "turbo", "inyector", "inyectores", "inyeccion", "inyección", "bomba", "compresor", "cabezote", "culata", "overh", "overhaul", "isx", "detroit", "s60", "s-60", "manifold", "multiple", "múltiple", "piston", "pistón", "radiador", "enfriamiento", "calentamiento", "aceite", "aceites", "filtro", "filtros", "engrase", "fuga", "fugas", "combustible", "diesel", "coolant", "manguera"]
  },
  {
    clave: "frenos",
    nombre: "Frenos",
    color: "#dc2626",
    palabras: ["freno", "frenos", "fibra", "fibras", "zapata", "zapatas", "tambor", "tambores", "disco", "discos", "plato", "platos", "pedal", "pedales", "mordaza", "caliper", "caliperes", "aire de freno", "freno de mano"]
  },
  {
    clave: "transmision_tren",
    nombre: "Transmisión y tren motriz",
    color: "#7c3aed",
    palabras: ["transmision", "transmisión", "caja", "clutch", "embrague", "diferencial", "cardan", "cardán", "cruceta", "crucetas", "yugo", "eje", "ejes", "flecha", "corona", "piñon", "piñón", "retenedor", "reten", "retén", "tren motriz", "quinta rueda"]
  },
  {
    clave: "direccion_suspension",
    nombre: "Dirección suspensión",
    color: "#16a34a",
    palabras: ["direccion", "dirección", "suspension", "suspensión", "resorte", "resortes", "hoja de resorte", "hojas de resorte", "muelle", "muelles", "amortiguador", "amortiguadores", "rotula", "rótula", "rotulas", "rótulas", "barra", "barras", "balancin", "balancín", "buje", "bujes", "bushing", "tensor", "tensores", "pin", "pines", "hidraulico", "hidráulico", "manivela"]
  },
  {
    clave: "llantas",
    nombre: "Llantas",
    color: "#2563eb",
    palabras: ["llanta", "llantas", "aro", "aros", "rin", "rines", "válvula", "valvula", "trasera", "traseras", "delantera", "delanteras", "reencauche", "balanceo", "alineado", "alineamiento"]
  },
  {
    clave: "electrico",
    nombre: "Eléctrico",
    color: "#f59e0b",
    palabras: ["luz", "luces", "electrico", "eléctrico", "bateria", "batería", "baterias", "baterías", "alternador", "arrancador", "marcha", "cable", "cables", "sensor", "sensores", "tablero", "tacometro", "tacómetro", "velocimetro", "velocímetro", "selenoide", "solenoide", "relay", "flasher", "halogeno", "halógeno", "bombillo", "bombillos", "switch", "fusible", "fusibles", "arnes", "arnés"]
  }
];

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

function montoPagadoFacturaSql(alias, montoColumn) {
  const base = `GREATEST(COALESCE(${montoColumn}, 0) - COALESCE(${alias}.nota_credito_monto, 0), 0)`;
  return `CASE WHEN COALESCE(${alias}.monto_pagado_cierre, 0) > 0 THEN COALESCE(${alias}.monto_pagado_cierre, 0) WHEN COALESCE(${alias}.abono_monto, 0) > 0 THEN LEAST(COALESCE(${alias}.abono_monto, 0), ${base}) ELSE ${base} END`;
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
  return /^CL\d{5,6}$/.test(limpia) || /^C\d{5,6}$/.test(limpia) || /^S\d{5,6}$/.test(limpia) || /^EE\d{5,6}$/.test(limpia);
}

function crearIndiceUnidades(unidades = []) {
  const porPlaca = new Map();
  const porNumero = new Map();

  unidades.forEach(unidad => {
    const placa = normalizarPlaca(unidad.placa) || normalizarPlacaLocal(unidad.placa);
    if (!esPlacaReal(placa)) return;

    const registro = { placa, sede: unidad.sede || "" };
    porPlaca.set(normalizarPlacaLocal(placa), registro);

    const numero = placa.match(/\d{5,6}/)?.[0];
    if (numero && !porNumero.has(numero)) {
      porNumero.set(numero, registro);
    }
  });

  return { porPlaca, porNumero };
}

function resolverUnidadDesdeTextos(textos, indiceUnidades) {
  for (const texto of textos) {
    const placas = extraerPlacasTexto(texto);
    for (const placa of placas) {
      const normalizada = normalizarPlaca(placa) || normalizarPlacaLocal(placa);
      const exacta = indiceUnidades.porPlaca.get(normalizarPlacaLocal(normalizada));
      if (exacta) return exacta;

      const numero = normalizarPlacaLocal(normalizada).match(/\d{5,6}/)?.[0];
      const porNumero = numero ? indiceUnidades.porNumero.get(numero) : null;
      if (porNumero) return porNumero;
    }
  }

  return null;
}

function resolverUnidadGasto(item, indiceUnidades) {
  const placaDirecta = normalizarPlaca(item.placa_registrada || item.placa);
  const directa = placaDirecta ? indiceUnidades.porPlaca.get(normalizarPlacaLocal(placaDirecta)) : null;
  if (directa) return directa;

  return resolverUnidadDesdeTextos([
    item.codigo,
    item.placa_unidad,
    item.descripcion,
    item.observaciones
  ], indiceUnidades);
}

function clasificarTexto(texto, familias = FAMILIAS_GASTO, fallbackClave = "motor") {
  const normalizado = normalizarTexto(texto);
  let mejor = familias.find(f => f.clave === fallbackClave) || familias.find(f => f.clave === "motor") || familias[familias.length - 1];
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

function familiaPorClave(clave, familias = FAMILIAS_GASTO) {
  return familias.find(f => f.clave === clave) || familias[0];
}

function contienePalabras(texto, palabras = []) {
  const normalizado = normalizarTexto(texto);
  return palabras.some(palabra => normalizado.includes(normalizarTexto(palabra)));
}

function clasificarGastoPorReglas(item) {
  const textoTrabajo = normalizarTexto([
    item.codigo,
    item.descripcion,
    item.observaciones,
    item.placa_unidad
  ].filter(Boolean).join(" "));
  const textoCompleto = normalizarTexto([
    textoTrabajo,
    item.proveedor
  ].filter(Boolean).join(" "));

  if (contienePalabras(textoTrabajo, ["pantalla", "pantallas", "tablet", "tablets", "equipo taller"])) {
    return familiaPorClave("general", FAMILIAS_GASTO_OPERATIVO);
  }

  if (contienePalabras(textoTrabajo, ["viatico", "viáticos", "viaticos", "hospedaje", "mensajeria", "mensajería", "encomienda", "control de plaga", "recarga de oxigeno", "recarga de oxígeno", "oxigeno", "oxígeno"])) {
    return familiaPorClave("general", FAMILIAS_GASTO_OPERATIVO);
  }

  if (contienePalabras(textoTrabajo, ["lamina", "lámina", "tubo cuadrado", "plywood", "tubo negro estruct", "silicon", "silicone", "sikaflex", "envase", "pichinga", "aluminol", "restaurador de aluminio"])) {
    return familiaPorClave("general", FAMILIAS_GASTO_OPERATIVO);
  }

  if (
    /\brectific\w*\s+(de\s+)?tambor/.test(textoTrabajo) ||
    contienePalabras(textoTrabajo, ["freno", "frenos", "fibra", "fibras", "friccion", "fricción", "tambor", "tambores", "zapata", "zapatas", "disco de freno", "juego de mano", "tanque de vacio", "tanque de vacío", "liquido freno", "liquido de freno", "líquido freno", "líquido de freno", "dot3", "limpiador de frenos", "limpiador frenos", "valvula doble", "válvula doble", "valvula espalda", "válvula espalda", "valvula selectora", "válvula selectora", "valvula reguladora aire", "válvula reguladora aire", "valvula para proteccion", "válvula para protección", "manilla acople servicio", "servicio universal aire"])
  ) {
    return familiaPorClave("frenos", FAMILIAS_GASTO_OPERATIVO);
  }

  const compraRepuestosElectrico = contienePalabras(textoTrabajo, ["compra de repuestos"]) &&
    !contienePalabras(textoCompleto, ["rectificadora", "taller romeros", "romeros", "detroit", "detriot", "block", "viela", "vielas"]);
  if (contienePalabras(textoTrabajo, ["alternador", "alternadores", "arrancador", "arrancadores", "programador", "programadores", "sam chassis", "sam chasis", "modulo", "módulo", "bulbo", "bulvo", "thermo switch", "sensor", "selenoide", "solenoide", "electro valvula", "electroválvula", "cable de bateria", "cable thhn", "lampara led", "lámpara led", "lampara trasera", "lámpara trasera", "limpia contactos", "voltimetro", "voltímetro", "interruptor", "cigarrera", "servicios electromecanicos", "servicios electromecánicos", "diagnostico problema de computadora", "diagnóstico problema de computadora"]) || compraRepuestosElectrico || contienePalabras(textoCompleto, ["48 voltios"])) {
    return familiaPorClave("electrico", FAMILIAS_GASTO_OPERATIVO);
  }

  if (
    /\brectific\w*/.test(textoTrabajo) ||
    contienePalabras(textoTrabajo, ["diferencial", "rockwell", "set de empaques", "empaque inferior", "empaques inferior", "empaque tapa valvulas", "empaque tapa válvulas", "empaque cabez", "empaque cabezote", "empaque cabez.", "empaque escape", "empaque admision", "empaque admisión", "juego cilindro", "block", "viela", "vielas", "fan c", "kysor", "compresor", "cummins", "detroit", "detriot", "n-14", "isx", "manguera cooler", "cooler", "intercooler", "secador de aire", "secador ad", "valvula purga secador", "válvula purga secador", "faja", "faja abanico", "termostato", "deposito expansion", "depósito expansión", "deposito de expansion", "depósito de expansión", "tapon respiradero", "tapón respiradero", "tapon para tanque", "tapón para tanque", "combustible", "conect curvo flare", "comp ftl"]) ||
    (contienePalabras(textoTrabajo, ["repuestos"]) && contienePalabras(textoCompleto, ["rectificadora", "taller romeros", "romeros"]))
  ) {
    return familiaPorClave("motor", FAMILIAS_GASTO_OPERATIVO);
  }

  if (contienePalabras(textoCompleto, ["pico", "liasa", "pico liasa", "pico & liasa", "pico y liasa", "mobil", "movil"])) {
    return familiaPorClave("aceites", FAMILIAS_GASTO_OPERATIVO);
  }

  if (contienePalabras(textoTrabajo, ["aceite", "aceites", "filtro", "filtros", "engrase", "coolant", "liquido", "líquido", "hidraulico", "hidráulico", "grasa", "cubeta grasa", "tubo de grasa", "varsol", "desengrasante", "degreaser", "hand cleaner", "shampoo"])) {
    return familiaPorClave("aceites", FAMILIAS_GASTO_OPERATIVO);
  }

  if (contienePalabras(textoTrabajo, ["llanta", "llantas", "aro", "aros", "rin", "rines", "taco rueda", "esparrago rueda", "espárrago rueda", "vulca", "valv tubular", "válv tubular", "valvula tubular", "válvula tubular"])) {
    return familiaPorClave("llantas", FAMILIAS_GASTO_OPERATIVO);
  }

  if (contienePalabras(textoTrabajo, ["juego de patas", "patas", "trapos", "alfombra", "aislante de cobija", "recibidor cierre", "cierre goma", "extension cepillo", "extensión cepillo", "cepillo p/ lavar", "cepillo para lavar"])) {
    return familiaPorClave("carroceria", FAMILIAS_GASTO_OPERATIVO);
  }

  if (contienePalabras(textoTrabajo, ["soporte c/m", "soporte"])) {
    return familiaPorClave("carroceria", FAMILIAS_GASTO_OPERATIVO);
  }

  if (contienePalabras(textoTrabajo, ["base torpedo", "torpedo", "varillaje limpiadores", "limpiadores", "limpiador", "escobilla", "escobillas", "cinta reflectiva", "espejo", "esquinero", "crema pulir", "tapiceria", "tapicería", "asiento", "llavines", "cerrajeria", "cerrajería", "llave", "tape 3m", "pintura", "fast dry", "monocapa", "primer", "premier", "thinner", "multi-shine", "tire shine"])) {
    return familiaPorClave("carroceria", FAMILIAS_GASTO_OPERATIVO);
  }

  if (contienePalabras(textoTrabajo, ["extintor", "extintores", "pito caracol", "pito"])) {
    return familiaPorClave("frenos", FAMILIAS_GASTO_OPERATIVO);
  }

  if (contienePalabras(textoTrabajo, ["yugo", "cooplen", "coupling", "cruceta", "cardan", "cardán", "rash", "dientes"])) {
    return familiaPorClave("motor", FAMILIAS_GASTO_OPERATIVO);
  }

  if (contienePalabras(textoTrabajo, ["nivel de bolsas", "bolsas de m-2", "bolsa de aire", "deposito hidrahulico", "depósito hidrahulico", "deposito hidraulico", "depósito hidráulico", "chupon", "chupón"])) {
    return familiaPorClave("suspension", FAMILIAS_GASTO_OPERATIVO);
  }

  if (contienePalabras(textoTrabajo, ["bocina artillera", "bosina artillera", "bocina", "bosina"])) {
    return familiaPorClave("rodamientos", FAMILIAS_GASTO_OPERATIVO);
  }

  if (contienePalabras(textoTrabajo, ["cisterna", "cisternas", "carreta", "carretas", "trailer", "remolque"])) {
    return familiaPorClave("carroceria", FAMILIAS_GASTO_OPERATIVO);
  }

  return null;
}

function clasificarGastoOperativo(item) {
  if (item.placa === "ACEITES") return familiaPorClave("aceites");
  const familiaPorRegla = clasificarGastoPorReglas(item);
  if (familiaPorRegla) return familiaPorRegla;
  if (item.fuente === "PAGO_PROVEEDOR") {
    return clasificarTexto(`${item.descripcion} ${item.proveedor}`, FAMILIAS_GASTO_OPERATIVO, "general");
  }
  if (item.fuente === "CAJA_CHICA") return familiaPorClave("general");
  if (item.fuente === "ORDEN_MOTOR") {
    return clasificarTexto(`${item.descripcion} ${item.proveedor}`, FAMILIAS_GASTO_OPERATIVO, "general");
  }

  return clasificarTexto(`${item.descripcion} ${item.proveedor}`, FAMILIAS_GASTO_OPERATIVO, "general");
}

function clasificarDetalleTransportadora(item) {
  const placa = normalizarPlacaLocal(item.placa || item.placa_registrada || item.codigo || item.placa_unidad);
  const texto = normalizarTexto([
    item.placa,
    item.placa_registrada,
    item.codigo,
    item.placa_unidad,
    item.descripcion,
    item.observaciones,
    item.proveedor,
    item.sede
  ].filter(Boolean).join(" "));

  if (texto.includes("grua") || texto.includes("gruas")) {
    return { clave: "transportadora_gruas", nombre: "Grúas", color: "#f97316" };
  }

  if (texto.includes("tandem") || texto.includes("tamden")) {
    return { clave: "transportadora_tandem", nombre: "Tándem", color: "#0891b2" };
  }

  if (
    texto.includes("carreta") ||
    texto.includes("carretas") ||
    texto.includes("trailer") ||
    texto.includes("remolque") ||
    texto.includes("quinta rueda") ||
    texto.includes("hendrickson")
  ) {
    return { clave: "transportadora_carretas", nombre: "Carretas", color: "#2563eb" };
  }

  if (/^S\d{5,6}$/.test(placa) || texto.includes("cisterna") || texto.includes("cisternas")) {
    return { clave: "transportadora_cisternas", nombre: "Cisternas", color: "#0f766e" };
  }

  return { clave: "transportadora_cabezales", nombre: "Cabezales", color: "#0b3b82" };
}

function clasificarNegocioGasto(item) {
  const sedeNormalizada = normalizarTexto(item.sede);
  const placa = normalizarPlacaLocal(item.placa);
  const texto = normalizarTexto([
    item.placa,
    item.placa_registrada,
    item.codigo,
    item.placa_unidad,
    item.descripcion,
    item.observaciones,
    item.proveedor,
    item.sede
  ].filter(Boolean).join(" "));
  const esDetalleTransportadora = ["cabezales", "cisternas", "carretas", "tandem", "tamden"]
    .some(valor => sedeNormalizada.includes(valor));
  const textoTransportadora = contienePalabras(texto, [
    "transportadora", "cabezal", "cabezales", "cisterna", "cisternas", "carreta", "carretas",
    "freightliner", "cascadia", "columbia", "century", "andrea rv", "ortega y rojas",
    "quinta rueda", "trailer", "remolque"
  ]);
  const textoGranel = contienePalabras(texto, ["granel", "granelera", "graneleras"]);
  const textoCilindrero = contienePalabras(texto, [
    "hino", "dutro", "npr", "cilindrero", "cilindreros", "mercedes", "atego", "man 18400", "higer"
  ]);
  const esFiltroSinPlaca = !item.tienePlacaReal && contienePalabras(texto, ["filtro", "filtros"]);

  if (placa === "ACEITES" || (item.familia?.clave === "aceites" && !item.tienePlacaReal && !esFiltroSinPlaca)) {
    return { clave: "aceites", nombre: "Aceites", color: "#0f766e" };
  }

  if (item.familia?.clave === "general") {
    return { clave: "generales", nombre: "Generales", color: "#64748b" };
  }

  if (sedeNormalizada.includes("transportadora") || esDetalleTransportadora || /^S\d{5,6}$/.test(placa) || textoTransportadora) {
    return {
      clave: "transportadora",
      nombre: "Transportadora",
      color: "#0b3b82",
      subnegocio: clasificarDetalleTransportadora(item)
    };
  }

  if (sedeNormalizada.includes("granel") || textoGranel) {
    return { clave: "granel", nombre: "Graneleras", color: "#0f766e" };
  }

  if (
    sedeNormalizada.includes("taller") ||
    sedeNormalizada.includes("tecnico") ||
    sedeNormalizada.includes("tecnicos")
  ) {
    return { clave: "comodines", nombre: "Comodines", color: "#7c3aed" };
  }

  if (/^CL\d{5,6}$/.test(placa) || /^EE\d{5,6}$/.test(placa)) {
    return { clave: "comodines", nombre: "Comodines", color: "#7c3aed" };
  }

  if (/^C\d{5,6}$/.test(placa) || textoCilindrero) {
    return { clave: "cilindreros", nombre: "Hinos / cilindreros", color: "#ef233c" };
  }

  if (
    !item.tienePlacaReal ||
    !item.tieneSedeReal
  ) {
    return { clave: "comodines", nombre: "Comodines", color: "#7c3aed" };
  }

  return { clave: "cilindreros", nombre: "Hinos / cilindreros", color: "#ef233c" };
}

function clasificarTipoUnidadResumen(item, negocioInfo) {
  if (negocioInfo?.clave === "transportadora") {
    return negocioInfo.subnegocio || clasificarDetalleTransportadora(item);
  }

  if (negocioInfo?.clave === "cilindreros") {
    return { clave: "cilindreros", nombre: "Cilindreros", color: "#ef233c" };
  }

  if (negocioInfo?.clave === "granel") {
    return { clave: "graneles", nombre: "Graneles", color: "#0f766e" };
  }

  if (negocioInfo?.clave === "comodines") {
    return { clave: "comodines", nombre: "Comodines", color: "#7c3aed" };
  }

  if (negocioInfo?.clave === "aceites") {
    return { clave: "aceites", nombre: "Aceites", color: "#0f766e" };
  }

  return { clave: "generales", nombre: "Generales", color: "#64748b" };
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

function describirCompraExacta(item) {
  const descripcion = recortarResumen(item.descripcion, 150);
  const proveedor = recortarResumen(item.proveedor, 55);

  if (descripcion !== "-" && proveedor !== "-") return `${descripcion} · ${proveedor}`;
  if (descripcion !== "-") return descripcion;
  if (proveedor !== "-") return `Orden de compra · ${proveedor}`;
  return "Sin detalle";
}

const GRUPOS_COMPRA_GERENCIAL = [
  { nombre: "Escobillas", palabras: ["escobilla", "escobillas", "plumilla", "plumillas"] },
  { nombre: "Aceites y filtros", palabras: ["aceite", "aceites", "mobil", "movil", "pico", "liasa", "filtro", "filtros"] },
  { nombre: "Llantas y aros", palabras: ["llanta", "llantas", "aro", "aros", "rin", "rines"] },
  { nombre: "Frenos y fibras", palabras: ["freno", "frenos", "fibra", "fibras", "zapata", "tambor", "disco"] },
  { nombre: "Baterías", palabras: ["bateria", "batería", "baterias", "baterías"] },
  { nombre: "Luces y eléctrico", palabras: ["luz", "luces", "bombillo", "halogeno", "halógeno", "cable", "sensor", "fusible", "switch", "relay"] },
  { nombre: "Mangueras y conexiones", palabras: ["manguera", "mangueras", "conector", "terminal", "codo", "union", "unión", "abrazadera", "abrasadera"] },
  { nombre: "Motor y bombas", palabras: ["motor", "bomba", "turbo", "inyector", "cabezote", "compresor", "arrancador", "alternador"] },
  { nombre: "Suspensión y dirección", palabras: ["resorte", "muelle", "rotula", "rótula", "direccion", "dirección", "suspension", "suspensión", "amortiguador"] },
  { nombre: "Carrocería y pintura", palabras: ["cabina", "puerta", "bumper", "bumber", "cajon", "cajón", "pintura", "pintar", "calcomania", "calcomanía"] },
  { nombre: "Herramientas y materiales", palabras: ["herramienta", "herramientas", "broca", "brocha", "spray", "sellador", "pegamento", "soldadura", "tornillo", "tuerca", "arandela"] }
];

function describirCompraGerencial(item) {
  const texto = normalizarTexto(`${item.descripcion || ""} ${item.codigo || ""} ${item.observaciones || ""} ${item.proveedor || ""}`);
  const grupo = GRUPOS_COMPRA_GERENCIAL.find(grupo =>
    grupo.palabras.some(palabra => texto.includes(normalizarTexto(palabra)))
  );

  if (grupo) return grupo.nombre;

  const descripcion = recortarResumen(item.descripcion, 48);
  if (descripcion !== "-") return descripcion;

  const proveedor = recortarResumen(item.proveedor, 40);
  return proveedor !== "-" ? proveedor : "Compra general";
}

function urlMovimientoGasto(item) {
  if (!item || !item.id) return "";
  if (item.fuente === "ORDEN") return `/compras/ordenes/${item.id}/editar`;
  if (item.fuente === "ORDEN_MOTOR") return `/ordenes-motor/${item.id}/editar`;
  if (item.fuente === "PAGO_PROVEEDOR") return "/compras/pagos-proveedor";
  if (item.fuente === "CAJA_CHICA") return "/compras/caja-chica";
  return "";
}

function etiquetaFuenteGasto(item) {
  if (item.fuente === "ORDEN") return "Orden de compra";
  if (item.fuente === "ORDEN_MOTOR") return "Orden motor";
  if (item.fuente === "PAGO_PROVEEDOR") return "Pago proveedor";
  if (item.fuente === "CAJA_CHICA") return "Caja chica";
  return "Movimiento";
}

function movimientoParaRevisionPlaca(item) {
  const esAceite = item.familia?.clave === "aceites" || normalizarPlacaLocal(item.placa) === "ACEITES";
  return {
    id: item.id,
    fuente: item.fuente,
    fuente_nombre: etiquetaFuenteGasto(item),
    url: urlMovimientoGasto(item),
    po_numero: item.po_numero || "-",
    fecha: item.fecha || null,
    proveedor: item.proveedor || "No registrado",
    placa: item.placa || (esAceite ? "ACEITES" : "GENERAL"),
    sede: item.sede ? etiquetaSedeTomza(item.sede) : (esAceite ? "Aceites" : "Sin sede asignada"),
    descripcion: recortarResumen(item.descripcion || item.observaciones, 140),
    observaciones: recortarResumen(item.observaciones, 140),
    monto: Number(item.monto || 0),
    categoria: item.familia?.nombre || "Sin rubro"
  };
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

function normalizarPeriodoCierre(value) {
  const limpio = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(limpio) ? limpio : "";
}

function periodoCierreDesdeRango(fechaDesde, fechaHasta) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaDesde || ""))) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaHasta || ""))) return "";

  const desde = String(fechaDesde).slice(0, 10);
  const hasta = String(fechaHasta).slice(0, 10);
  const periodo = desde.slice(0, 7);
  if (hasta.slice(0, 7) !== periodo || !desde.endsWith("-01")) return "";

  const [year, month] = periodo.split("-").map(Number);
  const ultimoDia = new Date(year, month, 0).getDate();
  return hasta.endsWith(`-${String(ultimoDia).padStart(2, "0")}`) ? periodo : "";
}

function rangoFechasDesdePeriodo(periodo) {
  const limpio = normalizarPeriodoCierre(periodo);
  if (!limpio) return { desde: "", hasta: "" };

  const [year, month] = limpio.split("-").map(Number);
  const ultimoDia = new Date(year, month, 0).getDate();
  return {
    desde: `${limpio}-01`,
    hasta: `${limpio}-${String(ultimoDia).padStart(2, "0")}`
  };
}

function armarFiltrosFechaConPeriodoCierre(aliasFecha, aliasPeriodo, fechaDesde, fechaHasta, params, periodoCierre) {
  const periodo = normalizarPeriodoCierre(periodoCierre) || periodoCierreDesdeRango(fechaDesde, fechaHasta);

  if (periodo) {
    params.push(periodo);
    return [`${aliasPeriodo} = ?`];
  }

  return armarFiltrosFecha(aliasFecha, fechaDesde, fechaHasta, params);
}

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0]?.total || 0) > 0;
}

async function ensurePeriodoCierreColumns() {
  try {
    await ensureTipoMantenimientoColumns(pool);
    const targets = [
      ["pagos_proveedor", "fecha_pago"],
      ["ordenes_compra", "fecha_pago"],
      ["facturas", "fecha_pago"],
      ["ordenes_motor", "fecha_pago"]
    ];

    for (const [table, afterColumn] of targets) {
      if (table === "ordenes_motor") {
        if (!(await columnExists(table, "pagada"))) {
          await pool.query("ALTER TABLE ordenes_motor ADD COLUMN pagada TINYINT(1) NOT NULL DEFAULT 0 AFTER estado");
        }
        if (!(await columnExists(table, "fecha_pago"))) {
          await pool.query("ALTER TABLE ordenes_motor ADD COLUMN fecha_pago DATE NULL AFTER pagada");
        }
      }
      if (!(await columnExists(table, "periodo_cierre"))) {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN periodo_cierre CHAR(7) NULL AFTER ${afterColumn}`);
      }
      if (!(await columnExists(table, "monto_pagado_cierre"))) {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN monto_pagado_cierre DECIMAL(14,4) NULL AFTER periodo_cierre`);
      }
    }
  } catch (error) {
    console.warn("No se pudo verificar periodo_cierre:", error.code || error.message);
  }
}

async function resolverSedesUsuario(req) {
  const extras = await safeQuery(
    "SELECT sede FROM usuarios_sedes WHERE usuario_id = ?",
    [req.session.user.id],
    []
  );

  const usuarioPesados = esUsuarioPesados(req.session.user);
  const usuarioTodasSedes = esUsuarioTodasSedes(req.session.user);
  const sedeGranelUsuario = sedeGranelDesdeUsuario(req.session.user);
  const sedesPermitidas = usuarioTodasSedes
    ? await obtenerTodasSedes(pool)
    : sedeGranelUsuario
    ? [sedeGranelUsuario]
    : usuarioPesados
    ? await obtenerSedesTransporte(pool)
    : agregarTallerParaMecanico(req.session.user, [
        req.session.user.sede,
        ...extras.map(e => e.sede)
      ]);

  let sedeFiltro = null;
  if (usuarioTodasSedes) {
    if (req.query.sede && req.query.sede !== "TODAS") sedeFiltro = req.query.sede;
    else if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") sedeFiltro = req.session.sedeSeleccionada;
  } else if (usuarioPesados) {
    if (req.query.sede && req.query.sede !== "TODAS" && sedesPermitidas.includes(req.query.sede)) {
      sedeFiltro = req.query.sede;
    } else if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS" && sedesPermitidas.includes(req.session.sedeSeleccionada)) {
      sedeFiltro = req.session.sedeSeleccionada;
    }
  } else if (req.query.sede && sedesPermitidas.includes(req.query.sede)) {
    sedeFiltro = req.query.sede;
  } else if (req.session.sedeSeleccionada && sedesPermitidas.includes(req.session.sedeSeleccionada)) {
    sedeFiltro = req.session.sedeSeleccionada;
  } else {
    sedeFiltro = sedeGranelUsuario || req.session.user.sede || null;
  }

  return {
    usuarioTodasSedes,
    usuarioPesados,
    sedesPermitidas,
    sedeFiltro,
    sedesFiltro: !sedeFiltro && usuarioPesados ? expandirSedesEquivalentes(sedesPermitidas) : expandirSedeFiltro(sedeFiltro),
    sedeSeleccionadaVista: etiquetaSede(sedeFiltro)
  };
}

async function obtenerResumenEjecutivo({ fechaDesde, fechaHasta, sedesFiltro, periodoCierre }) {
  await ensurePeriodoCierreColumns();

  const periodoFiltro = normalizarPeriodoCierre(periodoCierre);
  const rangoPeriodo = rangoFechasDesdePeriodo(periodoFiltro);
  fechaDesde = fechaDesde || rangoPeriodo.desde;
  fechaHasta = fechaHasta || rangoPeriodo.hasta;

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
      COALESCE(o.tipo_mantenimiento, 'CORRECTIVO') AS tipo_mantenimiento,
      u.placa AS placa_registrada,
      UPPER(TRIM(COALESCE(
        REPLACE(REPLACE(REPLACE(REGEXP_SUBSTR(UPPER(CONCAT_WS(' ', d.codigo, d.descripcion)), 'CL[[:space:].-]*[0-9]{5,6}|EE[[:space:].-]*[0-9]{5,6}|C[[:space:].-]*[0-9]{5,6}|S[[:space:].-]*[0-9]{5,6}'), ' ', ''), '-', ''), '.', ''),
        CASE WHEN COALESCE(placas_detalle.placas_distintas, 0) = 1 THEN placas_detalle.placa_unica END,
        CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 THEN REPLACE(NULLIF(UPPER(TRIM(o.placa_unidad)), ''), ' ', '') END,
        CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 THEN REPLACE(REPLACE(REPLACE(REGEXP_SUBSTR(UPPER(COALESCE(o.observaciones, '')), 'CL[[:space:].-]*[0-9]{5,6}|EE[[:space:].-]*[0-9]{5,6}|C[[:space:].-]*[0-9]{5,6}|S[[:space:].-]*[0-9]{5,6}'), ' ', ''), '-', ''), '.', '') END,
        CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 AND (
          UPPER(TRIM(COALESCE(o.placa_unidad, ''))) IN ('ACEITE', 'ACEITES')
          OR UPPER(CONCAT_WS(' ', o.observaciones, p.nombre)) REGEXP 'ACEITE|ACEITES|MOBIL|MOVIL|PICO|LIASA'
        ) THEN 'ACEITES' END,
        CASE WHEN UPPER(TRIM(COALESCE(d.codigo, ''))) IN ('ACEITE', 'ACEITES') THEN 'ACEITES' END,
        NULL
      ))) AS placa,
      u.sede AS sede,
      d.codigo AS codigo,
      o.placa_unidad,
      o.observaciones,
      COALESCE(d.descripcion, o.observaciones, 'Orden de compra') AS descripcion,
      CASE
        WHEN d.id IS NULL THEN COALESCE(o.total, 0)
        WHEN COALESCE(detalle_totales.total_detalle, 0) > 0 AND COALESCE(o.total, 0) > 0
          THEN COALESCE(d.subtotal, d.cantidad * d.precio_unitario, 0) * (COALESCE(o.total, 0) / detalle_totales.total_detalle)
        ELSE COALESCE(d.subtotal, d.cantidad * d.precio_unitario, 0)
      END AS monto
    FROM ordenes_compra o
    LEFT JOIN proveedores p ON p.id = o.proveedor_id
    LEFT JOIN (
      SELECT
        orden_compra_id,
        COUNT(*) AS tiene_placas,
        COUNT(DISTINCT placa_detectada) AS placas_distintas,
        MIN(placa_detectada) AS placa_unica
      FROM (
        SELECT
          orden_compra_id,
          REPLACE(REPLACE(REPLACE(REGEXP_SUBSTR(UPPER(CONCAT_WS(' ', codigo, descripcion)), 'CL[[:space:].-]*[0-9]{5,6}|EE[[:space:].-]*[0-9]{5,6}|C[[:space:].-]*[0-9]{5,6}|S[[:space:].-]*[0-9]{5,6}'), ' ', ''), '-', ''), '.', '') AS placa_detectada
        FROM ordenes_compra_detalle
      ) placas_detectadas
      WHERE placa_detectada IS NOT NULL
      GROUP BY orden_compra_id
    ) placas_detalle ON placas_detalle.orden_compra_id = o.id
    LEFT JOIN (
      SELECT orden_compra_id, SUM(COALESCE(subtotal, cantidad * precio_unitario, 0)) AS total_detalle
      FROM ordenes_compra_detalle
      GROUP BY orden_compra_id
    ) detalle_totales ON detalle_totales.orden_compra_id = o.id
    LEFT JOIN ordenes_compra_detalle d ON d.orden_compra_id = o.id
    LEFT JOIN unidades u ON REPLACE(UPPER(TRIM(u.placa)), ' ', '') = UPPER(TRIM(COALESCE(
      REPLACE(REPLACE(REPLACE(REGEXP_SUBSTR(UPPER(CONCAT_WS(' ', d.codigo, d.descripcion)), 'CL[[:space:].-]*[0-9]{5,6}|EE[[:space:].-]*[0-9]{5,6}|C[[:space:].-]*[0-9]{5,6}|S[[:space:].-]*[0-9]{5,6}'), ' ', ''), '-', ''), '.', ''),
      CASE WHEN COALESCE(placas_detalle.placas_distintas, 0) = 1 THEN placas_detalle.placa_unica END,
      CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 THEN REPLACE(NULLIF(UPPER(TRIM(o.placa_unidad)), ''), ' ', '') END,
      CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 THEN REPLACE(REPLACE(REPLACE(REGEXP_SUBSTR(UPPER(COALESCE(o.observaciones, '')), 'CL[[:space:].-]*[0-9]{5,6}|EE[[:space:].-]*[0-9]{5,6}|C[[:space:].-]*[0-9]{5,6}|S[[:space:].-]*[0-9]{5,6}'), ' ', ''), '-', ''), '.', '') END,
      CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 AND (
        UPPER(TRIM(COALESCE(o.placa_unidad, ''))) IN ('ACEITE', 'ACEITES')
        OR UPPER(CONCAT_WS(' ', o.observaciones, p.nombre)) REGEXP 'ACEITE|ACEITES|MOBIL|MOVIL|PICO|LIASA'
      ) THEN 'ACEITES' END,
      CASE WHEN UPPER(TRIM(COALESCE(d.codigo, ''))) IN ('ACEITE', 'ACEITES') THEN 'ACEITES' END
    )))
    ${whereOrdenes}
  `, paramsOrdenes, []);

  const paramsOrdenesMotor = [];
  const condicionesOrdenesMotor = armarFiltrosFecha("om.fecha", fechaDesde, fechaHasta, paramsOrdenesMotor);
  const whereOrdenesMotor = condicionesOrdenesMotor.length ? `WHERE ${condicionesOrdenesMotor.join(" AND ")}` : "";
  const ordenesMotorLineas = await safeQuery(`
    SELECT
      'ORDEN_MOTOR' AS fuente,
      om.id,
      om.fecha,
      om.numero AS po_numero,
      p.nombre AS proveedor,
      COALESCE(om.tipo_mantenimiento, 'CORRECTIVO') AS tipo_mantenimiento,
      u.placa AS placa_registrada,
      UPPER(TRIM(COALESCE(
        REPLACE(REPLACE(REPLACE(REGEXP_SUBSTR(UPPER(CONCAT_WS(' ', d.codigo, d.descripcion, om.placa_unidad, om.observaciones)), 'CL[[:space:].-]*[0-9]{5,6}|EE[[:space:].-]*[0-9]{5,6}|C[[:space:].-]*[0-9]{5,6}|S[[:space:].-]*[0-9]{5,6}'), ' ', ''), '-', ''), '.', ''),
        REPLACE(NULLIF(UPPER(TRIM(om.placa_unidad)), ''), ' ', ''),
        NULL
      ))) AS placa,
      u.sede AS sede,
      d.codigo AS codigo,
      om.placa_unidad,
      om.observaciones,
      COALESCE(d.descripcion, om.observaciones, 'Orden motor') AS descripcion,
      CASE
        WHEN d.id IS NULL THEN COALESCE(om.total, 0)
        WHEN COALESCE(detalle_totales.total_detalle, 0) > 0 AND COALESCE(om.total, 0) > 0
          THEN COALESCE(d.subtotal, d.cantidad * d.precio_unitario, 0) * (COALESCE(om.total, 0) / detalle_totales.total_detalle)
        ELSE COALESCE(d.subtotal, d.cantidad * d.precio_unitario, 0)
      END AS monto
    FROM ordenes_motor om
    LEFT JOIN proveedores p ON p.id = om.proveedor_id
    LEFT JOIN (
      SELECT orden_motor_id, SUM(COALESCE(subtotal, cantidad * precio_unitario, 0)) AS total_detalle
      FROM ordenes_motor_detalle
      GROUP BY orden_motor_id
    ) detalle_totales ON detalle_totales.orden_motor_id = om.id
    LEFT JOIN ordenes_motor_detalle d ON d.orden_motor_id = om.id
    LEFT JOIN unidades u ON REPLACE(UPPER(TRIM(u.placa)), ' ', '') = UPPER(TRIM(COALESCE(
      REPLACE(REPLACE(REPLACE(REGEXP_SUBSTR(UPPER(CONCAT_WS(' ', d.codigo, d.descripcion, om.placa_unidad, om.observaciones)), 'CL[[:space:].-]*[0-9]{5,6}|EE[[:space:].-]*[0-9]{5,6}|C[[:space:].-]*[0-9]{5,6}|S[[:space:].-]*[0-9]{5,6}'), ' ', ''), '-', ''), '.', ''),
      REPLACE(NULLIF(UPPER(TRIM(om.placa_unidad)), ''), ' ', '')
    )))
    ${whereOrdenesMotor}
  `, paramsOrdenesMotor, []);

  const pagosParams = [];
  const fechaPago = "COALESCE(pp.fecha_pago, pp.fecha_solicitud, DATE(pp.creado_en))";
  const condicionesPagos = armarFiltrosFechaConPeriodoCierre(fechaPago, "pp.periodo_cierre", fechaDesde, fechaHasta, pagosParams, periodoCierre);
  const wherePagos = condicionesPagos.length ? `WHERE ${condicionesPagos.join(" AND ")}` : "";
  const pagosProveedor = await safeQuery(`
    SELECT
      'PAGO_PROVEEDOR' AS fuente,
      pp.id,
      ${fechaPago} AS fecha,
      pp.periodo_cierre,
        NULL AS po_numero,
        pp.proveedor_nombre AS proveedor,
        NULL AS tipo_mantenimiento,
        u.placa AS placa_registrada,
      NULLIF(pp.placa, '') AS placa,
      u.sede AS sede,
      COALESCE(pp.pagada, 0) AS pagada,
      pp.numero_factura AS codigo,
      NULL AS placa_unidad,
      pp.concepto AS observaciones,
      COALESCE(pp.concepto, pp.numero_factura, pp.proveedor_nombre, 'Sin concepto registrado') AS descripcion,
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
      NULL AS tipo_mantenimiento,
      NULL AS placa_registrada,
      NULL AS placa,
      'General' AS sede,
      NULL AS codigo,
      NULL AS placa_unidad,
      cc.observacion AS observaciones,
      COALESCE(cc.observacion, 'Reintegro de caja chica') AS descripcion,
      COALESCE(cc.monto, 0) AS monto
    FROM caja_chica_reintegros cc
    ${whereCaja}
  `, cajaParams, []);

  const facturasPagadasParams = [];
  const condicionesFacturasOrdenesPagadas = armarFiltrosFechaConPeriodoCierre("o.fecha_pago", "o.periodo_cierre", fechaDesde, fechaHasta, facturasPagadasParams, periodoCierre);
  const whereFacturasOrdenesPagadas = condicionesFacturasOrdenesPagadas.length
    ? `AND ${condicionesFacturasOrdenesPagadas.join(" AND ")}`
    : "";
  const facturasIndependientesParams = [];
  const condicionesFacturasIndependientesPagadas = armarFiltrosFechaConPeriodoCierre("f.fecha_pago", "f.periodo_cierre", fechaDesde, fechaHasta, facturasIndependientesParams, periodoCierre);
  const whereFacturasIndependientesPagadas = condicionesFacturasIndependientesPagadas.length
    ? `AND ${condicionesFacturasIndependientesPagadas.join(" AND ")}`
    : "";
  const [facturasPagadasRow] = await safeQuery(`
    SELECT
      COALESCE(SUM(monto_pagado), 0) AS total,
      COUNT(*) AS movimientos
    FROM (
      SELECT ${montoPagadoFacturaSql("o", "o.total")} AS monto_pagado
      FROM ordenes_compra o
      WHERE o.facturada = 1
        AND COALESCE(o.pagada, 0) = 1
        ${whereFacturasOrdenesPagadas}
      UNION ALL
      SELECT ${montoPagadoFacturaSql("f", "f.monto")} AS monto_pagado
      FROM facturas f
      WHERE COALESCE(f.pagada, 0) = 1
        ${whereFacturasIndependientesPagadas}
    ) pagadas
  `, [...facturasPagadasParams, ...facturasIndependientesParams], [{ total: 0, movimientos: 0 }]);

  const unidadesReferencia = await safeQuery(
    "SELECT placa, sede FROM unidades WHERE placa IS NOT NULL AND TRIM(placa) <> ''",
    [],
    []
  );
  const indiceUnidades = crearIndiceUnidades(unidadesReferencia);
  const condicionesLogistica = ["lt.tipo_mantenimiento IN ('CORRECTIVO','PREVENTIVO')"];
  const paramsLogistica = [];
  if (fechaDesde) {
    condicionesLogistica.push("lt.fecha >= DATE_SUB(?, INTERVAL 45 DAY)");
    paramsLogistica.push(fechaDesde);
  }
  if (fechaHasta) {
    condicionesLogistica.push("lt.fecha <= ?");
    paramsLogistica.push(fechaHasta);
  }
  if (sedesFiltro.length) {
    condicionesLogistica.push("(lt.sede IN (?) OR lt.sede IS NULL OR lt.sede = '')");
    paramsLogistica.push(sedesFiltro);
  }
  const logisticaRows = await safeQuery(
    `SELECT placa, fecha, tipo_mantenimiento
     FROM logistica_taller lt
     WHERE ${condicionesLogistica.join(" AND ")}
     ORDER BY fecha DESC, id DESC`,
    paramsLogistica,
    []
  );
  const logisticaPorPlaca = new Map();
  logisticaRows.forEach(row => {
    const placa = normalizarPlaca(row.placa) || normalizarPlacaLocal(row.placa);
    if (!esPlacaReal(placa)) return;
    const key = normalizarPlacaLocal(placa);
    if (!logisticaPorPlaca.has(key)) logisticaPorPlaca.set(key, []);
    logisticaPorPlaca.get(key).push({
      fecha: row.fecha ? new Date(row.fecha) : null,
      tipo: normalizarTipoMantenimiento(row.tipo_mantenimiento)
    });
  });

  const tipoLogisticaPara = (placa, fecha) => {
    const key = normalizarPlacaLocal(placa);
    const lista = logisticaPorPlaca.get(key) || [];
    if (!lista.length) return null;
    const fechaItem = fecha ? new Date(fecha) : null;
    if (!fechaItem || Number.isNaN(fechaItem.getTime())) return lista[0].tipo;
    const antes = lista.find(item => item.fecha && item.fecha <= fechaItem);
    return (antes || lista[0]).tipo;
  };

  const aplicaSede = (item) => !sedesFiltro.length || sedesFiltro.includes(item.sede);
  const gastos = [...ordenesLineas, ...ordenesMotorLineas, ...pagosProveedor, ...cajaChica]
    .map(item => {
      const unidadResuelta = resolverUnidadGasto(item, indiceUnidades);
      const placaNormalizada = normalizarPlaca(item.placa_registrada || item.placa);
      const placaLimpia = unidadResuelta?.placa || (esPlacaReal(placaNormalizada) ? placaNormalizada : "");
      const placaReal = esPlacaReal(placaLimpia);
      const sedeFinal = unidadResuelta?.sede || item.sede || "";
      const sedeReal = Boolean(String(sedeFinal || "").trim()) && sedeFinal !== "General";
      const familia = clasificarGastoOperativo(item);
      return {
        ...item,
        tipo_mantenimiento: ["ORDEN", "ORDEN_MOTOR"].includes(item.fuente)
          ? (tipoLogisticaPara(placaLimpia, item.fecha) || normalizarTipoMantenimiento(item.tipo_mantenimiento))
          : null,
        placa: placaReal ? placaLimpia : "",
        sede: sedeReal ? sedeFinal : "",
        tienePlacaReal: placaReal,
        tieneSedeReal: sedeReal,
        monto: Number(item.monto || 0),
        familia
      };
    })
    .filter(aplicaSede)
    .filter(item => item.monto > 0);

  const porFuente = new Map();
  const porCategoria = new Map();
  const porProveedor = new Map();
  const porSede = new Map();
  const porPlaca = new Map();
  const porMes = new Map();
  const porDetalleGeneral = new Map();
  const porDescripcion = new Map();
  const porNegocio = new Map();
  const porRubroNegocio = new Map();
  const porNegocioRubro = new Map();
  const porTipoUnidadPlaca = new Map();

  gastos.forEach(item => {
    const fuenteNombre = item.fuente === "ORDEN"
      ? "Órdenes de compra"
      : item.fuente === "ORDEN_MOTOR"
      ? "Órdenes motor"
      : item.fuente === "PAGO_PROVEEDOR"
      ? "Pago proveedor"
      : "Caja chica";
    const fuente = sumarGrupo(porFuente, fuenteNombre);
    fuente.total += item.monto;
    fuente.registros += 1;

    const negocioInfo = clasificarNegocioGasto(item);
    const rubroInfo = item.familia;

    const categoria = sumarGrupo(porCategoria, rubroInfo.nombre, { color: rubroInfo.color });
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

    const mesKey = item.fuente === "PAGO_PROVEEDOR" && item.periodo_cierre
      ? item.periodo_cierre
      : fechaMesKey(item.fecha);
    const mes = sumarGrupo(porMes, mesKey);
    mes.total += item.monto;
    mes.registros += 1;

    const descripcion = sumarGrupo(porDescripcion, describirCompraExacta(item), {
      categoria: rubroInfo.nombre,
      color: rubroInfo.color
    });
    descripcion.total += item.monto;
    descripcion.registros += 1;

    const tipoUnidadInfo = clasificarTipoUnidadResumen(item, negocioInfo);
    const rubroNombre = rubroInfo?.nombre || "Sin rubro";
    const rubroColor = rubroInfo?.color || "#64748b";

    const negocio = sumarGrupo(porNegocio, negocioInfo.nombre, {
      clave: negocioInfo.clave,
      color: negocioInfo.color,
      sedes: new Map(),
      placas: new Map(),
      compras: new Map(),
      subnegocios: new Map()
    });
    negocio.total += item.monto;
    negocio.registros += 1;

    const compraNegocio = sumarGrupo(negocio.compras, describirCompraGerencial(item), {
      categoria: rubroNombre,
      color: rubroColor,
      movimientos: []
    });
    compraNegocio.total += item.monto;
    compraNegocio.registros += 1;
    if (["generales", "aceites"].includes(negocioInfo.clave)) {
      compraNegocio.movimientos.push(movimientoParaRevisionPlaca(item));
    }

    const esGastoAceite = negocioInfo.clave === "aceites" || rubroInfo?.clave === "aceites";
    const sedeNegocio = item.tieneSedeReal ? etiquetaSedeTomza(item.sede) : (esGastoAceite ? "Aceites" : "General / taller");
    const sedeItem = sumarGrupo(negocio.sedes, sedeNegocio, { placas: new Map() });
    sedeItem.total += item.monto;
    sedeItem.registros += 1;

    const placaNegocio = item.tienePlacaReal ? item.placa : (esGastoAceite ? "ACEITES" : "GENERAL");
    const placaItem = sumarGrupo(negocio.placas, placaNegocio, { sede: sedeNegocio });
    placaItem.total += item.monto;
    placaItem.registros += 1;

    const placaSedeItem = sumarGrupo(sedeItem.placas, placaNegocio, { sede: sedeNegocio });
    placaSedeItem.total += item.monto;
    placaSedeItem.registros += 1;

    if (negocioInfo.subnegocio) {
      const subnegocio = sumarGrupo(negocio.subnegocios, negocioInfo.subnegocio.nombre, {
        clave: negocioInfo.subnegocio.clave,
        color: negocioInfo.subnegocio.color,
        sedes: new Map(),
        placas: new Map(),
        rubros: new Map()
      });
      subnegocio.total += item.monto;
      subnegocio.registros += 1;

      const rubroSubnegocio = sumarGrupo(subnegocio.rubros, rubroNombre, { color: rubroColor });
      rubroSubnegocio.total += item.monto;
      rubroSubnegocio.registros += 1;

      const sedeSubnegocio = sumarGrupo(subnegocio.sedes, sedeNegocio, { placas: new Map() });
      sedeSubnegocio.total += item.monto;
      sedeSubnegocio.registros += 1;

      const placaSubnegocio = sumarGrupo(subnegocio.placas, placaNegocio, { sede: sedeNegocio });
      placaSubnegocio.total += item.monto;
      placaSubnegocio.registros += 1;

      const placaSedeSubnegocio = sumarGrupo(sedeSubnegocio.placas, placaNegocio, { sede: sedeNegocio });
      placaSedeSubnegocio.total += item.monto;
      placaSedeSubnegocio.registros += 1;
    }

    const negocioRubro = sumarGrupo(porNegocioRubro, negocioInfo.nombre, {
      clave: negocioInfo.clave,
      color: negocioInfo.color,
      rubros: new Map()
    });
    negocioRubro.total += item.monto;
    negocioRubro.registros += 1;

    const rubroDelNegocio = sumarGrupo(negocioRubro.rubros, rubroNombre, {
      color: rubroColor,
      sedes: new Map(),
      placas: new Map()
    });
    rubroDelNegocio.total += item.monto;
    rubroDelNegocio.registros += 1;

    const sedeDelRubro = sumarGrupo(rubroDelNegocio.sedes, sedeNegocio, { placas: new Map() });
    sedeDelRubro.total += item.monto;
    sedeDelRubro.registros += 1;

    const movimientoRubro = movimientoParaRevisionPlaca({ ...item, familia: rubroInfo });

    const placaDelRubro = sumarGrupo(rubroDelNegocio.placas, placaNegocio, { sede: sedeNegocio, movimientos: [] });
    placaDelRubro.total += item.monto;
    placaDelRubro.registros += 1;
    placaDelRubro.movimientos.push(movimientoRubro);

    const placaSedeDelRubro = sumarGrupo(sedeDelRubro.placas, placaNegocio, { sede: sedeNegocio, movimientos: [] });
    placaSedeDelRubro.total += item.monto;
    placaSedeDelRubro.registros += 1;
    placaSedeDelRubro.movimientos.push(movimientoRubro);

    const rubroNegocio = sumarGrupo(porRubroNegocio, rubroNombre, {
      color: rubroColor,
      negocios: new Map()
    });
    rubroNegocio.total += item.monto;
    rubroNegocio.registros += 1;

    const negocioDelRubro = sumarGrupo(rubroNegocio.negocios, negocioInfo.nombre, {
      clave: negocioInfo.clave,
      color: negocioInfo.color
    });
    negocioDelRubro.total += item.monto;
    negocioDelRubro.registros += 1;

    if (item.tienePlacaReal || ["generales", "aceites"].includes(tipoUnidadInfo.clave)) {
      const tipoResumen = sumarGrupo(porTipoUnidadPlaca, tipoUnidadInfo.nombre, {
        clave: tipoUnidadInfo.clave,
        color: tipoUnidadInfo.color,
        placas: new Map()
      });
      tipoResumen.total += item.monto;
      tipoResumen.registros += 1;

      const placaResumenNombre = item.tienePlacaReal ? item.placa : tipoUnidadInfo.nombre.toUpperCase();
      const placaResumen = sumarGrupo(tipoResumen.placas, placaResumenNombre, {
        sede: item.tieneSedeReal ? etiquetaSedeTomza(item.sede) : "",
        rubros: new Map()
      });
      placaResumen.total += item.monto;
      placaResumen.registros += 1;
      if (!placaResumen.sede && item.tieneSedeReal) placaResumen.sede = etiquetaSedeTomza(item.sede);

      const rubroPlaca = sumarGrupo(placaResumen.rubros, rubroNombre, {
        color: rubroColor,
        movimientos: []
      });
      rubroPlaca.total += item.monto;
      rubroPlaca.registros += 1;
      rubroPlaca.movimientos.push(movimientoParaRevisionPlaca(item));
    }

    if (rubroInfo?.clave === "general") {
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
    const familia = clasificarTexto(item.detalle, FAMILIAS_MANTENIMIENTO_RESUMEN, "frenos");
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
  const mantFamiliaPorSede = new Map();

  mantenimientos.forEach(item => {
    const tipo = sumarGrupo(mantPorTipo, item.tipo_registro);
    tipo.registros += 1;

    const familia = sumarGrupo(mantPorFamilia, item.familia.nombre, { color: item.familia.color });
    familia.registros += 1;

    if (item.sede) {
      const sedeNombre = etiquetaSedeTomza(item.sede);
      const sede = sumarGrupo(mantPorSede, sedeNombre);
      sede.registros += 1;

      if (!mantFamiliaPorSede.has(sedeNombre)) {
        mantFamiliaPorSede.set(sedeNombre, {
          nombre: sedeNombre,
          registros: 0,
          familias: new Map()
        });
      }

      const sedeFamilias = mantFamiliaPorSede.get(sedeNombre);
      sedeFamilias.registros += 1;
      const familiaSede = sumarGrupo(sedeFamilias.familias, item.familia.nombre, { color: item.familia.color });
      familiaSede.registros += 1;
    }

    if (esPlacaReal(item.placa) && item.sede) {
      const placa = sumarGrupo(mantPorPlaca, normalizarPlacaLocal(item.placa), { sede: etiquetaSedeTomza(item.sede) });
      placa.registros += 1;
    }
  });

  const totalGastos = gastos.reduce((sum, item) => sum + item.monto, 0);
  const totalOrdenesCompra = gastos.filter(item => item.fuente === "ORDEN").reduce((sum, item) => sum + item.monto, 0);
  const totalOrdenesMotor = gastos.filter(item => item.fuente === "ORDEN_MOTOR").reduce((sum, item) => sum + item.monto, 0);
  const gastosMantenimientoPorTipo = ["CORRECTIVO", "PREVENTIVO"].map(tipo => {
    const items = gastos.filter(item => ["ORDEN", "ORDEN_MOTOR"].includes(item.fuente) && item.tipo_mantenimiento === tipo);
    return {
      tipo,
      nombre: tipo === "PREVENTIVO" ? "Preventivo" : "Correctivo",
      total: items.reduce((sum, item) => sum + item.monto, 0),
      registros: items.length
    };
  });
  const gastoCorrectivo = gastosMantenimientoPorTipo.find(item => item.tipo === "CORRECTIVO") || { total: 0, registros: 0 };
  const gastoPreventivo = gastosMantenimientoPorTipo.find(item => item.tipo === "PREVENTIVO") || { total: 0, registros: 0 };
  const totalPagosProveedor = gastos.filter(item => item.fuente === "PAGO_PROVEEDOR").reduce((sum, item) => sum + item.monto, 0);
  const pagosProveedorPagados = gastos.filter(item => item.fuente === "PAGO_PROVEEDOR" && Number(item.pagada || 0) === 1);
  const pagosProveedorPendientes = gastos.filter(item => item.fuente === "PAGO_PROVEEDOR" && Number(item.pagada || 0) !== 1);
  const totalPagosProveedorPagados = pagosProveedorPagados.reduce((sum, item) => sum + item.monto, 0);
  const totalPagosProveedorPendientes = pagosProveedorPendientes.reduce((sum, item) => sum + item.monto, 0);
  const totalCajaChica = gastos.filter(item => item.fuente === "CAJA_CHICA").reduce((sum, item) => sum + item.monto, 0);
  const totalFacturasPagadas = Number(facturasPagadasRow.total || 0);
  const totalOrdenesMotorPagadas = totalOrdenesMotor;
  const movimientosFacturasPagadas = Number(facturasPagadasRow.movimientos || 0);
  const movimientosOrdenesMotorPagadas = gastos.filter(item => item.fuente === "ORDEN_MOTOR").length;
  const movimientosCajaChica = gastos.filter(item => item.fuente === "CAJA_CHICA").length;
  const totalPagado = totalFacturasPagadas + totalOrdenesMotorPagadas + totalPagosProveedorPagados + totalCajaChica;
  const movimientosTotalPagado = movimientosFacturasPagadas + movimientosOrdenesMotorPagadas + pagosProveedorPagados.length + movimientosCajaChica;
  const fuentes = ordenarTop(porFuente, 10);
  const categorias = ordenarTop(porCategoria, 1000);
  const detalleGeneralOtros = ordenarTop(porDetalleGeneral, 1000);
  const resumenGeneralOtros = {
    total: detalleGeneralOtros.reduce((sum, item) => sum + Number(item.total || 0), 0),
    registros: detalleGeneralOtros.reduce((sum, item) => sum + Number(item.registros || 0), 0),
    conceptos: detalleGeneralOtros.length
  };
  const productosServicios = ordenarTop(porDescripcion, 80);
  const proveedores = ordenarTop(porProveedor, 20);
  const sedes = ordenarTop(porSede, 20);
  const placas = ordenarTop(porPlaca, 25);
  const negociosBase = [
    { clave: "cilindreros", nombre: "Hinos / cilindreros", color: "#ef233c" },
    { clave: "transportadora", nombre: "Transportadora", color: "#0b3b82" },
    { clave: "granel", nombre: "Graneleras", color: "#0f766e" },
    { clave: "comodines", nombre: "Comodines", color: "#7c3aed" },
    { clave: "aceites", nombre: "Aceites", color: "#0f766e" },
    { clave: "generales", nombre: "Generales", color: "#64748b" }
  ];
  const negociosGasto = negociosBase
    .map(base => {
      const item = porNegocio.get(base.nombre) || {
        ...base,
        total: 0,
        registros: 0,
        sedes: new Map(),
        placas: new Map(),
        compras: new Map(),
        subnegocios: new Map()
      };
      return {
        nombre: item.nombre,
        clave: item.clave,
        color: item.color,
        total: item.total,
        registros: item.registros,
        porcentaje: totalGastos ? Math.round((Number(item.total || 0) / totalGastos) * 100) : 0,
        sedes: ordenarTop(item.sedes, 12).map(sede => ({
          nombre: sede.nombre,
          total: sede.total,
          registros: sede.registros,
          placas: ordenarTop(sede.placas || new Map(), 15)
        })),
        placas: ordenarTop(item.placas, 8),
        subnegocios: ordenarTop(item.subnegocios || new Map(), 8).map(subnegocio => {
          const totalSubnegocio = Number(subnegocio.total || 0);
          return {
            nombre: subnegocio.nombre,
            clave: subnegocio.clave,
            color: subnegocio.color,
            total: subnegocio.total,
            registros: subnegocio.registros,
            porcentaje: Number(item.total || 0) ? Math.round((totalSubnegocio / Number(item.total || 1)) * 100) : 0,
            rubros: ordenarTop(subnegocio.rubros || new Map(), 8).map(rubro => ({
              nombre: rubro.nombre,
              color: rubro.color,
              total: rubro.total,
              registros: rubro.registros,
              porcentaje: totalSubnegocio ? Math.round((Number(rubro.total || 0) / totalSubnegocio) * 100) : 0
            })),
            sedes: ordenarTop(subnegocio.sedes || new Map(), 8).map(sede => ({
              nombre: sede.nombre,
              total: sede.total,
              registros: sede.registros,
              porcentaje: totalSubnegocio ? Math.round((Number(sede.total || 0) / totalSubnegocio) * 100) : 0,
              placas: ordenarTop(sede.placas || new Map(), 12).map(placa => ({
                nombre: placa.nombre,
                sede: placa.sede,
                total: placa.total,
                registros: placa.registros,
                porcentaje: Number(sede.total || 0) ? Math.round((Number(placa.total || 0) / Number(sede.total || 1)) * 100) : 0
              }))
            })),
            placas: ordenarTop(subnegocio.placas || new Map(), 12)
          };
        }),
        compras: ordenarTop(item.compras || new Map(), 12)
          .map(compra => ({
            ...compra,
            movimientos_total: Array.isArray(compra.movimientos) ? compra.movimientos.length : 0,
            movimientos: Array.isArray(compra.movimientos)
              ? compra.movimientos
                .sort((a, b) => Number(b.monto || 0) - Number(a.monto || 0))
                .slice(0, 80)
              : []
          }))
      };
    });
  const rubrosPorNegocio = negociosBase.map(base => {
    const item = porNegocioRubro.get(base.nombre) || {
      ...base,
      total: 0,
      registros: 0,
      rubros: new Map()
    };
    const totalNegocio = Number(item.total || 0);
    return {
      nombre: item.nombre,
      clave: item.clave,
      color: item.color,
      total: item.total,
      registros: item.registros,
      rubros: ordenarTop(item.rubros || new Map(), 10).map(rubro => ({
        nombre: rubro.nombre,
        color: rubro.color,
        total: rubro.total,
        registros: rubro.registros,
        porcentaje: totalNegocio ? Math.round((Number(rubro.total || 0) / totalNegocio) * 100) : 0,
        sedes: ordenarTop(rubro.sedes || new Map(), 8).map(sede => ({
          nombre: sede.nombre,
          total: sede.total,
          registros: sede.registros,
          porcentaje: Number(rubro.total || 0) ? Math.round((Number(sede.total || 0) / Number(rubro.total || 1)) * 100) : 0,
          placas: ordenarTop(sede.placas || new Map(), 10).map(placa => ({
            nombre: placa.nombre,
            sede: placa.sede,
            total: placa.total,
            registros: placa.registros,
            porcentaje: Number(sede.total || 0) ? Math.round((Number(placa.total || 0) / Number(sede.total || 1)) * 100) : 0,
            movimientos_total: Array.isArray(placa.movimientos) ? placa.movimientos.length : 0,
            movimientos: Array.isArray(placa.movimientos)
              ? placa.movimientos
                .sort((a, b) => Number(b.monto || 0) - Number(a.monto || 0))
                .slice(0, 80)
              : []
          }))
        })),
        placas: ordenarTop(rubro.placas || new Map(), 10).map(placa => ({
          nombre: placa.nombre,
          sede: placa.sede,
          total: placa.total,
          registros: placa.registros,
          porcentaje: Number(rubro.total || 0) ? Math.round((Number(placa.total || 0) / Number(rubro.total || 1)) * 100) : 0,
          movimientos_total: Array.isArray(placa.movimientos) ? placa.movimientos.length : 0,
          movimientos: Array.isArray(placa.movimientos)
            ? placa.movimientos
              .sort((a, b) => Number(b.monto || 0) - Number(a.monto || 0))
              .slice(0, 80)
            : []
        }))
      }))
    };
  });
  const negociosPorRubro = ordenarTop(porRubroNegocio, 1000).map(rubro => {
    const totalRubro = Number(rubro.total || 0);
    return {
      nombre: rubro.nombre,
      color: rubro.color,
      total: rubro.total,
      registros: rubro.registros,
      negocios: negociosBase
        .map(base => {
          const item = (rubro.negocios || new Map()).get(base.nombre) || {
            nombre: base.nombre,
            clave: base.clave,
            color: base.color,
            total: 0,
            registros: 0
          };
          return {
            nombre: item.nombre,
            clave: item.clave,
            color: item.color,
            total: item.total,
            registros: item.registros,
            porcentaje: totalRubro ? Math.round((Number(item.total || 0) / totalRubro) * 100) : 0
          };
        })
        .filter(item => Number(item.total || 0) > 0)
    };
  });
  const tiposUnidadResumenBase = [
    { clave: "cilindreros", nombre: "Cilindreros", color: "#ef233c" },
    { clave: "transportadora_cabezales", nombre: "Cabezales", color: "#0b3b82" },
    { clave: "transportadora_cisternas", nombre: "Cisternas", color: "#0f766e" },
    { clave: "transportadora_carretas", nombre: "Carretas", color: "#2563eb" },
    { clave: "transportadora_gruas", nombre: "Grúas", color: "#f97316" },
    { clave: "transportadora_tandem", nombre: "Tándem", color: "#0891b2" },
    { clave: "graneles", nombre: "Graneles", color: "#0f766e" },
    { clave: "comodines", nombre: "Comodines", color: "#7c3aed" },
    { clave: "aceites", nombre: "Aceites", color: "#0f766e" },
    { clave: "generales", nombre: "Generales", color: "#64748b" }
  ];
  const placasPorTipoUnidad = tiposUnidadResumenBase.map(base => {
    const tipo = porTipoUnidadPlaca.get(base.nombre) || {
      ...base,
      total: 0,
      registros: 0,
      placas: new Map()
    };
    const totalTipo = Number(tipo.total || 0);
    return {
      nombre: tipo.nombre,
      clave: tipo.clave,
      color: tipo.color,
      total: tipo.total,
      registros: tipo.registros,
      placas: ordenarTop(tipo.placas || new Map(), 1000).map(placa => {
        const totalPlaca = Number(placa.total || 0);
        return {
          nombre: placa.nombre,
          sede: placa.sede,
          total: placa.total,
          registros: placa.registros,
          porcentaje: totalTipo ? Math.round((totalPlaca / totalTipo) * 100) : 0,
          rubros: ordenarTop(placa.rubros || new Map(), 12).map(rubro => ({
            nombre: rubro.nombre,
            color: rubro.color,
            total: rubro.total,
            registros: rubro.registros,
            porcentaje: totalPlaca ? Math.round((Number(rubro.total || 0) / totalPlaca) * 100) : 0,
            movimientos_total: Array.isArray(rubro.movimientos) ? rubro.movimientos.length : 0,
            movimientos: Array.isArray(rubro.movimientos)
              ? rubro.movimientos
                .sort((a, b) => Number(b.monto || 0) - Number(a.monto || 0))
                .slice(0, 80)
              : []
          }))
        };
      })
    };
  }).filter(item => Number(item.total || 0) > 0);
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
  const trabajosPorSede = Array.from(mantFamiliaPorSede.values())
    .map(sede => ({
      nombre: sede.nombre,
      registros: sede.registros,
      trabajos: ordenarTopConteo(sede.familias, 6).map(item => ({
        ...item,
        porcentaje: sede.registros ? Math.round((Number(item.registros || 0) / sede.registros) * 100) : 0
      }))
    }))
    .sort((a, b) => Number(b.registros || 0) - Number(a.registros || 0) || String(a.nombre).localeCompare(String(b.nombre), "es"))
    .slice(0, 12);

  const conclusiones = [];
  if (categorias[0]) conclusiones.push(`El mayor gasto está en ${categorias[0].nombre}, con ₡${Math.round(categorias[0].total).toLocaleString("es-CR")}.`);
  if (proveedores[0]) conclusiones.push(`El proveedor con mayor monto es ${proveedores[0].nombre}, acumulando ₡${Math.round(proveedores[0].total).toLocaleString("es-CR")}.`);
  if (placas[0]) conclusiones.push(`La placa con más gasto registrado es ${placas[0].nombre} (${placas[0].sede}), con ₡${Math.round(placas[0].total).toLocaleString("es-CR")}.`);
  if (unidadesConGasto) conclusiones.push(`El costo promedio por unidad es ₡${Math.round(costoPromedioPorUnidad).toLocaleString("es-CR")}, calculado sobre ${unidadesConGasto.toLocaleString("es-CR")} placa(s) con gasto en el periodo.`);
  if (familiasMant[0]) conclusiones.push(`El mantenimiento más frecuente es ${familiasMant[0].nombre}, con ${familiasMant[0].registros.toLocaleString("es-CR")} registro(s).`);
  if (sedesMant[0]) conclusiones.push(`La sede con más movimiento de taller es ${sedesMant[0].nombre}, con ${sedesMant[0].registros.toLocaleString("es-CR")} mantenimiento(s).`);

  return {
    totalGastos,
    totalRegistrosGasto: gastos.length,
    totalMantenimientos: mantenimientos.length,
    resumenFinanciero: {
      totalOrdenesCompra,
      totalOrdenesMotor,
      totalGastoCorrectivo: gastoCorrectivo.total,
      totalGastoPreventivo: gastoPreventivo.total,
      totalOrdenesMotorPagadas,
      totalPagosProveedor,
      totalPagosProveedorPagados,
      totalPagosProveedorPendientes,
      totalCajaChica,
      totalFacturasPagadas,
      totalPagado,
      movimientosOrdenesCompra: gastos.filter(item => item.fuente === "ORDEN").length,
      movimientosOrdenesMotor: gastos.filter(item => item.fuente === "ORDEN_MOTOR").length,
      movimientosGastoCorrectivo: gastoCorrectivo.registros,
      movimientosGastoPreventivo: gastoPreventivo.registros,
      movimientosOrdenesMotorPagadas,
      movimientosPagosProveedor: gastos.filter(item => item.fuente === "PAGO_PROVEEDOR").length,
      movimientosPagosProveedorPagados: pagosProveedorPagados.length,
      movimientosPagosProveedorPendientes: pagosProveedorPendientes.length,
      movimientosCajaChica,
      movimientosFacturasPagadas,
      movimientosTotalPagado
    },
    gastosMantenimientoPorTipo,
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
    resumenGeneralOtros,
    productosServicios,
    proveedores,
    sedes,
    placas,
    negociosGasto,
    rubrosPorNegocio,
    negociosPorRubro,
    placasPorTipoUnidad,
    meses,
    tiposMant,
    familiasMant,
    sedesMant,
    placasMant,
    trabajosPorSede,
    recientesGasto: gastos
      .filter(item => item.tienePlacaReal && item.tieneSedeReal)
      .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))
      .slice(0, 12),
    recientesMantenimiento: mantenimientos.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0)).slice(0, 12),
    conclusiones
  };
}

function claveResumenEjecutivo({ fechaDesde, fechaHasta, sedesFiltro, periodoCierre }) {
  return JSON.stringify({
    fechaDesde: fechaDesde || "",
    fechaHasta: fechaHasta || "",
    periodoCierre: periodoCierre || "",
    sedes: Array.isArray(sedesFiltro) ? [...sedesFiltro].sort() : []
  });
}

async function obtenerResumenEjecutivoCached(params) {
  const key = claveResumenEjecutivo(params);
  const now = Date.now();
  const cached = resumenEjecutivoCache.get(key);

  if (cached && now - cached.createdAt <= RESUMEN_EJECUTIVO_CACHE_MS) {
    return { ...cached.data, desdeCache: true, cacheEdadSegundos: Math.round((now - cached.createdAt) / 1000) };
  }

  try {
    const data = await obtenerResumenEjecutivo(params);
    resumenEjecutivoCache.set(key, { data, createdAt: now });

    if (resumenEjecutivoCache.size > 30) {
      const entradas = [...resumenEjecutivoCache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
      entradas.slice(0, resumenEjecutivoCache.size - 30).forEach(([cacheKey]) => resumenEjecutivoCache.delete(cacheKey));
    }

    return data;
  } catch (error) {
    if (cached && now - cached.createdAt <= RESUMEN_EJECUTIVO_STALE_MS) {
      console.warn("Usando resumen ejecutivo en cache por error MySQL:", error.code || error.message);
      return {
        ...cached.data,
        desdeCache: true,
        cacheVencido: true,
        cacheEdadSegundos: Math.round((now - cached.createdAt) / 1000)
      };
    }

    throw error;
  }
}

// =========================================================
// DASHBOARD PRINCIPAL
// =========================================================

async function prepararResumenEjecutivoRequest(req) {
  const fechaDesde = String(req.query.fecha_desde || "").trim();
  const fechaHasta = String(req.query.fecha_hasta || "").trim();
  const periodoCierre = normalizarPeriodoCierre(req.query.periodo_cierre);
  const contextoSedes = await resolverSedesUsuario(req);
  const resumen = await obtenerResumenEjecutivoCached({
    fechaDesde,
    fechaHasta,
    sedesFiltro: contextoSedes.sedesFiltro,
    periodoCierre
  });

  return {
    resumen,
    filtros: {
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
      periodo_cierre: periodoCierre,
      sede: contextoSedes.sedeFiltro || "TODAS"
    },
    sedes: contextoSedes.sedesPermitidas,
    usuarioTodasSedes: contextoSedes.usuarioTodasSedes,
    sedeSeleccionada: contextoSedes.sedeSeleccionadaVista
  };
}

router.get("/resumen-ejecutivo/datos", requireAuth, async (req, res) => {
  try {
    if (!ROLES_RESUMEN_EJECUTIVO.includes(req.session.user.rol)) {
      return res.status(403).json({ ok: false, message: "No autorizado" });
    }

    const contexto = await prepararResumenEjecutivoRequest(req);
    res.json({
      ok: true,
      resumen: contexto.resumen,
      actualizado: new Intl.DateTimeFormat("es-CR", {
        timeZone: "America/Costa_Rica",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(new Date())
    });
  } catch (error) {
    console.error("ERROR resumen ejecutivo datos:", error);
    res.status(500).json({ ok: false, message: "Error cargando resumen ejecutivo" });
  }
});

router.get("/resumen-ejecutivo", requireAuth, async (req, res) => {
  try {
    if (!ROLES_RESUMEN_EJECUTIVO.includes(req.session.user.rol)) {
      return res.status(403).send("No autorizado");
    }

    const contexto = await prepararResumenEjecutivoRequest(req);

    res.render("dashboard_resumen_ejecutivo", {
      user: req.session.user,
      resumen: contexto.resumen,
      filtros: contexto.filtros,
      sedes: contexto.sedes,
      usuarioTodasSedes: contexto.usuarioTodasSedes,
      sedeSeleccionada: contexto.sedeSeleccionada,
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
    const usuarioPesados = esUsuarioPesados(req.session.user);
    const usuarioTodasSedes = esUsuarioTodasSedes(req.session.user);
    const sedeGranelUsuario = sedeGranelDesdeUsuario(req.session.user);
    const sedesPermitidas = usuarioTodasSedes
      ? await obtenerTodasSedes(pool)
      : sedeGranelUsuario
      ? [sedeGranelUsuario]
      : usuarioPesados
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
    } else if (usuarioPesados) {
      if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS" && sedesPermitidas.includes(req.session.sedeSeleccionada)) {
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

    const sedesFiltro = !sedeFiltro && usuarioPesados ? expandirSedesEquivalentes(sedesPermitidas) : expandirSedeFiltro(sedeFiltro);
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
    try {
      await ensureNumeroMantenimientoColumn(pool);
    } catch (error) {
      console.warn("No se pudo verificar numero de mantenimiento:", error.code || error.message);
    }

    const sqlHoy = `
      SELECT 
        m.id,
        m.numero_mantenimiento,
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
        AND COALESCE(tp.fecha_prioridad, DATE(tp.creado_en)) <= ?
    `;
    const prioridadesParams = [fechaHoy];
    if (sedesFiltro.length) {
      prioridadesSql += " AND (tp.sede IN (?) OR tp.sede IS NULL OR tp.sede = '')";
      prioridadesParams.push(sedesFiltro);
    }
    prioridadesSql += " ORDER BY COALESCE(tp.fecha_prioridad, DATE(tp.creado_en)) ASC, tp.creado_en DESC, tp.id DESC LIMIT 8";

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
      usuarioPesados,
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
