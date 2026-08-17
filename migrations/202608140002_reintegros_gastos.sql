CREATE TABLE IF NOT EXISTS reintegros_gastos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fecha DATE NOT NULL,
  entregado_a VARCHAR(180) NOT NULL,
  numero_factura VARCHAR(100) NOT NULL,
  monto DECIMAL(14,2) NOT NULL DEFAULT 0,
  observacion TEXT NULL,
  creado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_reintegros_gastos_fecha (fecha),
  INDEX idx_reintegros_gastos_entregado_a (entregado_a),
  INDEX idx_reintegros_gastos_factura (numero_factura)
);
