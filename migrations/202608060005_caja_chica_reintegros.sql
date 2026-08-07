CREATE TABLE IF NOT EXISTS caja_chica_reintegros (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fecha DATE NOT NULL,
  monto DECIMAL(14,2) NOT NULL DEFAULT 0,
  observacion TEXT NULL,
  creado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_caja_chica_fecha (fecha)
);
