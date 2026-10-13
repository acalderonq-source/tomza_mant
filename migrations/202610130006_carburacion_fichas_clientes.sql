ALTER TABLE carburacion_clientes ADD COLUMN razon_social VARCHAR(200) NULL;
ALTER TABLE carburacion_clientes ADD COLUMN cedula_juridica VARCHAR(40) NULL;
ALTER TABLE carburacion_clientes ADD COLUMN direccion TEXT NULL;
ALTER TABLE carburacion_clientes ADD COLUMN provincia VARCHAR(100) NULL;
ALTER TABLE carburacion_clientes ADD COLUMN canton VARCHAR(100) NULL;
ALTER TABLE carburacion_clientes ADD COLUMN distrito VARCHAR(100) NULL;
ALTER TABLE carburacion_clientes ADD COLUMN representante_legal VARCHAR(200) NULL;
ALTER TABLE carburacion_clientes ADD COLUMN tipo_actividad VARCHAR(200) NULL;
ALTER TABLE carburacion_clientes ADD COLUMN correo_notificacion VARCHAR(200) NULL;
ALTER TABLE carburacion_clientes ADD COLUMN telefono_notificacion VARCHAR(40) NULL;
ALTER TABLE carburacion_clientes ADD COLUMN codigo_minae VARCHAR(100) NULL;
ALTER TABLE carburacion_clientes ADD COLUMN version INT NOT NULL DEFAULT 1;
ALTER TABLE carburacion_clientes ADD COLUMN actualizado_por INT NULL;
ALTER TABLE carburacion_clientes ADD COLUMN actualizado_en TIMESTAMP NULL;
ALTER TABLE carburacion_clientes ADD UNIQUE KEY uq_carburacion_cliente_origen (archivo_origen,hoja_origen,fila_origen);

CREATE TABLE IF NOT EXISTS carburacion_cliente_editores (
  usuario_id INT NOT NULL PRIMARY KEY,
  motivo VARCHAR(200) NOT NULL,
  asignado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT IGNORE INTO carburacion_cliente_editores (usuario_id,motivo)
SELECT DISTINCT uc.usuario_id,'Autorización para agregar y editar clientes de Carburación'
FROM usuario_cedulas uc JOIN usuario_departamentos ud ON ud.usuario_id=uc.usuario_id
WHERE uc.persona_nombre='Fernández Mora Emily Camila' AND ud.departamento='CARBURACION';

CREATE TABLE IF NOT EXISTS carburacion_clientes_historial (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  accion VARCHAR(20) NOT NULL,
  antes_json JSON NULL,
  despues_json JSON NOT NULL,
  usuario_id INT NOT NULL,
  usuario_nombre VARCHAR(160) NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_carburacion_cliente_historial (cliente_id,id),
  FOREIGN KEY (cliente_id) REFERENCES carburacion_clientes(id)
);
