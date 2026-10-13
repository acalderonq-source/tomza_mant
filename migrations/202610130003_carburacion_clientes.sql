CREATE TABLE IF NOT EXISTS carburacion_clientes (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  archivo_origen VARCHAR(200),
  hoja_origen VARCHAR(100),
  fila_origen INT,
  creado_por INT NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_carburacion_cliente_nombre (nombre)
);

ALTER TABLE carburacion_ordenes ADD COLUMN cliente_id INT NULL;
ALTER TABLE carburacion_ordenes ADD CONSTRAINT fk_carburacion_orden_cliente FOREIGN KEY (cliente_id) REFERENCES carburacion_clientes(id);
