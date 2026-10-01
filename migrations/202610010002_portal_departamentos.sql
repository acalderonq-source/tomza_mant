CREATE TABLE IF NOT EXISTS usuario_departamentos (
  usuario_id INT NOT NULL,
  departamento VARCHAR(40) NOT NULL,
  es_principal TINYINT(1) NOT NULL DEFAULT 0,
  asignado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, departamento),
  INDEX idx_usuario_departamentos_departamento (departamento)
);

INSERT IGNORE INTO usuario_departamentos (usuario_id, departamento, es_principal)
SELECT id, 'TALLER', 1 FROM usuarios
WHERE UPPER(rol) IN ('TALLER', 'MECANICO', 'SUPERVISOR', 'BODEGA', 'BODEGUERO', 'PROVEEDURIA_TALLER')
   OR UPPER(usuario) LIKE 'MECANICO%'
   OR UPPER(usuario) LIKE 'MECANICOS%';

INSERT IGNORE INTO usuario_departamentos (usuario_id, departamento, es_principal)
SELECT id, 'OPERACIONES',
  CASE WHEN UPPER(rol) IN ('SUPERVISOR', 'SUPERVISOR_PESADO', 'TRAMITES') THEN 1 ELSE 0 END
FROM usuarios
WHERE UPPER(rol) IN ('TALLER', 'SUPERVISOR', 'SUPERVISOR_PESADO', 'TRAMITES');

INSERT IGNORE INTO usuario_departamentos (usuario_id, departamento, es_principal)
SELECT id, 'CONTABILIDAD', 1 FROM usuarios
WHERE UPPER(rol) = 'CONTABILIDAD';

INSERT IGNORE INTO usuario_departamentos (usuario_id, departamento, es_principal)
SELECT id, 'PROVEEDURIA',
  CASE WHEN UPPER(rol) IN ('PROVEEDURIA', 'BODEGA', 'BODEGUERO') THEN 1 ELSE 0 END
FROM usuarios
WHERE UPPER(rol) IN ('TALLER', 'PROVEEDURIA', 'PROVEEDURIA_TALLER', 'BODEGA', 'BODEGUERO');

INSERT IGNORE INTO usuario_departamentos (usuario_id, departamento, es_principal)
SELECT id, 'LOGISTICA',
  CASE WHEN UPPER(rol) = 'MENSAJERO' THEN 1 ELSE 0 END
FROM usuarios
WHERE UPPER(rol) IN ('TRAMITES', 'MENSAJERO', 'MENSAJERIA', 'MENSAJERO_FACTURAS');

INSERT IGNORE INTO usuario_departamentos (usuario_id, departamento, es_principal)
SELECT id, 'TALLER', 1 FROM usuarios WHERE UPPER(rol) = 'ADMIN';
INSERT IGNORE INTO usuario_departamentos (usuario_id, departamento, es_principal)
SELECT id, 'OPERACIONES', 0 FROM usuarios WHERE UPPER(rol) = 'ADMIN';
INSERT IGNORE INTO usuario_departamentos (usuario_id, departamento, es_principal)
SELECT id, 'CONTABILIDAD', 0 FROM usuarios WHERE UPPER(rol) = 'ADMIN';
INSERT IGNORE INTO usuario_departamentos (usuario_id, departamento, es_principal)
SELECT id, 'SEGURIDAD_OCUPACIONAL', 0 FROM usuarios WHERE UPPER(rol) = 'ADMIN';
INSERT IGNORE INTO usuario_departamentos (usuario_id, departamento, es_principal)
SELECT id, 'LOGISTICA', 0 FROM usuarios WHERE UPPER(rol) = 'ADMIN';
INSERT IGNORE INTO usuario_departamentos (usuario_id, departamento, es_principal)
SELECT id, 'PROVEEDURIA', 0 FROM usuarios WHERE UPPER(rol) = 'ADMIN';
INSERT IGNORE INTO usuario_departamentos (usuario_id, departamento, es_principal)
SELECT id, 'RECURSOS_HUMANOS', 0 FROM usuarios WHERE UPPER(rol) = 'ADMIN';

UPDATE usuario_departamentos SET es_principal = 0;
UPDATE usuario_departamentos ud
JOIN usuarios u ON u.id = ud.usuario_id
SET ud.es_principal = 1
WHERE ud.departamento = CASE
  WHEN UPPER(u.rol) = 'ADMIN' THEN 'TALLER'
  WHEN UPPER(u.rol) = 'CONTABILIDAD' THEN 'CONTABILIDAD'
  WHEN UPPER(u.rol) IN ('PROVEEDURIA', 'PROVEEDURIA_TALLER', 'BODEGA', 'BODEGUERO') THEN 'PROVEEDURIA'
  WHEN UPPER(u.rol) IN ('MENSAJERO', 'MENSAJERIA', 'MENSAJERO_FACTURAS') THEN 'LOGISTICA'
  WHEN UPPER(u.rol) IN ('SUPERVISOR', 'SUPERVISOR_PESADO', 'TRAMITES') THEN 'OPERACIONES'
  ELSE 'TALLER'
END;
