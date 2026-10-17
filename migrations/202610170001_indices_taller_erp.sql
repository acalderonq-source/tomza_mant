-- Indices de consulta. No modifica documentos, saldos ni datos historicos.
ALTER TABLE mantenimientos ADD INDEX idx_mant_estado_fecha_unidad (estado, fecha_programada, unidad_id);
ALTER TABLE ordenes_compra ADD INDEX idx_ordenes_pagadas_fecha_pago (facturada, pagada, fecha_pago);
ALTER TABLE facturas ADD INDEX idx_facturas_pagadas_fecha_pago (pagada, fecha_pago);
