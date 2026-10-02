ALTER TABLE bodega_ordenes_consumo
  ADD COLUMN contacto_confirmacion VARCHAR(180) NULL AFTER sede;

ALTER TABLE bodega_ordenes_consumo
  ADD COLUMN referencia_confirmacion VARCHAR(180) NULL AFTER contacto_confirmacion;

ALTER TABLE bodega_ordenes_consumo
  ADD COLUMN confirmado_por INT NULL AFTER referencia_confirmacion;

ALTER TABLE bodega_ordenes_consumo
  ADD COLUMN confirmado_en DATETIME NULL AFTER confirmado_por;
