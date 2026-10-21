ALTER TABLE asientos_pasivos_facturas MODIFY COLUMN factura_tipo ENUM('orden','independiente','portal') NOT NULL;
