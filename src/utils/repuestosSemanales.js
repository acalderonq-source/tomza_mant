const ESTADOS_REPUESTOS_SEMANALES = ["PENDIENTE", "LLEGANDO", "NO_COMPRA", "COMPLETO"];

function normalizarEstadoSemanal(value) {
  const estado = String(value || "").trim().toUpperCase();
  return ESTADOS_REPUESTOS_SEMANALES.includes(estado) ? estado : "PENDIENTE";
}

function etiquetaEstadoSemanal(value) {
  const estado = normalizarEstadoSemanal(value);
  return {
    PENDIENTE: "Pendiente",
    LLEGANDO: "Va llegando",
    NO_COMPRA: "No se compra",
    COMPLETO: "Completo"
  }[estado];
}

async function columnExists(pool, table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows?.[0]?.total || 0) > 0;
}

async function enumHasValue(pool, table, column, value) {
  const [rows] = await pool.query(
    `SELECT COLUMN_TYPE AS column_type
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
  );
  return String(rows?.[0]?.column_type || "").includes(`'${value}'`);
}

async function ensureRepuestosSemanalesTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS repuestos_semanales (
      id INT AUTO_INCREMENT PRIMARY KEY,
      fecha DATE NOT NULL,
      sede VARCHAR(100) NOT NULL,
      placa VARCHAR(80) NOT NULL,
      solicitud TEXT NOT NULL,
      marcado_rojo TEXT NULL,
      no_compra TEXT NULL,
      estado ENUM('PENDIENTE','LLEGANDO','NO_COMPRA','COMPLETO') NOT NULL DEFAULT 'PENDIENTE',
      creado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_repuestos_semanales_fecha (fecha),
      INDEX idx_repuestos_semanales_sede (sede),
      INDEX idx_repuestos_semanales_estado (estado),
      INDEX idx_repuestos_semanales_placa (placa)
    )
  `);

  if (!(await columnExists(pool, "repuestos_semanales", "no_compra"))) {
    await pool.query("ALTER TABLE repuestos_semanales ADD COLUMN no_compra TEXT NULL AFTER marcado_rojo");
  }

  if (!(await enumHasValue(pool, "repuestos_semanales", "estado", "NO_COMPRA"))) {
    await pool.query(`
      ALTER TABLE repuestos_semanales
      MODIFY estado ENUM('PENDIENTE','LLEGANDO','NO_COMPRA','COMPLETO') NOT NULL DEFAULT 'PENDIENTE'
    `);
  }
}

module.exports = {
  ESTADOS_REPUESTOS_SEMANALES,
  ensureRepuestosSemanalesTable,
  etiquetaEstadoSemanal,
  normalizarEstadoSemanal
};
