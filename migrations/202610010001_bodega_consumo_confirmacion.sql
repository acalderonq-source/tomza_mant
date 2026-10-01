ALTER TABLE bodega_ordenes_consumo
  ADD COLUMN contacto_confirmacion VARCHAR(180) NULL AFTER sede,
  ADD COLUMN referencia_confirmacion VARCHAR(180) NULL AFTER contacto_confirmacion,
  ADD COLUMN confirmado_por INT NULL AFTER referencia_confirmacion,
  ADD COLUMN confirmado_en DATETIME NULL AFTER confirmado_por;
