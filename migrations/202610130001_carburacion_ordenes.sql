CREATE TABLE IF NOT EXISTS carburacion_proveedores (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(200) NOT NULL,
  direccion TEXT,
  telefono VARCHAR(60),
  email VARCHAR(200),
  contacto VARCHAR(200),
  cedula_juridica VARCHAR(60),
  creado_por INT NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS carburacion_ordenes (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  po_numero VARCHAR(40) UNIQUE,
  fecha DATE NOT NULL,
  proveedor_id INT NOT NULL,
  forma_pago VARCHAR(100),
  moneda VARCHAR(10) NOT NULL,
  empresa_destino VARCHAR(40) NOT NULL,
  placa_unidad VARCHAR(100),
  subtotal DECIMAL(16,2) NOT NULL,
  descuento DECIMAL(16,2) NOT NULL,
  transporte DECIMAL(16,2) NOT NULL,
  iva DECIMAL(8,2) NOT NULL,
  total DECIMAL(16,2) NOT NULL,
  observaciones TEXT,
  lineas_json JSON NOT NULL,
  estado VARCHAR(30) NOT NULL DEFAULT 'BORRADOR',
  creado_por INT NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_por INT,
  actualizado_en TIMESTAMP NULL,
  FOREIGN KEY (proveedor_id) REFERENCES carburacion_proveedores(id)
);
