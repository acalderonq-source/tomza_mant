-- Tipo de mantenimiento para reportes, ordenes y correctivos.
-- Permite separar costos de CORRECTIVO y PREVENTIVO en el resumen ejecutivo.

SET @db := DATABASE();

SET @exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ordenes_compra' AND COLUMN_NAME = 'tipo_mantenimiento'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE ordenes_compra ADD COLUMN tipo_mantenimiento VARCHAR(20) NOT NULL DEFAULT ''CORRECTIVO'' AFTER placa_unidad',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ordenes_motor' AND COLUMN_NAME = 'tipo_mantenimiento'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE ordenes_motor ADD COLUMN tipo_mantenimiento VARCHAR(20) NOT NULL DEFAULT ''CORRECTIVO'' AFTER placa_unidad',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'correctivos' AND COLUMN_NAME = 'tipo_mantenimiento'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE correctivos ADD COLUMN tipo_mantenimiento VARCHAR(20) NOT NULL DEFAULT ''CORRECTIVO'' AFTER sede',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'reportes_supervisores' AND COLUMN_NAME = 'tipo_mantenimiento'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE reportes_supervisores ADD COLUMN tipo_mantenimiento VARCHAR(20) NOT NULL DEFAULT ''CORRECTIVO'' AFTER semana_reporte',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'mantenimientos' AND COLUMN_NAME = 'creado_por'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE mantenimientos ADD COLUMN creado_por INT NULL AFTER fecha_cierre',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'reportes_supervisores' AND COLUMN_NAME = 'mantenimiento_id'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE reportes_supervisores ADD COLUMN mantenimiento_id INT NULL AFTER correctivo_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE ordenes_compra
SET tipo_mantenimiento = 'CORRECTIVO'
WHERE tipo_mantenimiento IS NULL OR TRIM(tipo_mantenimiento) = '';

UPDATE correctivos
SET tipo_mantenimiento = 'CORRECTIVO'
WHERE tipo_mantenimiento IS NULL OR TRIM(tipo_mantenimiento) = '';

UPDATE reportes_supervisores
SET tipo_mantenimiento = 'CORRECTIVO'
WHERE tipo_mantenimiento IS NULL OR TRIM(tipo_mantenimiento) = '';

UPDATE ordenes_motor
SET tipo_mantenimiento = 'CORRECTIVO'
WHERE tipo_mantenimiento IS NULL OR TRIM(tipo_mantenimiento) = '';
