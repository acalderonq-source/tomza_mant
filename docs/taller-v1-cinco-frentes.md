# Taller V1: cinco frentes de mejora

## Implementado en esta entrega

1. **Compras y pagos**: identificador por formulario en altas de ordenes, consignacion, pagos y abonos. El servidor conserva el identificador y bloquea su reenvio, incluso si la respuesta se pierde. Los pagos se serializan mediante un bloqueo MySQL sin espera para reducir carreras entre operadores. El historial de colillas y la trazabilidad ya existentes siguen siendo la fuente para revisar el resultado.
2. **Seguridad y auditoria**: Centro de control exclusivo de ADMIN. Bitacora consultable y exportable de los ultimos cambios. Crear y editar ordenes registra actor y valores dentro de la transaccion. Se usan los nombres individuales de la sesion cuando estan disponibles, aunque el perfil de permisos sea compartido. No se modificaron PIN ni perfiles existentes.
3. **Recuperacion**: herramienta de respaldo de SQL y adjuntos por streaming, cifrado AES-256-GCM, compresion, hashes y verificacion de descifrado. Carpetas incompletas nunca se publican como completas. Ejecucion diaria opcional a las 02:00 de Costa Rica; alertas webhook opcionales. No hay claves ni contrasenas en argumentos del proceso ni en el manifiesto.
4. **Taller**: expediente consultable por placa para ADMIN, TALLER y PROVEEDURIA_TALLER, con ocho fuentes de historial. Centro de control muestra inventario en minimo, mantenimientos vencidos y MINAE por vencer. Presupuestos, pagos, inventario y preventivos existentes se conservan; no se inventan cifras ni se mezclan monedas.
5. **Publicacion**: revision de sintaxis, pruebas y auditoria de dependencias en CI; plan de migraciones de solo lectura; plantilla de staging con base y adjuntos separados y correo deshabilitado. Version y revision visibles en el centro de control.

Accesos desde el dashboard: **Centro de control** (ADMIN) y **Expediente por placa** (perfiles de gestion de Taller).

## Configuracion necesaria antes de activar respaldos

- Instalar cliente MySQL 8 compatible (`mysqldump`) y `tar` en el entorno donde se ejecuta el servicio. No se instalaron herramientas en Render desde este cambio.
- Definir `BACKUP_ROOT` en un volumen persistente fuera de `public` y de `UPLOAD_ROOT`. Nunca usar el disco efimero de Render para conservar copias.
- Generar `BACKUP_KEY` con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Guardarla como secreto y conservar otra copia en una boveda independiente. Perderla impide recuperar los respaldos.
- Configurar TLS verificable para `mysqldump`. Una conexion con proxy y `MYSQL_SSL_SERVER_NAME` distinto al host necesita un tunel/cliente validado: el script se niega a desactivar TLS para conseguir el respaldo.
- Ejecutar `npm run backup:create` y comprobar `npm run backup:verify -- RUTA_DE_LA_CARPETA`. Una clave incorrecta, archivo truncado o contenido modificado falla la verificacion.
- Copiar los respaldos cifrados a almacenamiento externo con acceso restringido y retencion. **Esta copia externa no esta automatizada en esta entrega**; una copia en el mismo servidor no protege contra perder ese servidor.
- Solo despues, activar `BACKUP_ENABLED=true`. El bloqueo `.respaldo.lock` evita dos ejecuciones simultaneas. Si el proceso se interrumpe, un operador debe verificar que ya no esta ejecutandose antes de retirar un bloqueo huerfano; no se borra automaticamente.
- Configurar `OPS_ALERT_WEBHOOK` con un endpoint HTTPS que acepte JSON. No se incluye informacion de empleados, facturas ni credenciales en los avisos. Hay enfriamiento de 15 minutos por evento. Las alertas no funcionan hasta configurar el destinatario.

