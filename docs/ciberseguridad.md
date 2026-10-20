# Eventos reales de seguridad

El panel privado `/admin/ciberseguridad` registra desde su activación ingresos con credenciales incorrectas, respuestas 429 y respuestas 401/403 de la aplicación. No reconstruye el pasado ni detecta malware o ataques a dispositivos. Una sesión vencida o un error de permisos también pueden generar eventos; no son ataques confirmados.

La migración `202610200003_ciberseguridad_real.sql` crea tablas nuevas sin modificar usuarios ni registros anteriores. Render aplica las migraciones al iniciar. El panel usa exclusivamente esas tablas; no mezcla la muestra histórica ni los inicios de sesión correctos.

Se agrupan eventos equivalentes por IP, perfil autenticado, tipo, ruta, HTTP y ventana de 15 minutos. Cada grupo conserva el número de intentos y primera/última fecha. Los perfiles sin autenticar se muestran como «Sin sesión»; no se guardan contraseñas, PIN, cuerpos, parámetros de URL ni cédulas introducidas. La IP usa `req.ip` con la configuración de proxy existente, no cabeceras arbitrarias leídas directamente. La ruta registrada usa el patrón Express cuando está disponible; para rechazos anteriores al enrutamiento conserva solo el primer segmento.

El gráfico cuenta intentos; pendientes y resueltos cuentan grupos. HTTP 401/403/429 indican solicitudes rechazadas; los ingresos fallidos devuelven el formulario HTTP 200 y se cuentan por separado. Gravedad inicial: ingreso fallido Baja, acceso denegado Media y límite alcanzado Alta; no se asigna gravedad Crítica automáticamente.

El registro es asíncrono y no altera la respuesta ni los bloqueos existentes. Cola máxima de 256 escrituras por proceso; fallos de almacenamiento o saturación se muestran en el panel y se avisan en el log sin datos del usuario. Los contadores de fallo se reinician con el proceso. No hay reintentos indefinidos. No se garantiza capturar tráfico rechazado antes de Express ni respuestas sin finalizar por desconexión.

Administración puede cambiar el estado y dejar una nota. Estado y nota se guardan en transacción con control de versión, autor y hora. Un grupo resuelto conserva ese estado al recibir repeticiones en su ventana; la nueva actividad aumenta intentos y versión. Al comenzar otra ventana nace un grupo pendiente. Las notas recientes se pueden consultar desde el panel.

Actualización automática cada 60 segundos y manual. CSV limitado a 10000 grupos, protegido contra fórmulas de hoja de cálculo. Acceso y cambios sujetos al permiso privado de Administración y protección CSRF del sistema. Horas y períodos de Costa Rica. Los datos permanecen en MySQL hasta establecer una política de retención; no se eliminan automáticamente.
