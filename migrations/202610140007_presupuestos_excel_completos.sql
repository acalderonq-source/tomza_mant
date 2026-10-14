CREATE TABLE IF NOT EXISTS cont_presupuesto_archivos (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  periodo CHAR(7) NOT NULL,
  empresa VARCHAR(120) NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  contenido MEDIUMBLOB NOT NULL,
  datos JSON NOT NULL,
  total_crc DECIMAL(16,2) NOT NULL,
  actor INT NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cont_archivo (periodo,empresa,sha256),
  INDEX idx_cont_archivo_periodo (periodo,empresa)
);
