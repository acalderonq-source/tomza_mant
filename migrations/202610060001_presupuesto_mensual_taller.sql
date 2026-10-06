CREATE TABLE IF NOT EXISTS taller_presupuestos_mensuales (
  periodo CHAR(7) NOT NULL,
  monto DECIMAL(14,2) NOT NULL DEFAULT 0,
  observacion VARCHAR(255) NULL,
  actualizado_por INT NULL,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (periodo)
);
