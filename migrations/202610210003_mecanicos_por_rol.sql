-- Los permisos de mecánico ahora salen solo del rol, ya no del nombre de usuario.
-- Las cuentas cuyo usuario empieza con "mecanico" ya se trataban como mecánicos
-- limitados; aquí se les asigna el rol para conservar exactamente ese acceso.
UPDATE usuarios
SET rol = 'MECANICO'
WHERE LOWER(TRIM(usuario)) LIKE 'mecanico%'
  AND UPPER(COALESCE(rol, '')) NOT IN ('MECANICO', 'PANTALLA_MECANICOS', 'PANTALLA_PESADOS');
