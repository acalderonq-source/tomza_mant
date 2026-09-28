CREATE TABLE IF NOT EXISTS bodega_existencias (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  articulo_id INT NOT NULL,
  sede VARCHAR(120) NOT NULL,
  ubicacion VARCHAR(120) NOT NULL DEFAULT '',
  cantidad DECIMAL(12,2) NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_bodega_existencia (articulo_id, sede, ubicacion),
  INDEX idx_bodega_existencia_sede (sede, articulo_id),
  CONSTRAINT fk_bodega_existencia_articulo FOREIGN KEY (articulo_id) REFERENCES bodega_articulos(id)
);

ALTER TABLE bodega_prestamos_herramientas
  ADD COLUMN sede VARCHAR(120) NULL AFTER placa,
  ADD COLUMN ubicacion VARCHAR(120) NULL AFTER sede,
  ADD COLUMN cantidad_devuelta DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER cantidad;

ALTER TABLE bodega_movimientos
  MODIFY tipo_movimiento ENUM('ENTRADA','SALIDA','DEVOLUCION','AJUSTE','PRESTAMO','DEVOLUCION_HERRAMIENTA','APERTURA','TRASLADO') NOT NULL,
  ADD COLUMN sede VARCHAR(120) NULL AFTER origen_inventario,
  ADD COLUMN ubicacion VARCHAR(120) NULL AFTER sede,
  ADD COLUMN movimiento_origen_id INT NULL AFTER prestamo_id,
  ADD COLUMN sede_destino VARCHAR(120) NULL AFTER ubicacion,
  ADD COLUMN ubicacion_destino VARCHAR(120) NULL AFTER sede_destino,
  ADD COLUMN codigo_taller_snapshot VARCHAR(4) NULL AFTER orden_compra_id,
  ADD COLUMN codigo_proveedor_snapshot VARCHAR(80) NULL AFTER codigo_taller_snapshot,
  ADD COLUMN descripcion_snapshot VARCHAR(180) NULL AFTER codigo_proveedor_snapshot,
  ADD COLUMN proveedor_snapshot VARCHAR(180) NULL AFTER descripcion_snapshot,
  ADD INDEX idx_bodega_mov_sede_fecha (sede, creado_en),
  ADD INDEX idx_bodega_mov_origen (movimiento_origen_id),
  ADD CONSTRAINT fk_bodega_mov_origen FOREIGN KEY (movimiento_origen_id) REFERENCES bodega_movimientos(id);

UPDATE bodega_movimientos
SET sede = 'POR_CLASIFICAR', ubicacion = ''
WHERE sede IS NULL;

UPDATE bodega_prestamos_herramientas
SET sede = 'POR_CLASIFICAR', ubicacion = ''
WHERE sede IS NULL;

INSERT INTO bodega_existencias (articulo_id, sede, ubicacion, cantidad)
SELECT id, 'POR_CLASIFICAR', COALESCE(ubicacion, ''), stock_actual
FROM bodega_articulos
WHERE stock_actual > 0
ON DUPLICATE KEY UPDATE cantidad = VALUES(cantidad);

UPDATE bodega_movimientos bm
JOIN bodega_articulos ba ON ba.id = bm.articulo_id
SET bm.codigo_taller_snapshot = ba.codigo_taller,
    bm.codigo_proveedor_snapshot = ba.codigo,
    bm.descripcion_snapshot = ba.nombre,
    bm.proveedor_snapshot = COALESCE(NULLIF(ba.proveedor_consignacion, ''), ba.proveedor_nombre);

INSERT INTO bodega_movimientos (
  articulo_id, tipo_movimiento, origen_inventario, sede, ubicacion,
  cantidad, existencia_anterior, existencia_nueva, precio_unitario,
  descripcion_snapshot, codigo_taller_snapshot, codigo_proveedor_snapshot,
  proveedor_snapshot, motivo
)
SELECT ba.id, 'APERTURA', ba.origen_inventario, 'POR_CLASIFICAR', COALESCE(ba.ubicacion, ''),
       ba.stock_actual, 0, ba.stock_actual, ba.precio_unitario,
       ba.nombre, ba.codigo_taller, ba.codigo,
       COALESCE(NULLIF(ba.proveedor_consignacion, ''), ba.proveedor_nombre),
       'Saldo inicial migrado a ubicacion POR_CLASIFICAR; pendiente de conteo y asignacion por sede.'
FROM bodega_articulos ba
WHERE ba.stock_actual > 0
  AND NOT EXISTS (
    SELECT 1 FROM bodega_movimientos bm
    WHERE bm.articulo_id = ba.id AND bm.tipo_movimiento = 'APERTURA'
  );
