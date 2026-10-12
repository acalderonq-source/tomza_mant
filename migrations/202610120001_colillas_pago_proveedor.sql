CREATE TABLE IF NOT EXISTS colillas_pago_proveedor (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  recibo_numero VARCHAR(80) NOT NULL,
  fecha_pago DATE NOT NULL,
  periodo_cierre CHAR(7) NULL,
  tipo_pago VARCHAR(24) NOT NULL,
  total_pagado DECIMAL(14,2) NOT NULL DEFAULT 0,
  comprobante_numero VARCHAR(120) NULL,
  comprobante_archivo VARCHAR(255) NULL,
  generado_por VARCHAR(160) NOT NULL DEFAULT 'Sistema',
  facturas_json LONGTEXT NOT NULL,
  origen VARCHAR(20) NOT NULL DEFAULT 'actual',
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_colillas_pago_recibo (recibo_numero),
  KEY idx_colillas_pago_fecha (fecha_pago),
  KEY idx_colillas_pago_periodo (periodo_cierre),
  KEY idx_colillas_pago_origen (origen)
);
