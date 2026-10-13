CREATE TABLE IF NOT EXISTS prov_inventario_fichas (
 sede VARCHAR(100) NOT NULL,
 codigo VARCHAR(80) NOT NULL,
 grupo VARCHAR(20) NOT NULL DEFAULT 'INVENTARIO',
 tipo VARCHAR(20) NOT NULL DEFAULT 'OTRO',
 categoria VARCHAR(100) NOT NULL DEFAULT '',
 unidad VARCHAR(30) NOT NULL DEFAULT 'UND',
 ubicacion VARCHAR(120) NOT NULL DEFAULT '',
 stock_minimo DECIMAL(14,3) NOT NULL DEFAULT 0,
 stock_maximo DECIMAL(14,3) NOT NULL DEFAULT 0,
 proveedor VARCHAR(255) NOT NULL DEFAULT '',
 PRIMARY KEY (sede,codigo)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS prov_inventario_movimientos (
 id INT AUTO_INCREMENT PRIMARY KEY,
 sede VARCHAR(100) NOT NULL,
 codigo VARCHAR(80) NOT NULL,
 descripcion VARCHAR(255) NOT NULL,
 tipo VARCHAR(30) NOT NULL,
 cantidad DECIMAL(14,3) NOT NULL,
 existencia_anterior DECIMAL(14,3) NOT NULL,
 existencia_nueva DECIMAL(14,3) NOT NULL,
 documento_id INT NULL,
 usuario_id INT NOT NULL,
 motivo VARCHAR(500) NOT NULL DEFAULT '',
 creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_prov_mov_sede (sede,id),
 INDEX idx_prov_mov_articulo (sede,codigo,id)
) ENGINE=InnoDB;
