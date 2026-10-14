CREATE TABLE IF NOT EXISTS prov_portal_recepciones_compras (
 id INT AUTO_INCREMENT PRIMARY KEY,
 orden_id INT NOT NULL,
 referencia VARCHAR(100) NOT NULL,
 lineas JSON NOT NULL,
 actor INT NOT NULL,
 creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_portal_recepcion (orden_id, referencia),
 INDEX idx_portal_recepcion_orden (orden_id)
) ENGINE=InnoDB;
