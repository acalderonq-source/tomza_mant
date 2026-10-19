# Perfil de Seguridad Ocupacional

Usuario: seguridad_ocupacional. Nombre: Seguridad Ocupacional.
Rol interno: SEGURIDAD_OCUP (compatible con usuarios.rol VARCHAR(20)).
Departamento exclusivo: SEGURIDAD_OCUPACIONAL.

El alta solicitada usa src/scripts/crearPerfilSeguridadOcupacional.js, transaccion
unica, clave temporal aleatoria almacenada con bcrypt y cambio obligatorio.
No crea identidad personal, PIN de trabajador ni carnet. Se puede asignar este
perfil al aprobar solicitudes individuales desde Administracion.
Una segunda ejecucion no restablece contrasenas ni sobrescribe permisos.

Inicio empresarial solo habilita Seguridad Ocupacional. El servidor bloquea
tambien accesos directos a otras areas, no solo sus botones. Dashboard redirige
a la entrada del departamento sin cargar indicadores del taller. La entrada
propia permite ADMIN o SEGURIDAD_OCUP con el departamento activo autorizado.

Actualmente no hay procesos funcionales de Seguridad Ocupacional implementados.
El perfil accede a toda su area disponible; no se le otorgan modulos de Taller,
Contabilidad, Proveeduria o Administracion para simular funciones inexistentes.
