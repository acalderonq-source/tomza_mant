# Aprobacion individual por departamento y modulo

Sustituye el selector de usuarios/perfiles personales por departamento, sede
laboral y permisos por modulo (NINGUNO, LECTURA, GESTION). Administracion sigue
reservada al propietario: no es una opcion asignable. Modulos filtrados por area
en navegador y validados tambien en servidor. No se confia en campos ocultos.

Cada aprobacion crea usuario nuevo `acceso_<cedula>`, password aleatorio no
divulgado, identidad por cedula y PIN asignado por ADMIN, departamento explicito,
configuracion personal, carnet y correo verificado en una sola transaccion.
Conserva bloqueo FOR UPDATE, deteccion de cedula/PIN existentes y rollback.
No se modifican cuentas ni perfiles aprobados anteriormente. En adelante no se
acepta usuario_ids del formulario anterior. El namespace acceso_<cedula> queda
reservado para estas cuentas; su configuracion es obligatoria y falla cerrada.

Tabla usuario_accesos_personales creada de forma idempotente antes de comenzar
una aprobacion. Requiere CREATE TABLE al aprobar por primera vez. No hay cambios
de columnas en tablas existentes ni migracion masiva de usuarios.

Middleware anterior a uploads y rutas revisa configuracion actual en cada peticion
de cuentas del namespace. Modulo mas especifico gana (asientos no se habilita
con permiso facturas). Rutas no catalogadas se deniegan. Lectura solo GET/HEAD;
las mutaciones POST/PUT/PATCH/DELETE requieren GESTION. Se mantienen las reglas
de rol y departamento ya existentes: estos permisos restringen, no sustituyen
las autorizaciones del modulo ni conceden ADMIN. No debe haber acciones que
modifiquen datos mediante GET; cualquier ruta heredada asi debe corregirse.

Sede laboral es un dato de asignacion, NO aislamiento de datos por sede. Los
roles nativos pueden tener alcance global en sus modulos. No se promete un
filtro por fila ni una facultad administrativa inexistente. La pantalla avisa
este alcance. Un aislamiento de datos por sede exige revisar cada consulta.

Inicio personal muestra solo enlaces de modulos autorizados y no carga los
indicadores generales de Taller. Usuarios antiguos mantienen sus pantallas.
Areas sin procesos operativos pueden recibir solo Inicio del departamento.
La edicion posterior de permisos de cuentas existentes no se agrega en esta
entrega; este flujo configura nuevas solicitudes pendientes.
