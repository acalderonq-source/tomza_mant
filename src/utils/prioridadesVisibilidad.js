async function ensurePrioridadesVisibilidad(pool) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'taller_prioridades'
       AND COLUMN_NAME = 'mostrar_operativos'`
  );
  if (Number(rows[0]?.total || 0) > 0) return;
  try {
    await pool.query(
      "ALTER TABLE taller_prioridades ADD COLUMN mostrar_operativos TINYINT(1) NOT NULL DEFAULT 1 AFTER estado"
    );
  } catch (error) {
    if (!["ER_DUP_FIELDNAME", "ER_NO_SUCH_TABLE"].includes(error.code)) throw error;
  }
}

module.exports = { ensurePrioridadesVisibilidad };
