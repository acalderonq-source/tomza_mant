ALTER TABLE cont_presupuestos ADD COLUMN empresa VARCHAR(120) NOT NULL DEFAULT '' AFTER periodo;
ALTER TABLE cont_clasificaciones ADD COLUMN empresa VARCHAR(120) NOT NULL DEFAULT '' AFTER documento_id;
ALTER TABLE cont_presupuestos DROP INDEX uq_cont_presupuesto,
  ADD UNIQUE KEY uq_cont_presupuesto (periodo,empresa,sede,departamento,moneda,rubro);
