CREATE TABLE IF NOT EXISTS preventivos_programaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unidad_id INT NOT NULL,
  fecha_inicio DATE NOT NULL,
  intervalo_semanas INT NOT NULL,
  plan TEXT NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  procesada_hasta DATE NOT NULL,
  version INT NOT NULL DEFAULT 1,
  creado_por INT NULL,
  actualizado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_preventivos_programaciones_unidad (unidad_id),
  INDEX idx_preventivos_programaciones_pendientes (activa, procesada_hasta)
);
