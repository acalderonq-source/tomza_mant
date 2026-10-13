CREATE TABLE IF NOT EXISTS carburacion_estaciones_registros (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  categoria VARCHAR(30) NOT NULL,
  estacion VARCHAR(250) NOT NULL,
  cliente_id INT NULL,
  ejecutivo VARCHAR(120),
  prioridad VARCHAR(20) NOT NULL DEFAULT 'SIN_DEFINIR',
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  detalle TEXT,
  proveedor_texto VARCHAR(500),
  campos_json JSON NOT NULL,
  origen_json JSON,
  archivo_origen VARCHAR(200),
  origen_sha CHAR(64),
  hoja_origen VARCHAR(100),
  fila_origen INT,
  version INT NOT NULL DEFAULT 1,
  creado_por INT NOT NULL,
  actualizado_por INT NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_carburacion_estaciones_origen (origen_sha,hoja_origen,fila_origen),
  KEY idx_carburacion_estaciones_categoria (categoria,estado,prioridad),
  FOREIGN KEY (cliente_id) REFERENCES carburacion_clientes(id)
);

CREATE TABLE IF NOT EXISTS carburacion_estaciones_proveedores (
  registro_id INT NOT NULL,
  proveedor_id INT NOT NULL,
  PRIMARY KEY (registro_id,proveedor_id),
  FOREIGN KEY (registro_id) REFERENCES carburacion_estaciones_registros(id),
  FOREIGN KEY (proveedor_id) REFERENCES carburacion_proveedores(id)
);

CREATE TABLE IF NOT EXISTS carburacion_estaciones_historial (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  registro_id INT NOT NULL,
  accion VARCHAR(30) NOT NULL,
  antes_json JSON,
  despues_json JSON NOT NULL,
  observacion VARCHAR(1000),
  usuario_id INT NOT NULL,
  usuario_nombre VARCHAR(160) NOT NULL DEFAULT 'Sistema',
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_carburacion_estaciones_historial (registro_id,id),
  FOREIGN KEY (registro_id) REFERENCES carburacion_estaciones_registros(id)
);
