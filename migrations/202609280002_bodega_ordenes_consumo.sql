CREATE TABLE IF NOT EXISTS bodega_ordenes_consumo (
  orden_compra_id INT NOT NULL PRIMARY KEY,
  proveedor_id INT NOT NULL,
  fecha_desde DATE NOT NULL,
  fecha_hasta DATE NOT NULL,
  sede VARCHAR(120) NOT NULL DEFAULT '',
  creado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_bodega_consumo_periodo (proveedor_id, fecha_desde, fecha_hasta, sede),
  INDEX idx_bodega_consumo_proveedor (proveedor_id, creado_en)
);

CREATE TABLE IF NOT EXISTS bodega_ordenes_consumo_movimientos (
  movimiento_id INT NOT NULL PRIMARY KEY,
  orden_compra_id INT NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bodega_consumo_mov_orden (orden_compra_id, movimiento_id)
);
