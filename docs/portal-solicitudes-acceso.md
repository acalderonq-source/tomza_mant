# Solicitudes de acceso de proveedores

El ingreso público ofrece «Usuario nuevo · Solicitar acceso», en `/portal-proveedores/solicitar-acceso`.
Recoge cédula fiscal, razón social, correo de ingreso, persona de contacto, teléfono y dirección.
Enviar estos datos no crea usuarios, contraseñas ni sesiones autenticadas.

El propietario de Administración revisa la bandeja en `/administracion/portal-proveedores/solicitudes`,
accesible desde Cuentas de proveedores. Debe verificar la identidad y el correo por un canal conocido.
Puede vincular el registro a un proveedor existente o registrar la razón social solicitada,
definir contraseña inicial y plazo, y aprobar. También puede rechazar con motivo.
Los contactos permanecen disponibles en la solicitud para revisión y seguimiento.

La aprobación es transaccional, bloquea la solicitud y comprueba accesos existentes.
Se registra el usuario revisor, fecha, estado y cuenta creada. La contraseña solo se guarda mediante bcrypt.
La bandeja recibe las solicitudes; no se envían correos automáticamente ni credenciales por correo.
Administración comparte las credenciales por un canal verificado después de aprobar.

La cédula y el correo son únicos: un envío repetido no reemplaza los datos previamente recibidos.
El formulario tiene CSRF, validación del servidor, límite de cinco envíos por IP y hora y campo antispam.
La migración `202610170001_portal_solicitudes_acceso.sql` crea la tabla; Render la aplica al iniciar.
