ALTER TABLE pagos_proveedor
  ADD COLUMN placa VARCHAR(50) NULL AFTER numero_factura;

CREATE INDEX idx_pagos_proveedor_placa
  ON pagos_proveedor (placa);
