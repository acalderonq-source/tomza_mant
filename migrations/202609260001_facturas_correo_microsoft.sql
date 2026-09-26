CREATE TABLE IF NOT EXISTS facturas_correo_conexion (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  correo VARCHAR(255) NOT NULL,
  cuenta_id VARCHAR(255) NOT NULL,
  token_cache MEDIUMTEXT NOT NULL,
  conectado_por INT NULL,
  conectado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sincronizado_en DATETIME NULL,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS facturas_correo_mensajes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  graph_id_hash CHAR(64) NOT NULL,
  graph_id TEXT NOT NULL,
  internet_message_id VARCHAR(998) NULL,
  recibido_en DATETIME NULL,
  remitente VARCHAR(255) NULL,
  asunto TEXT NULL,
  vista_previa TEXT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_facturas_correo_graph_hash (graph_id_hash),
  KEY idx_facturas_correo_recibido (recibido_en)
);

CREATE TABLE IF NOT EXISTS facturas_correo_adjuntos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  mensaje_id BIGINT UNSIGNED NOT NULL,
  graph_adjunto_hash CHAR(64) NOT NULL,
  nombre_archivo VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NULL,
  ruta_archivo VARCHAR(255) NOT NULL,
  tipo_documento ENUM('XML', 'PDF') NOT NULL,
  clave_electronica VARCHAR(80) NULL,
  consecutivo VARCHAR(40) NULL,
  emisor VARCHAR(180) NULL,
  fecha_emision DATETIME NULL,
  monto DECIMAL(14,4) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_facturas_correo_adjunto_hash (graph_adjunto_hash),
  KEY idx_facturas_correo_adjunto_mensaje (mensaje_id),
  CONSTRAINT fk_facturas_correo_adjunto_mensaje
    FOREIGN KEY (mensaje_id) REFERENCES facturas_correo_mensajes(id) ON DELETE CASCADE
);
