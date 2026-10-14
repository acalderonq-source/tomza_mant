# Refuerzo de seguridad

## Accesos y sesiones

- Máximo 10 intentos fallidos por identificador en 15 minutos, además del límite por IP. Se aplica al ingreso interno y al portal de proveedores. El límite por cuenta es por proceso; con varias instancias debe usarse un almacén compartido para el contador.
- Sesiones normales: 30 minutos sin actividad HTTP autenticada y 8 horas de duración máxima. Las cuentas de pantalla, que ya están restringidas a lectura, conservan su funcionamiento continuo.
- En cada solicitud autenticada interna se verifica un sello de contraseña, PIN, usuario, rol, sede y departamentos contra la base de datos. Al cambiar cualquiera de ellos, las sesiones anteriores dejan de servir. Si la base de datos no permite comprobar el acceso, se rechaza temporalmente la solicitud.
- Las cuentas externas conservan además su validación de proveedor activo y versión de acceso. Un proveedor solo puede descargar sus propios documentos.
- Después de instalar estos cambios hay que iniciar sesión nuevamente. En desarrollo, sin `SESSION_SECRET` privado, el secreto se genera aleatoriamente y cambia en cada reinicio. Producción requiere `SESSION_SECRET` en Render; no se debe publicar en Git ni compartir en chats.
- Los formularios incluyen protección CSRF, también el ingreso. Se rechazan orígenes distintos, se evita enviar tokens a servicios externos y se restringen las redirecciones del login. Las páginas incluyen protección contra marcos externos, interpretación incorrecta de archivos y filtración de referencias.
- Las rutas estáticas rechazan intentos de alcanzar archivos privados mediante directorios relativos. Los adjuntos financieros siguen detrás de la comprobación de sesión y permisos.

## Cifrado de MySQL: pendiente de configuración del servidor

La conexión local examinada el 14 de octubre de 2026 no tenía TLS activo. Una prueba con validación estricta falló porque Railway presentó una cadena autofirmada. No se desactivó la validación ni se cambió la conexión activa sin un certificado confiable.

El código ya permite `MYSQL_SSL_CA` (certificado PEM, con saltos de línea reales o `\n`) o `MYSQL_SSL_CA_FILE` (archivo privado). También permite `MYSQL_SSL=true` cuando el servidor usa una autoridad reconocida por el sistema. Se exige TLS 1.2 o superior, certificado válido e identidad del servidor coincidente con `MYSQLHOST`. Una conexión TLS fallida no vuelve automáticamente a texto plano. Configurar la CA puede requerir también ajustar el certificado del servidor para su nombre público. [Documentación de TLS de mysql2](https://sidorares.github.io/node-mysql2/docs/documentation/ssl).

Una vez configurado, comprobar `SHOW STATUS LIKE 'Ssl_cipher'` en la conexión real. El valor debe ser no vacío. No usar `rejectUnauthorized=false` ni `NODE_TLS_REJECT_UNAUTHORIZED=0` para resolver errores de certificado.

## Operación

Usar contraseñas únicas de al menos 12 caracteres para administradores. Reemplazar cualquier contraseña compartida por chat. Activar verificación en dos pasos en las cuentas de GitHub, Render, Railway y Microsoft; este cambio no incorpora todavía un segundo factor al login de la aplicación.

La revisión `npm audit --omit=dev` del 14 de octubre de 2026 reportó cero vulnerabilidades conocidas. Esto no equivale a una garantía contra intrusiones. Mantener dependencias actualizadas y copias de seguridad con acceso restringido.
