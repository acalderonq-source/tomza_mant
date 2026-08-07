SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'reportes_supervisores'
    AND COLUMN_NAME = 'semana_reporte'
);

SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE reportes_supervisores ADD COLUMN semana_reporte DATE NULL AFTER fecha_reporte',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE reportes_supervisores
SET semana_reporte = DATE_SUB(DATE(fecha_reporte), INTERVAL (WEEKDAY(fecha_reporte)) DAY)
WHERE semana_reporte IS NULL;

