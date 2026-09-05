ALTER TABLE aceite_estanones
  ADD COLUMN monto_total DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER litros_restantes;

ALTER TABLE aceite_estanones
  ADD COLUMN orden_compra_id INT NULL AFTER monto_total;

ALTER TABLE aceite_estanones
  ADD COLUMN orden_compra_numero VARCHAR(50) NULL AFTER orden_compra_id;

CREATE INDEX idx_aceite_estanones_orden_compra
  ON aceite_estanones (orden_compra_id);
