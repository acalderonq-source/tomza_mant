-- Artículos de Proveeduría con precio fijo y su proveedor asignado.
-- Se compran desde el carrito sin cotización; la OC queda marcada como precio fijo.
CREATE TABLE IF NOT EXISTS prov_precios_fijos (
  clave_articulo VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  descripcion VARCHAR(255) NOT NULL,
  proveedor_clave VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  precio_unitario DECIMAL(14,4) NOT NULL,
  iva DECIMAL(5,2) NOT NULL DEFAULT 13,
  moneda CHAR(3) NOT NULL DEFAULT 'CRC',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  actualizado_por INT NULL,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_prov_precios_fijos_proveedor (proveedor_clave, activo)
) ENGINE=InnoDB;
