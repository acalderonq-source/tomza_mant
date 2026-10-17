-- Solo tablas aditivas; no modifica movimientos historicos.
CREATE TABLE IF NOT EXISTS empresa_operaciones (
  clave CHAR(64) PRIMARY KEY,
  huella CHAR(64) NOT NULL,
  usuario_id INT NOT NULL,
  actor VARCHAR(160) NOT NULL,
  ruta VARCHAR(180) NOT NULL,
  estado VARCHAR(24) NOT NULL DEFAULT 'EN_PROCESO',
  respuesta SMALLINT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  terminado_en TIMESTAMP NULL,
  INDEX idx_empresa_operaciones_fecha (creado_en),
  INDEX idx_empresa_operaciones_usuario (usuario_id, creado_en)
);

CREATE TABLE IF NOT EXISTS auditoria_sistema (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  modulo VARCHAR(80) NOT NULL,
  tabla_afectada VARCHAR(80) NOT NULL,
  registro_id BIGINT NULL,
  accion VARCHAR(40) NOT NULL,
  resumen VARCHAR(255) NULL,
  antes JSON NULL,
  despues JSON NULL,
  usuario_id INT NULL,
  usuario_nombre VARCHAR(120) NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_auditoria_modulo_fecha (modulo, creado_en),
  INDEX idx_auditoria_tabla_registro (tabla_afectada, registro_id),
  INDEX idx_auditoria_usuario (usuario_id)
);
