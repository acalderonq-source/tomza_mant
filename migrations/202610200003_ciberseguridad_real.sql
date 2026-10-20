CREATE TABLE IF NOT EXISTS ciberseguridad_eventos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  huella CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  tipo VARCHAR(40) NOT NULL,
  gravedad VARCHAR(12) NOT NULL,
  ip VARCHAR(45) NOT NULL,
  usuario VARCHAR(120) NOT NULL,
  departamento VARCHAR(60) NOT NULL,
  ruta VARCHAR(180) NOT NULL,
  http_estado SMALLINT NOT NULL,
  creado_en DATETIME(3) NOT NULL,
  ultimo_en DATETIME(3) NOT NULL,
  intentos INT UNSIGNED NOT NULL DEFAULT 1,
  estado VARCHAR(24) NOT NULL DEFAULT 'Pendiente',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  INDEX idx_ciber_fecha (creado_en, gravedad),
  INDEX idx_ciber_estado (estado, creado_en)
);
CREATE TABLE IF NOT EXISTS ciberseguridad_seguimiento (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  evento_id BIGINT UNSIGNED NOT NULL,
  administrador_id INT NOT NULL,
  estado VARCHAR(24) NOT NULL,
  nota VARCHAR(1000) NOT NULL,
  creado_en DATETIME(3) NOT NULL,
  INDEX idx_ciber_seguimiento (evento_id, id)
);
CREATE TABLE IF NOT EXISTS ciberseguridad_config (
  id INT NOT NULL PRIMARY KEY,
  iniciado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT IGNORE INTO ciberseguridad_config (id) VALUES (1);
