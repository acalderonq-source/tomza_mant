const DEPARTAMENTOS = [
  { key: "TALLER", nombre: "Taller", icono: "bi-tools", descripcion: "Mantenimientos, repuestos y bodega del taller." },
  { key: "OPERACIONES", nombre: "Operaciones", icono: "bi-truck", descripcion: "Unidades, rutas, lavados y control operativo." },
  { key: "CONTABILIDAD", nombre: "Contabilidad", icono: "bi-journal-check", descripcion: "Facturas, asientos y controles contables." },
  { key: "SEGURIDAD_OCUPACIONAL", nombre: "Seguridad Ocupacional", icono: "bi-shield-check", descripcion: "Área lista para incorporar sus procesos." },
  { key: "LOGISTICA", nombre: "Logística", icono: "bi-diagram-3", descripcion: "Área lista para incorporar sus procesos." },
  { key: "PROVEEDURIA", nombre: "Proveeduría", icono: "bi-box-seam", descripcion: "Compras, órdenes y suministros." },
  { key: "RECURSOS_HUMANOS", nombre: "Recursos Humanos", icono: "bi-people", descripcion: "Área lista para incorporar sus procesos." }
];

const DEPARTAMENTO_POR_CLAVE = new Map(DEPARTAMENTOS.map(departamento => [departamento.key, departamento]));

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
  ensurePortalDepartmentSchema
};
