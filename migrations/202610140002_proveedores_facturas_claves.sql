CREATE TABLE IF NOT EXISTS prov_facturas_claves (
  clave CHAR(50) PRIMARY KEY,
  documento_id INT NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_prov_facturas_documento (documento_id)
);
