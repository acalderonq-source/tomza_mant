const TIPOS_MANTENIMIENTO = ["CORRECTIVO", "PREVENTIVO"];

function normalizarTipoMantenimiento(value, fallback = "CORRECTIVO") {
  const tipo = String(value || "").trim().toUpperCase();
  return TIPOS_MANTENIMIENTO.includes(tipo) ? tipo : fallback;
}

async function tableExists(pool, table) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [table]
  );
  return Number(row.total || 0) > 0;
}

async function columnExists(pool, table, column) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(row.total || 0) > 0;
}

async function addColumnIfMissing(pool, table, column, definition) {
  if (!(await tableExists(pool, table))) return;
  if (!(await columnExists(pool, table, column))) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function ensureTipoMantenimientoColumns(pool) {
  await addColumnIfMissing(pool, "ordenes_compra", "tipo_mantenimiento", "VARCHAR(20) NOT NULL DEFAULT 'CORRECTIVO' AFTER placa_unidad");
  await addColumnIfMissing(pool, "ordenes_motor", "tipo_mantenimiento", "VARCHAR(20) NOT NULL DEFAULT 'CORRECTIVO' AFTER placa_unidad");
  await addColumnIfMissing(pool, "correctivos", "tipo_mantenimiento", "VARCHAR(20) NOT NULL DEFAULT 'CORRECTIVO' AFTER sede");
  await addColumnIfMissing(pool, "mantenimientos", "creado_por", "INT NULL AFTER fecha_cierre");
  await addColumnIfMissing(pool, "reportes_supervisores", "tipo_mantenimiento", "VARCHAR(20) NOT NULL DEFAULT 'CORRECTIVO' AFTER semana_reporte");
  await addColumnIfMissing(pool, "reportes_supervisores", "mantenimiento_id", "INT NULL AFTER correctivo_id");
}

module.exports = {
  TIPOS_MANTENIMIENTO,
  normalizarTipoMantenimiento,
  ensureTipoMantenimientoColumns
};
