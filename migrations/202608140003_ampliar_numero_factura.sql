ALTER TABLE facturas
  MODIFY COLUMN numero_factura TEXT NULL;

ALTER TABLE ordenes_compra
  MODIFY COLUMN factura TEXT NULL;
