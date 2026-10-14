CREATE TABLE IF NOT EXISTS prov_portal_factura_orden (
 factura_id INT PRIMARY KEY,
 origen ENUM('PROVEEDURIA','COMPRAS') NOT NULL,
 orden_id INT NOT NULL,
 monto DECIMAL(14,5) NOT NULL,
 moneda VARCHAR(10) NOT NULL,
 vinculado_por INT NOT NULL,
 creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_portal_factura_orden (origen,orden_id),
 CONSTRAINT fk_portal_factura_documento FOREIGN KEY (factura_id) REFERENCES prov_documentos(id) ON DELETE CASCADE
) ENGINE=InnoDB;
