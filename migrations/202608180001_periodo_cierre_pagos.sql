ALTER TABLE pagos_proveedor
  ADD COLUMN periodo_cierre CHAR(7) NULL AFTER fecha_pago;

ALTER TABLE pagos_proveedor
  ADD INDEX idx_pagos_proveedor_periodo_cierre (periodo_cierre);

ALTER TABLE pagos_proveedor
  MODIFY COLUMN monto DECIMAL(14,4) NOT NULL DEFAULT 0;

UPDATE pagos_proveedor
SET periodo_cierre = DATE_FORMAT(COALESCE(fecha_pago, fecha_solicitud, DATE(creado_en)), '%Y-%m')
WHERE periodo_cierre IS NULL
  AND (fecha_pago IS NOT NULL OR fecha_solicitud IS NOT NULL OR creado_en IS NOT NULL);

ALTER TABLE ordenes_compra
  ADD COLUMN periodo_cierre CHAR(7) NULL AFTER fecha_pago;

ALTER TABLE ordenes_compra
  ADD INDEX idx_ordenes_compra_periodo_cierre (periodo_cierre);

UPDATE ordenes_compra
SET periodo_cierre = DATE_FORMAT(fecha_pago, '%Y-%m')
WHERE periodo_cierre IS NULL
  AND fecha_pago IS NOT NULL;

ALTER TABLE facturas
  ADD COLUMN periodo_cierre CHAR(7) NULL AFTER fecha_pago;

ALTER TABLE facturas
  ADD INDEX idx_facturas_periodo_cierre (periodo_cierre);

UPDATE facturas
SET periodo_cierre = DATE_FORMAT(fecha_pago, '%Y-%m')
WHERE periodo_cierre IS NULL
  AND fecha_pago IS NOT NULL;
