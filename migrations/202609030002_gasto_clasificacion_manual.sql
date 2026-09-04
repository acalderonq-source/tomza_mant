CREATE TABLE IF NOT EXISTS gasto_clasificacion_manual (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fuente VARCHAR(30) NOT NULL,
  referencia_id INT NOT NULL,
  detalle_id INT NOT NULL DEFAULT 0,
  familia_clave VARCHAR(40) NOT NULL,
  observacion VARCHAR(255) NULL,
  creado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gasto_clasificacion_manual (fuente, referencia_id, detalle_id),
  INDEX idx_gasto_clasificacion_manual_familia (familia_clave)
);
