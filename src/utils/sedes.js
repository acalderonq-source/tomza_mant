const SEDES_GRANEL = [
  "Granel",
  "granel_cartago",
  "granel_alajuela",
  "granel_la_cruz",
  "granel_guapiles",
  "granel_perez_zeledon"
];

const SEDES_TRANSPORTADORA_DETALLE = [
  "Cabezales",
  "Cisternas",
  "Carretas",
  "Tandem"
];

const SEDES_TRANSPORTE = ["Transportadora", ...SEDES_TRANSPORTADORA_DETALLE, ...SEDES_GRANEL];
const SEDES_GRANEL_CARTAGO_EQUIVALENTES = ["Granel", "granel_cartago"];

const TODAS_SEDES = [
  "Cartago",
  "Guapiles",
  "La Cruz",
  "Transportadora",
  "Cabezales",
  "Cisternas",
  "Carretas",
  "Tandem",
  "Granel",
  "granel_cartago",
  "granel_alajuela",
  "granel_la_cruz",
  "granel_guapiles",
  "granel_perez_zeledon",
  "Orotina",
  "Alajuela",
  "Tecnicos",
  "Taller",
  "San Carlos",
  "Rio Claro",
  "Perez Zeledon",
  "Nicoya"
];

const ETIQUETAS_SEDES = {
  Granel: "Granel Cartago",
  granel_cartago: "Granel Cartago",
  granel_alajuela: "Granel Alajuela",
  granel_la_cruz: "Granel La Cruz",
  granel_guapiles: "Granel Guapiles",
  granel_perez_zeledon: "Granel Perez Zeledon",
  Tandem: "Tándem"
};

function limpiarSede(sede) {
  return String(sede || "").trim();
}

function normalizarSede(sede) {
  return limpiarSede(sede).toUpperCase();
}

function tituloDesdeSede(sede) {
  return limpiarSede(sede)
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, letra => letra.toUpperCase());
}

function etiquetaSede(sede) {
  const sedeLimpia = limpiarSede(sede);
  if (!sedeLimpia) return "-";
  return ETIQUETAS_SEDES[sedeLimpia] || (esSedeGranel(sedeLimpia) ? tituloDesdeSede(sedeLimpia) : sedeLimpia);
}

function esSedeGranel(sede) {
  return normalizarSede(sede).includes("GRANEL");
}

function esSedeGranelCartago(sede) {
  const sedeNormalizada = normalizarSede(sede);
  return SEDES_GRANEL_CARTAGO_EQUIVALENTES.some(valor => normalizarSede(valor) === sedeNormalizada);
}

function expandirSedeEquivalente(sede) {
  const sedeLimpia = limpiarSede(sede);
  if (!sedeLimpia) return [];
  const sedeNormalizada = normalizarSede(sedeLimpia);
  if (sedeNormalizada === "TRANSPORTADORA") return ["Transportadora", ...SEDES_TRANSPORTADORA_DETALLE];
  if (sedeNormalizada === "TANDEM" || sedeNormalizada === "TAMDEN") return ["Tandem", "Tándem"];
  if (esSedeGranelCartago(sedeLimpia)) return SEDES_GRANEL_CARTAGO_EQUIVALENTES;
  return [sedeLimpia];
}

function expandirSedesEquivalentes(sedes) {
  const lista = Array.isArray(sedes) ? sedes : [sedes];
  return unirSedes(lista.flatMap(expandirSedeEquivalente));
}

function esSedeTransporte(sede) {
  const sedeNormalizada = normalizarSede(sede);
  return sedeNormalizada === "TRANSPORTADORA" ||
    SEDES_TRANSPORTADORA_DETALLE.some(valor => normalizarSede(valor) === sedeNormalizada) ||
    esSedeGranel(sedeNormalizada);
}

