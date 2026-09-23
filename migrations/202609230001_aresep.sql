CREATE TABLE IF NOT EXISTS aresep_registros (
  id INT AUTO_INCREMENT PRIMARY KEY,
  periodo CHAR(7) NOT NULL,
  seccion VARCHAR(20) NOT NULL,
  clave CHAR(64) NOT NULL,
  unidad_id INT NULL,
  datos JSON NOT NULL,
  version INT NOT NULL DEFAULT 1,
  creado_por INT NOT NULL,
  actualizado_por INT NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_aresep_periodo_seccion_clave (periodo, seccion, clave),
  INDEX idx_aresep_unidad (unidad_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS aresep_historial (
  id INT AUTO_INCREMENT PRIMARY KEY,
  registro_id INT NOT NULL,
  version INT NOT NULL,
  datos JSON NOT NULL,
  usuario_id INT NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_aresep_historial_version (registro_id, version),
  CONSTRAINT fk_aresep_historial_registro FOREIGN KEY (registro_id) REFERENCES aresep_registros(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
