CREATE TABLE IF NOT EXISTS carburacion_cliente_incidencias (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  titulo VARCHAR(150) NOT NULL,
  descripcion TEXT NOT NULL,
  fecha DATE NOT NULL,
  estado VARCHAR(25) NOT NULL DEFAULT 'ABIERTA',
  version INT NOT NULL DEFAULT 1,
  creado_por INT NOT NULL,
  creado_nombre VARCHAR(160) NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_por INT NULL,
  actualizado_en TIMESTAMP NULL,
  KEY idx_carb_incidencias_cliente (cliente_id,fecha,id),
  FOREIGN KEY (cliente_id) REFERENCES carburacion_clientes(id)
);
CREATE TABLE IF NOT EXISTS carburacion_cliente_documentos (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  tipo VARCHAR(30) NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  mime VARCHAR(60) NOT NULL,
  archivo MEDIUMBLOB NOT NULL,
  tamanio INT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  representante_legal VARCHAR(200) NULL,
  creado_por INT NOT NULL,
  creado_nombre VARCHAR(160) NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_carb_documentos_cliente (cliente_id,tipo,id),
  FOREIGN KEY (cliente_id) REFERENCES carburacion_clientes(id)
);
