CREATE TABLE IF NOT EXISTS unidades_sede_historial (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unidad_id INT NOT NULL,
  placa VARCHAR(80) NOT NULL,
  sede_anterior VARCHAR(100) NULL,
  sede_nueva VARCHAR(100) NOT NULL,
  usuario_id INT NULL,
  usuario_nombre VARCHAR(120) NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_unidad_fecha (unidad_id, creado_en),
  INDEX idx_placa_fecha (placa, creado_en),
  INDEX idx_sede_nueva (sede_nueva),
  CONSTRAINT fk_unidades_sede_historial_unidad
    FOREIGN KEY (unidad_id) REFERENCES unidades(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
