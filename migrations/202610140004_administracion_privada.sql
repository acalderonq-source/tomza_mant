CREATE TABLE IF NOT EXISTS administracion_propietario (
 id TINYINT PRIMARY KEY,
 usuario_id INT NOT NULL UNIQUE
) ENGINE=InnoDB;
INSERT IGNORE INTO administracion_propietario (id,usuario_id)
SELECT 1,id FROM usuarios WHERE usuario='admin' AND rol='ADMIN' ORDER BY id LIMIT 1;
