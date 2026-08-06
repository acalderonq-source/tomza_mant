ALTER TABLE solicitudes_repuestos ADD COLUMN entregado_por VARCHAR(150) NULL;
ALTER TABLE solicitudes_repuestos ADD COLUMN recibido_por VARCHAR(150) NULL;
ALTER TABLE solicitudes_repuestos ADD COLUMN entregado_en DATETIME NULL;

