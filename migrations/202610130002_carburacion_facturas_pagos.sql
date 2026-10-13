CREATE TABLE IF NOT EXISTS carburacion_facturas (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  orden_id INT NOT NULL,
  proveedor_id INT NOT NULL,
  numero VARCHAR(100) NOT NULL,
  fecha DATE NOT NULL,
  vencimiento DATE NOT NULL,
  moneda VARCHAR(10) NOT NULL,
  total DECIMAL(16,2) NOT NULL,
  pagado DECIMAL(16,2) NOT NULL DEFAULT 0,
  cliente VARCHAR(100),
  observacion TEXT,
  archivo_nombre VARCHAR(200),
  archivo_tipo VARCHAR(60),
  archivo MEDIUMBLOB,
  creado_por INT NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_carburacion_factura_orden (orden_id),
  UNIQUE KEY uq_carburacion_factura_numero (proveedor_id, numero),
  FOREIGN KEY (orden_id) REFERENCES carburacion_ordenes(id),
  FOREIGN KEY (proveedor_id) REFERENCES carburacion_proveedores(id)
);

CREATE TABLE IF NOT EXISTS carburacion_pagos (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  token CHAR(36) NOT NULL,
  recibo_numero VARCHAR(40),
  proveedor_id INT NOT NULL,
  fecha DATE NOT NULL,
  moneda VARCHAR(10) NOT NULL,
  total DECIMAL(16,2) NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  comprobante_numero VARCHAR(120),
  comprobante_nombre VARCHAR(200),
  comprobante_tipo VARCHAR(60),
  comprobante MEDIUMBLOB,
  observacion TEXT,
  facturas_json JSON NOT NULL,
  creado_por INT NOT NULL,
  generado_por VARCHAR(160) NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_carburacion_pago_token (token),
  UNIQUE KEY uq_carburacion_pago_recibo (recibo_numero),
  FOREIGN KEY (proveedor_id) REFERENCES carburacion_proveedores(id)
);

CREATE TABLE IF NOT EXISTS carburacion_pagos_detalle (
  pago_id INT NOT NULL,
  factura_id INT NOT NULL,
  monto DECIMAL(16,2) NOT NULL,
  PRIMARY KEY (pago_id, factura_id),
  FOREIGN KEY (pago_id) REFERENCES carburacion_pagos(id),
  FOREIGN KEY (factura_id) REFERENCES carburacion_facturas(id)
);

CREATE TABLE IF NOT EXISTS carburacion_correo_config (
  id TINYINT NOT NULL PRIMARY KEY,
  copia_1 VARCHAR(200),
  copia_2 VARCHAR(200),
  copia_3 VARCHAR(200),
  correo_respuesta VARCHAR(200),
  actualizado_por INT,
  actualizado_en TIMESTAMP NULL
);
INSERT IGNORE INTO carburacion_correo_config (id) VALUES (1);

CREATE TABLE IF NOT EXISTS carburacion_pago_envios (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pago_id INT NOT NULL,
  estado VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE',
  correo_destino VARCHAR(200),
  copias_json JSON,
  correo_respuesta VARCHAR(200),
  intentos INT NOT NULL DEFAULT 0,
  error VARCHAR(500),
  bloqueo_token CHAR(36),
  iniciado_en TIMESTAMP NULL,
  enviado_en TIMESTAMP NULL,
  solicitado_por INT,
  UNIQUE KEY uq_carburacion_envio_pago (pago_id),
  FOREIGN KEY (pago_id) REFERENCES carburacion_pagos(id)
);
