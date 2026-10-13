ALTER TABLE carburacion_facturas MODIFY COLUMN orden_id INT NULL;
ALTER TABLE carburacion_facturas ADD COLUMN cliente_id INT NULL;
ALTER TABLE carburacion_facturas ADD COLUMN periodo_cierre CHAR(7) NULL;
ALTER TABLE carburacion_facturas ADD CONSTRAINT fk_carburacion_factura_cliente FOREIGN KEY (cliente_id) REFERENCES carburacion_clientes(id);
ALTER TABLE carburacion_pagos ADD COLUMN periodo_cierre CHAR(7) NULL;

UPDATE carburacion_pagos SET periodo_cierre=DATE_FORMAT(fecha,'%Y-%m') WHERE periodo_cierre IS NULL;
UPDATE carburacion_facturas f
JOIN carburacion_ordenes o ON o.id=f.orden_id
SET f.cliente_id=o.cliente_id WHERE f.cliente_id IS NULL;
UPDATE carburacion_facturas f
JOIN (
  SELECT d.factura_id, MAX(p.fecha) fecha_ultimo_pago
  FROM carburacion_pagos_detalle d JOIN carburacion_pagos p ON p.id=d.pago_id
  GROUP BY d.factura_id
) ult ON ult.factura_id=f.id
SET f.periodo_cierre=DATE_FORMAT(ult.fecha_ultimo_pago,'%Y-%m') WHERE f.periodo_cierre IS NULL;
