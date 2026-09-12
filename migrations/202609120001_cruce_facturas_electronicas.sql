CREATE TABLE IF NOT EXISTS facturas_electronicas_cruce (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  fecha_emision DATETIME NULL,
  clave VARCHAR(80) NOT NULL,
  consecutivo VARCHAR(40) NULL,
  cedula_emisor VARCHAR(30) NULL,
  nombre_emisor VARCHAR(180) NULL,
  codigo_documento_fe VARCHAR(60) NULL,
  numero_factura VARCHAR(100) NULL,
  estado_hacienda VARCHAR(40) NOT NULL DEFAULT 'ACEPTADA',
  monto_total DECIMAL(14,4) NOT NULL DEFAULT 0,
  moneda VARCHAR(10) NULL,
  detalle_resumen TEXT NULL,
  fuente_archivo VARCHAR(255) NULL,
  orden_compra_id INT NULL,
  factura_id INT NULL,
  creado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_facturas_electronicas_clave (clave),
  INDEX idx_facturas_electronicas_consecutivo (consecutivo),
  INDEX idx_facturas_electronicas_numero (numero_factura),
  INDEX idx_facturas_electronicas_estado (estado_hacienda),
  INDEX idx_facturas_electronicas_orden (orden_compra_id),
  INDEX idx_facturas_electronicas_factura (factura_id)
);

ALTER TABLE ordenes_compra ADD COLUMN factura_clave_electronica VARCHAR(80) NULL;
ALTER TABLE ordenes_compra ADD COLUMN factura_consecutivo_electronico VARCHAR(40) NULL;
ALTER TABLE ordenes_compra ADD COLUMN factura_estado_hacienda VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE';
ALTER TABLE ordenes_compra ADD COLUMN factura_fecha_aceptacion DATETIME NULL;
ALTER TABLE ordenes_compra ADD INDEX idx_ordenes_factura_clave_electronica (factura_clave_electronica);
ALTER TABLE ordenes_compra ADD INDEX idx_ordenes_factura_consecutivo_electronico (factura_consecutivo_electronico);
ALTER TABLE ordenes_compra ADD INDEX idx_ordenes_factura_estado_hacienda (factura_estado_hacienda);

ALTER TABLE facturas ADD COLUMN clave_electronica VARCHAR(80) NULL;
ALTER TABLE facturas ADD COLUMN consecutivo_electronico VARCHAR(40) NULL;
ALTER TABLE facturas ADD COLUMN estado_hacienda VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE';
ALTER TABLE facturas ADD COLUMN fecha_aceptacion DATETIME NULL;
ALTER TABLE facturas ADD INDEX idx_facturas_clave_electronica (clave_electronica);
ALTER TABLE facturas ADD INDEX idx_facturas_consecutivo_electronico (consecutivo_electronico);
ALTER TABLE facturas ADD INDEX idx_facturas_estado_hacienda (estado_hacienda);
