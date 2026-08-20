async function columnExists(pool, table, column) {
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

async function indexExists(pool, table, indexName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return Number(rows[0]?.total || 0) > 0;
}

async function ensureNumeroMantenimientoColumn(pool) {
  if (!(await columnExists(pool, "mantenimientos", "numero_mantenimiento"))) {
    await pool.query("ALTER TABLE mantenimientos ADD COLUMN numero_mantenimiento VARCHAR(30) NULL AFTER id");
  }

  await pool.query(`
    UPDATE mantenimientos
    SET numero_mantenimiento = CONCAT('MANT-', YEAR(COALESCE(fecha_programada, CURDATE())), '-', LPAD(id, 6, '0'))
    WHERE numero_mantenimiento IS NULL
       OR TRIM(numero_mantenimiento) = ''
  `);

  if (!(await indexExists(pool, "mantenimientos", "idx_mantenimientos_numero"))) {
    await pool.query("ALTER TABLE mantenimientos ADD INDEX idx_mantenimientos_numero (numero_mantenimiento)");
  }
}

async function asignarNumeroMantenimiento(pool, mantenimientoId) {
  if (!mantenimientoId) return;
  await ensureNumeroMantenimientoColumn(pool);
  await pool.query(
    `UPDATE mantenimientos
     SET numero_mantenimiento = CONCAT('MANT-', YEAR(COALESCE(fecha_programada, CURDATE())), '-', LPAD(id, 6, '0'))
     WHERE id = ?
       AND (numero_mantenimiento IS NULL OR TRIM(numero_mantenimiento) = '')`,
    [mantenimientoId]
  );
}

module.exports = {
  ensureNumeroMantenimientoColumn,
  asignarNumeroMantenimiento
};
