ALTER TABLE bodega_articulos
  ADD COLUMN origen_inventario ENUM('PROPIO','CONSIGNACION') NOT NULL DEFAULT 'PROPIO' AFTER tipo_articulo;

ALTER TABLE bodega_articulos
  ADD COLUMN proveedor_consignacion VARCHAR(180) NULL AFTER proveedor_nombre;

ALTER TABLE bodega_movimientos
  ADD COLUMN origen_inventario ENUM('PROPIO','CONSIGNACION') NOT NULL DEFAULT 'PROPIO' AFTER tipo_movimiento;

SET @bodega_codigo_unique_index := (
  SELECT s.INDEX_NAME
  FROM INFORMATION_SCHEMA.STATISTICS s
  JOIN (
    SELECT INDEX_NAME, COUNT(*) AS columnas
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'bodega_articulos'
    GROUP BY INDEX_NAME
  ) x ON x.INDEX_NAME = s.INDEX_NAME
  WHERE s.TABLE_SCHEMA = DATABASE()
    AND s.TABLE_NAME = 'bodega_articulos'
    AND s.NON_UNIQUE = 0
    AND s.INDEX_NAME <> 'PRIMARY'
    AND s.COLUMN_NAME = 'codigo'
    AND x.columnas = 1
  LIMIT 1
);

SET @bodega_drop_codigo_unique_sql := IF(
  @bodega_codigo_unique_index IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE bodega_articulos DROP INDEX `', @bodega_codigo_unique_index, '`')
);

PREPARE bodega_drop_codigo_unique_stmt FROM @bodega_drop_codigo_unique_sql;
EXECUTE bodega_drop_codigo_unique_stmt;
DEALLOCATE PREPARE bodega_drop_codigo_unique_stmt;

SET @bodega_codigo_origen_unique_index := (
  SELECT INDEX_NAME
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bodega_articulos'
    AND INDEX_NAME = 'idx_bodega_articulos_codigo_origen'
    AND NON_UNIQUE = 0
  LIMIT 1
);

SET @bodega_drop_codigo_origen_unique_sql := IF(
  @bodega_codigo_origen_unique_index IS NULL,
  'SELECT 1',
  'ALTER TABLE bodega_articulos DROP INDEX idx_bodega_articulos_codigo_origen'
);

PREPARE bodega_drop_codigo_origen_unique_stmt FROM @bodega_drop_codigo_origen_unique_sql;
EXECUTE bodega_drop_codigo_origen_unique_stmt;
DEALLOCATE PREPARE bodega_drop_codigo_origen_unique_stmt;

CREATE INDEX idx_bodega_articulos_codigo_origen
  ON bodega_articulos (codigo, origen_inventario);

CREATE INDEX idx_bodega_articulos_origen
  ON bodega_articulos (origen_inventario);

CREATE INDEX idx_bodega_movimientos_origen
  ON bodega_movimientos (origen_inventario);
