CREATE INDEX idx_ordenes_cruce_facturacion ON ordenes_compra (facturada, fecha, proveedor_id, total);
CREATE INDEX idx_ordenes_cruce_factura_fecha ON ordenes_compra (factura(60), factura_fecha);
CREATE INDEX idx_ordenes_detalle_cruce_producto ON ordenes_compra_detalle (orden_compra_id, codigo_producto);
CREATE INDEX idx_facturas_cruce_numero_fecha ON facturas (numero_factura(60), fecha);
