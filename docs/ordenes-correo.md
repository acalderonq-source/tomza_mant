# Envio automatico de ordenes

Nuevas ordenes normales y de consumo consignado, de cualquier usuario autorizado:
una fila de salida por orden, insertada en la misma transaccion. No se envian
ordenes historicas ni al editar. El PDF corresponde a la copia original de la
orden, proveedor y lineas guardada en la cola, no a modificaciones posteriores.
Cada proveedor recibe solo su orden en proveedores.email (una direccion valida).
No hay copias a otros proveedores ni cambios a facturas/DEKRA.

Requiere Outlook previamente vinculado en /admin/ingresos/correo y las variables
MS_SEGURIDAD_CLIENT_ID, MS_SEGURIDAD_CLIENT_SECRET, EMAIL_USER_SEGURIDAD.
Se usa Graph y el cache cifrado ya existente; no se utilizan contrasenas SMTP.
El worker revisa cada minuto, 5 elementos, hasta 3 intentos con pausa 5 minutos.
MAIL_ENABLED=false y staging no envian. PDF maximo 2.5 MB.

Tabla ordenes_correo_envios creada antes de abrir la transaccion de creacion.
CREATE TABLE debe estar permitido. Un fallo de guardar la cola revierte la orden,
un fallo de Microsoft no revierte la orden ya guardada. Estado visible en detalle.
SIN_CORREO requiere corregir proveedor y reintentar. Reintento solo para roles que
crean ordenes, POST protegido por CSRF global, no reenvia ENVIADO ni ENVIANDO.
Envios interrumpidos o timeout quedan REVISION: comprobar Enviados en Outlook
antes de reintentar para evitar duplicados. HTTP 202 no garantiza entrega final.
No hay promesa de exactamente una entrega ante errores distribuidos.
