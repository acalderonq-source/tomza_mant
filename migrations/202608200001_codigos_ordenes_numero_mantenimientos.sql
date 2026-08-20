SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE ordenes_compra_detalle ADD COLUMN codigo_producto VARCHAR(80) NULL AFTER codigo',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ordenes_compra_detalle'
    AND COLUMN_NAME = 'codigo_producto'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE mantenimientos ADD COLUMN numero_mantenimiento VARCHAR(30) NULL AFTER id',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'mantenimientos'
    AND COLUMN_NAME = 'numero_mantenimiento'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE mantenimientos
SET numero_mantenimiento = CONCAT('MANT-', YEAR(COALESCE(fecha_programada, CURDATE())), '-', LPAD(id, 6, '0'))
WHERE numero_mantenimiento IS NULL
   OR TRIM(numero_mantenimiento) = '';

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE mantenimientos ADD INDEX idx_mantenimientos_numero (numero_mantenimiento)',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'mantenimientos'
    AND INDEX_NAME = 'idx_mantenimientos_numero'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
