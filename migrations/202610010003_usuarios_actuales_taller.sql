CREATE TABLE IF NOT EXISTS portal_departamento_config (
  id TINYINT NOT NULL PRIMARY KEY,
  asignacion_inicial_completa TINYINT(1) NOT NULL DEFAULT 0
);

INSERT IGNORE INTO portal_departamento_config (id, asignacion_inicial_completa) VALUES (1, 0);

DELETE FROM usuario_departamentos
WHERE departamento <> 'TALLER';

INSERT IGNORE INTO usuario_departamentos (usuario_id, departamento, es_principal)
SELECT id, 'TALLER', 1 FROM usuarios;

UPDATE usuario_departamentos SET es_principal = 1 WHERE departamento = 'TALLER';

UPDATE portal_departamento_config
SET asignacion_inicial_completa = 1
WHERE id = 1;
