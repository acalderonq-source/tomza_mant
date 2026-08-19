ALTER TABLE ordenes_motor
  ADD COLUMN pagada TINYINT(1) NOT NULL DEFAULT 0 AFTER estado;

ALTER TABLE ordenes_motor
  ADD COLUMN fecha_pago DATE NULL AFTER pagada;

ALTER TABLE ordenes_motor
  ADD COLUMN periodo_cierre CHAR(7) NULL AFTER fecha_pago;

ALTER TABLE ordenes_motor
  ADD COLUMN monto_pagado_cierre DECIMAL(14,4) NULL AFTER periodo_cierre;

UPDATE ordenes_motor
SET pagada = 1,
    fecha_pago = COALESCE(fecha_pago, fecha),
    periodo_cierre = COALESCE(periodo_cierre, DATE_FORMAT(COALESCE(fecha_pago, fecha), '%Y-%m')),
    monto_pagado_cierre = COALESCE(monto_pagado_cierre, total)
WHERE UPPER(COALESCE(estado, '')) IN ('RECIBIDA_TOTAL', 'PAGADA', 'PAGADO', 'CERRADA', 'CERRADO');
