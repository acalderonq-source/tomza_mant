CREATE TABLE IF NOT EXISTS taller_marcas_accesos (
  usuario_id INT NOT NULL PRIMARY KEY,
  puede_marcar TINYINT NOT NULL DEFAULT 0,
  puede_consultar TINYINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS taller_marcas (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  tipo ENUM('ENTRADA','SALIDA') NOT NULL,
  creado_en DATETIME(3) NOT NULL,
  foto MEDIUMBLOB NOT NULL,
  tamanio INT NOT NULL,
  foto_sha256 CHAR(64) NOT NULL,
  reto_sha256 CHAR(64) NOT NULL UNIQUE,
  UNIQUE KEY idx_taller_marcas_foto (usuario_id, foto_sha256),
  INDEX idx_taller_marcas_usuario (usuario_id, id),
  INDEX idx_taller_marcas_fecha (creado_en, id)
);
INSERT INTO taller_marcas_accesos (usuario_id,puede_marcar,puede_consultar)
SELECT id,1,0 FROM usuarios WHERE usuario='mecanico_limon' AND rol='MECANICO'
ON DUPLICATE KEY UPDATE puede_marcar=1;
INSERT INTO taller_marcas_accesos (usuario_id,puede_marcar,puede_consultar)
SELECT id,0,1 FROM usuarios WHERE usuario='taller' AND rol='TALLER'
ON DUPLICATE KEY UPDATE puede_consultar=1;