function clasificarSubgrupoTransportadora({ sede, placa, texto } = {}) {
  const sedeNormalizada = normalizarSede(sede);
  const placaNormalizada = String(placa || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const textoNormalizado = normalizarSede([sede, placa, texto].filter(Boolean).join(" "));

  if (sedeNormalizada.includes("TANDEM") || sedeNormalizada.includes("TAMDEN") || textoNormalizado.includes("TANDEM") || textoNormalizado.includes("TAMDEN")) {
    return "Tándem";
  }

  if (
    sedeNormalizada.includes("CARRETA") ||
    textoNormalizado.includes("CARRETA") ||
    textoNormalizado.includes("TRAILER") ||
    textoNormalizado.includes("REMOLQUE") ||
    textoNormalizado.includes("QUINTA RUEDA") ||
    textoNormalizado.includes("HENDRICKSON")
  ) {
    return "Carretas";
  }

  if (sedeNormalizada.includes("CISTERNA") || placaNormalizada.startsWith("S") || textoNormalizado.includes("CISTERNA")) {
    return "Cisternas";
  }

  return "Cabezales";
}

function unirSedes(...listas) {
  const sedes = listas
    .flat()
    .map(limpiarSede)
    .filter(Boolean);
  return [...new Set(sedes)];
}

function sedeCanonicaVisible(sede) {
  const sedeLimpia = limpiarSede(sede);
  if (!sedeLimpia) return "";
  if (esSedeGranelCartago(sedeLimpia)) return "granel_cartago";

  const sedeNormalizada = normalizarSede(sedeLimpia);
  if (sedeNormalizada === "TÁNDEM" || sedeNormalizada === "TANDEM" || sedeNormalizada === "TAMDEN") {
    return "Tandem";
  }

  return sedeLimpia;
}

function unirSedesVisibles(...listas) {
  return unirSedes(...listas)
    .map(sedeCanonicaVisible)
    .filter(Boolean)
    .filter((sede, index, lista) => {
      const etiqueta = normalizarSede(etiquetaSede(sede));
      return lista.findIndex(item => normalizarSede(etiquetaSede(item)) === etiqueta) === index;
    });
}

function esUsuarioMecanico(user) {
  return user?.rol === "MECANICO" ||
    limpiarSede(user?.usuario).toLowerCase() === "mecanico";
}

function esUsuarioProveeduria(user) {
  return ["PROVEEDURIA", "PROVEEDURIA_TALLER"].includes(user?.rol) ||
    ["proveeduria", "proveeduria_taller"].includes(limpiarSede(user?.usuario).toLowerCase());
}

function sedeGranelDesdeUsuario(user) {
  const usuario = limpiarSede(user?.usuario).toLowerCase();
  return SEDES_GRANEL.find(sede => sede.toLowerCase() === usuario) || "";
}

function esUsuarioTodasSedes(user) {
  return ["ADMIN", "TALLER", "TRAMITES"].includes(user?.rol) || esUsuarioProveeduria(user);
}

function agregarTallerParaMecanico(user, sedes) {
  const lista = Array.isArray(sedes) ? sedes : [];
  const usuario = limpiarSede(user?.usuario).toLowerCase();
  const sede = limpiarSede(user?.sede);
  const puedeVerTaller = esUsuarioMecanico(user) && (usuario === "mecanico" || sede === "Taller");
  return puedeVerTaller ? unirSedes(lista, ["Taller"]) : unirSedes(lista);
}

async function obtenerSedesRegistradas(pool) {
  const [rows] = await pool.query(`
    SELECT DISTINCT sede
    FROM unidades
    WHERE sede IS NOT NULL AND TRIM(sede) <> ''
    UNION
    SELECT DISTINCT sede
    FROM usuarios_sedes
    WHERE sede IS NOT NULL AND TRIM(sede) <> ''
    ORDER BY sede
  `);
  return rows.map(row => row.sede).filter(Boolean);
}

async function obtenerTodasSedes(pool) {
  return unirSedesVisibles(TODAS_SEDES, await obtenerSedesRegistradas(pool));
}

async function obtenerSedesTransporte(pool) {
  const registradas = await obtenerSedesRegistradas(pool);
  return unirSedesVisibles(SEDES_TRANSPORTE, registradas.filter(esSedeTransporte));
}

function getSedesPermitidas(req) {
  const user = req.session.user;
  const sedeGranelUsuario = sedeGranelDesdeUsuario(user);
  let sedes = [];

  if (esUsuarioTodasSedes(user)) {

    if (
      req.session.sedeSeleccionada &&
      req.session.sedeSeleccionada !== "TODAS"
    ) {

      sedes = [req.session.sedeSeleccionada];

    } else {

      sedes = TODAS_SEDES;

    }

  } else if (sedeGranelUsuario) {

    if (
      req.session.sedeSeleccionada &&
      req.session.sedeSeleccionada !== "TODAS" &&
      req.session.sedeSeleccionada === sedeGranelUsuario
    ) {

      sedes = [req.session.sedeSeleccionada];

    } else {

      sedes = [sedeGranelUsuario];

    }

  } else if (String(user.usuario || "").trim().toLowerCase() === "pesados") {

    if (
      req.session.sedeSeleccionada &&
      req.session.sedeSeleccionada !== "TODAS" &&
      esSedeTransporte(req.session.sedeSeleccionada)
    ) {

      sedes = [req.session.sedeSeleccionada];

    } else {

      sedes = SEDES_TRANSPORTE;

    }

  } else {

    sedes = agregarTallerParaMecanico(user, [user.sede]);

  }

  return expandirSedesEquivalentes(sedes);
}

module.exports = {
  TODAS_SEDES,
  SEDES_GRANEL,
  SEDES_TRANSPORTADORA_DETALLE,
  SEDES_TRANSPORTE,
  etiquetaSede,
  esSedeGranelCartago,
  esSedeGranel,
  esSedeTransporte,
  clasificarSubgrupoTransportadora,
  expandirSedeEquivalente,
  expandirSedesEquivalentes,
  esUsuarioMecanico,
  esUsuarioProveeduria,
  esUsuarioTodasSedes,
  sedeGranelDesdeUsuario,
  agregarTallerParaMecanico,
  obtenerTodasSedes,
  obtenerSedesTransporte,
  getSedesPermitidas
};
