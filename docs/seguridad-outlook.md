# Outlook personal para avisos de ingreso

Solo propietario en departamento ADMINISTRACION puede vincular en `/admin/ingresos/correo`.
Azure: aplicacion para cuentas personales, plataforma Web, URI exacta
`https://tomza-mant.onrender.com/admin/ingresos/correo/callback`.
Permisos delegados: User.Read, Mail.Send, offline_access.

Render: MS_SEGURIDAD_CLIENT_ID, MS_SEGURIDAD_CLIENT_SECRET y
EMAIL_USER_SEGURIDAD=gastomzasis@outlook.com. Con ambos valores MS presentes,
los avisos usan Graph exclusivamente: no SMTP ni cuenta de facturas.
Autorizar una vez con la cuenta esperada; los siguientes envios son automaticos.
Errores anteriores agotados requieren Reintentar aviso desde el registro.

La tabla seguridad_outlook_conexion se crea al autorizar (requiere CREATE TABLE).
Cache MSAL cifrada AES-256-GCM en MySQL; clave derivada SHA-256 del secreto de
cliente. Rotar ese secreto exige volver a autorizar (no se puede descifrar el
cache anterior). No publicar ni registrar tokens, secretos o respuestas OAuth.
El usuario puede revocar consentimiento en Microsoft; entonces debe revincular.
HTTP 202 significa aceptacion de Microsoft, no garantia de entrega en bandeja.
Timeout de envio ambiguo puede generar duplicados en reintentos; no hay garantia
de entrega exactamente una vez. Facturas y DEKRA no cambian.
