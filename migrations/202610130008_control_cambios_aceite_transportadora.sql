CREATE TABLE IF NOT EXISTS control_cambios_aceite_programaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unidad_id INT NOT NULL,
  kilometros_mes DECIMAL(10,2) NOT NULL,
  intervalo_km INT NOT NULL,
  fecha_ultimo_cambio DATE NOT NULL,
  fecha_proximo_cambio DATE NOT NULL,
  observaciones VARCHAR(500) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_por INT NULL,
  actualizado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_control_cambios_aceite_unidad (unidad_id),
  INDEX idx_control_cambios_aceite_proximo (fecha_proximo_cambio, activo),
  INDEX idx_control_cambios_aceite_actualizado (actualizado_en)
);
