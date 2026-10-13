ALTER TABLE carburacion_ordenes ADD COLUMN numero_cotizacion VARCHAR(100) NULL;
ALTER TABLE carburacion_ordenes ADD COLUMN eliminado_en TIMESTAMP NULL;
ALTER TABLE carburacion_ordenes ADD COLUMN eliminado_por INT NULL;