El respaldo SQL usa `--single-transaction`: verificar que las tablas de negocio usan InnoDB. No ejecutar migraciones durante la copia. Los adjuntos se copian despues de SQL; detener eliminaciones de archivos durante la ventana. La verificacion criptografica **no garantiza** que SQL se restaure correctamente.

## Prueba de recuperacion pendiente de infraestructura

En un equipo aislado, configurar `RESTORE_OUTPUT` con una carpeta nueva, privada, y ejecutar `npm run backup:extract -- RUTA_DEL_RESPALDO`. Esto verifica y extrae `database.sql` y `uploads.tar`, sin ejecutar SQL ni sobrescribir archivos. Restaurar SQL con un usuario limitado a una base nueva, y recuperar el TAR en otra carpeta tras revisar su listado. Nunca apuntar una prueba a produccion. Comparar cantidad de registros de ordenes/facturas/colillas/unidades y abrir una muestra de comprobantes, fotos y PDF. Registrar fecha, responsable y resultado. No marcar recuperacion como probada hasta completar este ejercicio.

## Staging y publicaciones

1. Crear una base separada con datos anonimizados y un usuario sin permisos sobre produccion. No copiar sesiones, tokens de correo ni suscripciones push reales.
2. Usar `render.staging.yaml` como plantilla, sin asumir que fue desplegada. Definir `APP_ENV=staging`, `STAGING_DATABASE_NAME`, `MYSQLDATABASE`, `PRODUCTION_DATABASE_NAME`, `MAIL_ENABLED=false`; conectar un disco separado.
3. Revisar `npm run migrate:plan`. No ejecutar todas las migraciones pendientes sobre datos reales sin revisar sus efectos. Los checksums diferentes requieren investigacion, no sobrescribir el historial.
4. Probar guardado de orden, descarga PDF, abono, pago multiple, recuperacion de colilla, permisos y expediente. Hacerlo con documentos de prueba, no pagos reales.
5. Publicar solo tras CI aprobado y validacion de staging. Los Blueprints de produccion y staging usan `autoDeployTrigger: checksPass`, segun la [referencia oficial de Render](https://render.com/docs/blueprint-spec). Si el servicio existente no esta administrado por ese Blueprint, configurar tambien **After CI Checks Pass** desde Render; cambiar el archivo no confirma que el ajuste remoto se haya aplicado.
6. Verificar `/ready` y su revision. Guardar el commit anterior como referencia para revertir codigo; revertir codigo no revierte migraciones ni datos.

## Limites y trabajo que sigue

- Esta entrega es una base funcional en los cinco frentes, no el cierre de todo el ERP.
- El registro de operaciones indica solicitud recibida/respuesta, **no confirma pago**. Una interrupcion puede requerir conciliacion manual; no se elimina el identificador para repetir ciegamente. `RESPONDIDA` tampoco significa que una redireccion haya completado el negocio.
- No se sustituyeron todas las rutas historicas de pagos por un libro contable inmutable. Falta revisar y transaccionar integralmente cada flujo de pago/colilla/correo y cubrir todos los importadores y rutas alternativas. El bloqueo serializa estas tres rutas de pago, no procesos externos o ediciones fuera de ellas.
- La bitacora antes/despues nueva cubre altas y ediciones normales de ordenes; no todos los cambios del sistema. Expandir por modulo y probar rollback de cada uno.
- Cada historial muestra hasta 100 filas; no es un total financiero de toda la vida de la unidad. Ordenes se vinculan por su placa de encabezado, por lo que faltan consumos por placa presentes solo en lineas de ordenes mixtas. Ver el detalle de la orden para ese caso.
- No se implemento una nueva cadena de aprobaciones ni se dividieron automaticamente las cuentas compartidas. Requieren definir responsables y autorizaciones por importe.
- Los respaldos, almacenamiento externo, simulacro de restauracion, destinatario de alertas y servicio de staging requieren configuracion y verificacion reales. No se activaron ni se facturo infraestructura automaticamente.
