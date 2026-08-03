const SEDES_GRANEL = [
  "Granel",
  "granel_cartago",
  "granel_alajuela",
  "granel_la_cruz",
  "granel_guapiles",
  "granel_perez_zeledon"
];

const SEDES_TRANSPORTE = ["Transportadora", ...SEDES_GRANEL];

const TODAS_SEDES = [
  "Cartago",
  "Guapiles",
  "La Cruz",
  "Transportadora",
  "Granel",
  "granel_cartago",
  "granel_alajuela",
  "granel_la_cruz",
  "granel_guapiles",
  "granel_perez_zeledon",
  "Alajuela",
  "Tecnicos",
  "Taller",
  "San Carlos",
  "Rio Claro",
  "Perez Zeledon",
  "Nicoya"
];

const ETIQUETAS_SEDES = {
  granel_cartago: "Granel Cartago",
  granel_alajuela: "Granel Alajuela",
  granel_la_cruz: "Granel La Cruz",
  granel_guapiles: "Granel Guapiles",
  granel_perez_zeledon: "Granel Perez Zeledon"
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

function esSedeTransporte(sede) {
  const sedeNormalizada = normalizarSede(sede);
  return sedeNormalizada === "TRANSPORTADORA" || esSedeGranel(sedeNormalizada);
}

function unirSedes(...listas) {
  const sedes = listas
    .flat()
    .map(limpiarSede)
    .filter(Boolean);
  return [...new Set(sedes)];
}

function esUsuarioMecanico(user) {
  return user?.rol === "MECANICO" ||
    limpiarSede(user?.usuario).toLowerCase() === "mecanico";
}

function esUsuarioProveeduria(user) {
  return ["PROVEEDURIA", "PROVEEDURIA_TALLER"].includes(user?.rol) ||
    ["proveeduria", "proveeduria_taller"].includes(limpiarSede(user?.usuario).toLowerCase());
}

function agregarTallerParaMecanico(user, sedes) {
  const lista = Array.isArray(sedes) ? sedes : [];
  return esUsuarioMecanico(user) ? unirSedes(lista, ["Taller"]) : unirSedes(lista);
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
  return unirSedes(TODAS_SEDES, await obtenerSedesRegistradas(pool));
}

async function obtenerSedesTransporte(pool) {
  const registradas = await obtenerSedesRegistradas(pool);
  return unirSedes(SEDES_TRANSPORTE, registradas.filter(esSedeTransporte));
}

function getSedesPermitidas(req) {
  const user = req.session.user;
  let sedes = [];

  if (user.rol === "ADMIN" || esUsuarioProveeduria(user)) {

    if (
      req.session.sedeSeleccionada &&
      req.session.sedeSeleccionada !== "TODAS"
    ) {

      sedes = [req.session.sedeSeleccionada];

    } else {

      sedes = TODAS_SEDES;

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

  return sedes;
}

module.exports = {
  TODAS_SEDES,
  SEDES_GRANEL,
  SEDES_TRANSPORTE,
  etiquetaSede,
  esSedeGranel,
  esSedeTransporte,
  esUsuarioMecanico,
  esUsuarioProveeduria,
  agregarTallerParaMecanico,
  obtenerTodasSedes,
  obtenerSedesTransporte,
  getSedesPermitidas
};
