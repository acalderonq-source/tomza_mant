UPDATE mecanicos
SET nombre = 'Norman Fonseca',
    activo = 1
WHERE nombre = 'Norman Solano';

UPDATE mecanicos
SET activo = 1
WHERE nombre IN ('Norman Fonseca', 'Martin Montenegro');

INSERT INTO mecanicos (nombre, sede, activo)
SELECT 'Norman Fonseca', 'Taller', 1
WHERE NOT EXISTS (
  SELECT 1 FROM mecanicos WHERE nombre = 'Norman Fonseca'
);

INSERT INTO mecanicos (nombre, sede, activo)
SELECT 'Martin Montenegro', 'Taller', 1
WHERE NOT EXISTS (
  SELECT 1 FROM mecanicos WHERE nombre = 'Martin Montenegro'
);

INSERT INTO mecanicos (nombre, sede, activo)
SELECT 'Roberto Montenegro', 'Taller', 1
WHERE NOT EXISTS (
  SELECT 1 FROM mecanicos WHERE nombre = 'Roberto Montenegro'
);

INSERT INTO mecanicos (nombre, sede, activo)
SELECT 'Christian Maroto', 'Taller', 1
WHERE NOT EXISTS (
  SELECT 1 FROM mecanicos WHERE nombre = 'Christian Maroto'
);

CREATE TABLE IF NOT EXISTS trabajos_taller_sin_placa (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sede VARCHAR(100) NOT NULL,
  observacion TEXT NOT NULL,
  pendiente TEXT NULL,
  creado_por INT NOT NULL,
  fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_trabajo_sin_placa_sede_fecha (sede, fecha),
  INDEX idx_trabajo_sin_placa_creado_por (creado_por),
  CONSTRAINT fk_trabajo_sin_placa_usuario
    FOREIGN KEY (creado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS trabajos_taller_sin_placa_mecanicos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  trabajo_sin_placa_id INT NOT NULL,
  mecanico_id INT NOT NULL,
  trabajo TEXT NULL,
  repuestos TEXT NULL,
  INDEX idx_trabajo_sin_placa_mecanico (mecanico_id),
  UNIQUE KEY uq_trabajo_sin_placa_mecanico (trabajo_sin_placa_id, mecanico_id),
  CONSTRAINT fk_trabajo_sin_placa_detalle
    FOREIGN KEY (trabajo_sin_placa_id) REFERENCES trabajos_taller_sin_placa(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_trabajo_sin_placa_mecanico
    FOREIGN KEY (mecanico_id) REFERENCES mecanicos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
