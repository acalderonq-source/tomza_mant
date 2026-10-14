# Refuerzo de seguridad

## Accesos y sesiones

- Máximo 10 intentos fallidos por identificador en 15 minutos, además del límite por IP. Se aplica al ingreso interno y al portal de proveedores. El límite por cuenta es por proceso; con varias instancias debe usarse un almacén compartido para el contador.
- Sesiones normales: 30 minutos sin actividad HTTP autenticada y 8 horas de duración máxima. Las cuentas de pantalla, que ya están restringidas a lectura, conservan su funcionamiento continuo.
- En cada solicitud autenticada interna se verifica un sello de contraseña, PIN, usuario, rol, sede y departamentos contra la base de datos. Al cambiar cualquiera de ellos, las sesiones anteriores dejan de servir. Si la base de datos no permite comprobar el acceso, se rechaza temporalmente la solicitud.
- Las cuentas externas conservan además su validación de proveedor activo y versión de acceso. Un proveedor solo puede descargar sus propios documentos.
- Después de instalar estos cambios hay que iniciar sesión nuevamente. En desarrollo, sin `SESSION_SECRET` privado, el secreto se genera aleatoriamente y cambia en cada reinicio. Producción requiere `SESSION_SECRET` en Render; no se debe publicar en Git ni compartir en chats.
- Los formularios incluyen protección CSRF, también el ingreso. Se rechazan orígenes distintos, se evita enviar tokens a servicios externos y se restringen las redirecciones del login. Las páginas incluyen protección contra marcos externos, interpretación incorrecta de archivos y filtración de referencias.
- Las rutas estáticas rechazan intentos de alcanzar archivos privados mediante directorios relativos. Los adjuntos financieros siguen detrás de la comprobación de sesión y permisos.

## Cifrado de MySQL

La conexión original no usaba TLS. Se obtuvieron la CA y el certificado público del servicio **man-cartago** mediante la consola autenticada de Railway. La conexión local ya se verificó cifrada con TLS y se comprobó que una identidad incorrecta se rechaza antes del acceso a MySQL.

El código admite `MYSQL_SSL_CA` (certificado PEM, con saltos de línea reales o `\n`) o `MYSQL_SSL_CA_FILE` (archivo privado). `MYSQL_SSL=true` utiliza las autoridades del sistema. Se exige TLS 1.2 o superior, certificado válido e identidad verificada, sin volver automáticamente a texto plano ante un fallo. [Documentación de TLS de mysql2](https://sidorares.github.io/node-mysql2/docs/documentation/ssl).

En Railway, el nombre del proxy TCP difiere del nombre certificado de MySQL. `MYSQL_SSL_SERVER_NAME` establece esa identidad, obtenida del certificado descargado por el canal administrativo autenticado. La conexión TCP sigue usando `MYSQLHOST` y `MYSQLPORT`; la verificación TLS usa el nombre certificado y la CA propia de ese servicio. No se desactiva `verifyIdentity` ni `rejectUnauthorized`. No obtener este nombre o la CA de una conexión de red sin autenticar.

La CA local se guarda en `secrets/mysql-ca.pem`, excluido de Git, y la configuración en `.env`. En Render se configura la CA como variable de entorno y la identidad como `MYSQL_SSL_SERVER_NAME`. Para verificar producción, `/ready` debe responder `database_tls: true`. Si Railway regenera sus certificados, obtener los nuevos desde su consola autenticada y probarlos antes de reemplazar la configuración.

## Operación

Usar contraseñas únicas de al menos 12 caracteres para administradores. Reemplazar cualquier contraseña compartida por chat. Activar verificación en dos pasos en las cuentas de GitHub, Render, Railway y Microsoft; este cambio no incorpora todavía un segundo factor al login de la aplicación.

La revisión `npm audit --omit=dev` del 14 de octubre de 2026 reportó cero vulnerabilidades conocidas. Esto no equivale a una garantía contra intrusiones. Mantener dependencias actualizadas y copias de seguridad con acceso restringido.
