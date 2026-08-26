CREATE TABLE IF NOT EXISTS lavado_unidades (
  id INT AUTO_INCREMENT PRIMARY KEY,
  numero_lavado VARCHAR(30) NOT NULL UNIQUE,
  unidad_id INT NOT NULL,
  placa VARCHAR(80) NOT NULL,
  sede VARCHAR(100) NOT NULL,
  fecha DATE NOT NULL,
  observaciones TEXT NULL,
  creado_por INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_lavado_fecha (fecha),
  INDEX idx_lavado_sede_fecha (sede, fecha),
  INDEX idx_lavado_unidad_fecha (unidad_id, fecha),
  CONSTRAINT fk_lavado_unidad
    FOREIGN KEY (unidad_id) REFERENCES unidades(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lavado_unidades_fotos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lavado_id INT NOT NULL,
  angulo_clave VARCHAR(80) NOT NULL,
  angulo_nombre VARCHAR(120) NOT NULL,
  foto_nombre VARCHAR(255) NULL,
  foto_tipo VARCHAR(100) NULL,
  foto_base64 LONGTEXT NOT NULL,
  foto_hash CHAR(64) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_lavado_foto_hash (foto_hash),
  INDEX idx_lavado_fotos_lavado (lavado_id),
  CONSTRAINT fk_lavado_fotos_lavado
    FOREIGN KEY (lavado_id) REFERENCES lavado_unidades(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
