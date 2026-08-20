CREATE INDEX idx_facturas_estado_fecha ON facturas (pagada, fecha);
CREATE INDEX idx_facturas_proveedor_fecha ON facturas (proveedor_id, fecha);
CREATE INDEX idx_facturas_periodo ON facturas (periodo_cierre);
CREATE INDEX idx_facturas_fecha_pago ON facturas (fecha_pago);

CREATE INDEX idx_ordenes_facturas_estado_fecha ON ordenes_compra (facturada, pagada, factura_fecha, fecha);
CREATE INDEX idx_ordenes_facturas_proveedor_fecha ON ordenes_compra (proveedor_id, factura_fecha, fecha);
CREATE INDEX idx_ordenes_facturas_periodo ON ordenes_compra (periodo_cierre);
CREATE INDEX idx_ordenes_facturas_vencimiento ON ordenes_compra (facturada, pagada, fecha_vencimiento_factura);

CREATE INDEX idx_proveedores_nombre ON proveedores (nombre);
