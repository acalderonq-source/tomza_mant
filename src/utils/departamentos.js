const DEPARTAMENTOS = [
  { key: "TALLER", nombre: "Taller", icono: "bi-tools", descripcion: "Mantenimientos, repuestos y bodega del taller." },
  { key: "OPERACIONES", nombre: "Operaciones", icono: "bi-truck", descripcion: "Área en preparación; sus procesos se habilitarán en una versión posterior." },
  { key: "CONTABILIDAD", nombre: "Contabilidad", icono: "bi-journal-check", descripcion: "Área en preparación; sus procesos se habilitarán en una versión posterior." },
  { key: "SEGURIDAD_OCUPACIONAL", nombre: "Seguridad Ocupacional", icono: "bi-shield-check", descripcion: "Área lista para incorporar sus procesos." },
  { key: "LOGISTICA", nombre: "Logística", icono: "bi-diagram-3", descripcion: "Área lista para incorporar sus procesos." },
  { key: "PROVEEDURIA", nombre: "Proveeduría", icono: "bi-box-seam", descripcion: "Área en preparación; sus procesos se habilitarán en una versión posterior." },
  { key: "RECURSOS_HUMANOS", nombre: "Recursos Humanos", icono: "bi-people", descripcion: "Área lista para incorporar sus procesos." }
];

const DEPARTAMENTO_POR_CLAVE = new Map(DEPARTAMENTOS.map(departamento => [departamento.key, departamento]));
const RUTAS_TALLER = [
  "/dashboard/resumen-ejecutivo",
  "/agenda",
  "/mantenimientos",
  "/unidades",
  "/kpis",
  "/aceite",
  "/aires",
  "/dekra",
  "/minae",
  "/aresep",
  "/compras",
  "/llantas",
  "/ia",
  "/reportes-supervisores",
  "/revision-ruta",
  "/giras",
  "/taller",
  "/logistica-taller",
  "/oficina-dia-dia",
  "/ordenes-motor",
  "/repuestos",
  "/repuestos-semanales",
  "/bodega",
  "/lavado-unidades",
  "/api/unidades"
];

const RUTAS_COMPARTIDAS_POR_DEPARTAMENTO = {
  CONTABILIDAD: ["/compras/facturas", "/compras/ordenes", "/aresep"],
  PROVEEDURIA: [
    "/compras/facturas",
    "/compras/ordenes",
    "/compras/proveedores",
    "/compras/dashboard",
    "/compras/cotizacion",
    "/bodega",
    "/repuestos-semanales",
    "/repuestos",
    "/aceite"
  ]
};

function coincideRuta(pathname, prefijos) {
  return prefijos.some(ruta => pathname === ruta || pathname.startsWith(`${ruta}/`));
}

function rutaPerteneceATaller(pathname) {
  return coincideRuta(pathname, RUTAS_TALLER);
}

function puedeAbrirRutaPorDepartamento(departamento, pathname) {
  if (!rutaPerteneceATaller(pathname)) return true;

  const area = String(departamento || "TALLER").toUpperCase();
  if (area === "TALLER") return true;
  return coincideRuta(pathname, RUTAS_COMPARTIDAS_POR_DEPARTAMENTO[area] || []);
}

function controlarAccesoPorDepartamento(req, res, next) {
  const user = req.session?.user;
  if (!user || puedeAbrirRutaPorDepartamento(user.departamentoActivo, req.path)) return next();

  const mensaje = "Este modulo pertenece a Taller. Cambie el area activa a Taller para continuar.";
  if (req.xhr || req.headers.accept?.includes("application/json")) {
    return res.status(403).json({ error: mensaje });
  }
  return res.status(403).send(mensaje);
}

function departamentosInicialesPorRol(rol, usuario = "") {
  if (/^mecanicos?/i.test(String(usuario || "").trim())) return ["TALLER"];
  const asignaciones = {
    ADMIN: DEPARTAMENTOS.map(({ key }) => key),
    TALLER: ["TALLER", "OPERACIONES", "PROVEEDURIA"],
    MECANICO: ["TALLER"],
    SUPERVISOR: ["OPERACIONES", "TALLER"],
    SUPERVISOR_PESADO: ["OPERACIONES"],
    CONTABILIDAD: ["CONTABILIDAD"],
    PROVEEDURIA: ["PROVEEDURIA"],
    PROVEEDURIA_TALLER: ["PROVEEDURIA", "TALLER"],
    BODEGA: ["PROVEEDURIA", "TALLER"],
    BODEGUERO: ["PROVEEDURIA", "TALLER"],
    TRAMITES: ["OPERACIONES", "LOGISTICA"],
    MENSAJERO: ["LOGISTICA"],
    MENSAJERIA: ["LOGISTICA"],
    MENSAJERO_FACTURAS: ["LOGISTICA"]
  };
  return asignaciones[String(rol || "").toUpperCase()] || [];
}

function departamentosPermitidosPorRol(rol, asignados = []) {
  if (String(rol || "").toUpperCase() === "ADMIN") {
    return DEPARTAMENTOS.map(({ key }) => key);
  }
  return asignados;
}

function esDepartamentoValido(departamento) {
  return DEPARTAMENTO_POR_CLAVE.has(String(departamento || "").toUpperCase());
}

async function ensurePortalDepartmentSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuario_departamentos (
      usuario_id INT NOT NULL,
      departamento VARCHAR(40) NOT NULL,
      es_principal TINYINT(1) NOT NULL DEFAULT 0,
      asignado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (usuario_id, departamento),
      INDEX idx_usuario_departamentos_departamento (departamento)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_departamento_config (
      id TINYINT NOT NULL PRIMARY KEY,
      asignacion_inicial_completa TINYINT(1) NOT NULL DEFAULT 0
    )
  `);
  await pool.query("INSERT IGNORE INTO portal_departamento_config (id, asignacion_inicial_completa) VALUES (1, 0)");
  const [config] = await pool.query("SELECT asignacion_inicial_completa FROM portal_departamento_config WHERE id = 1 LIMIT 1");

  if (!Number(config[0]?.asignacion_inicial_completa)) {
    await pool.query("DELETE FROM usuario_departamentos WHERE departamento <> 'TALLER'");
    await pool.query(`
      INSERT IGNORE INTO usuario_departamentos (usuario_id, departamento, es_principal)
      SELECT id, 'TALLER', 1 FROM usuarios
    `);
    await pool.query("UPDATE usuario_departamentos SET es_principal = 1 WHERE departamento = 'TALLER'");
    await pool.query("UPDATE portal_departamento_config SET asignacion_inicial_completa = 1 WHERE id = 1");
  }

  const [users] = await pool.query(`
    SELECT u.id, u.rol, u.usuario
    FROM usuarios u
    LEFT JOIN usuario_departamentos ud ON ud.usuario_id = u.id
    WHERE ud.usuario_id IS NULL
  `);
  for (const user of users) {
    const departamentos = departamentosInicialesPorRol(user.rol, user.usuario);
    for (const [index, departamento] of departamentos.entries()) {
      await pool.query(
        "INSERT IGNORE INTO usuario_departamentos (usuario_id, departamento, es_principal) VALUES (?, ?, ?)",
        [user.id, departamento, index === 0 ? 1 : 0]
      );
    }
  }
}

module.exports = {
  DEPARTAMENTOS,
  departamentosInicialesPorRol,
  departamentosPermitidosPorRol,
  esDepartamentoValido,
  rutaPerteneceATaller,
  puedeAbrirRutaPorDepartamento,
  controlarAccesoPorDepartamento,
  ensurePortalDepartmentSchema
};
