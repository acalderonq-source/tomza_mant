# Carburación

Departamento independiente. La entrada es `/carburacion/dashboard` y requiere que la sesión tenga Carburación asignado y activo. El acceso desde Taller se deniega, incluso para rutas de documentos y pagos.

## Órdenes y facturas

Las órdenes y proveedores se guardan en tablas `carburacion_*`; no se consultan ni modifican tablas financieras de Taller. Cada orden admite una factura y también pueden registrarse facturas independientes, sin generar una orden ficticia. El número de factura es único por proveedor. Al facturar una orden, se conserva el cliente, moneda e importe de la factura y se bloquea la edición de la orden.

El catálogo `carburacion_clientes` contiene las estaciones entregadas en el Excel. Los clientes se seleccionan en el encabezado y las líneas de la orden; se conserva su identificador y el nombre mostrado. El importador `node src/scripts/importarClientesCarburacion.js` utiliza `src/data/carburacion_clientes.json`, registra archivo/hoja/fila de origen y omite los nombres ya existentes, sin duplicarlos. El archivo original no se modifica.

La factura puede adjuntarse como PDF, PNG o JPG de hasta 5 MB. Los documentos se guardan dentro de MySQL y se descargan por rutas autenticadas de Carburación, sin archivos financieros públicos.

## Pagos

Desde Facturas se seleccionan una o varias facturas del mismo proveedor y moneda, con o sin orden. Se admite pago completo o abono de una factura. El saldo se valida y bloquea en una transacción; un identificador único del formulario evita pagos duplicados por reenvío. Los importes se calculan en centavos. Una falla revierte el pago, detalle y saldo juntos. No existe una vista separada “Pago de proveedor”.

El listado usa los filtros de Taller: proveedor, rango de fechas de factura, estado de pago, período de cierre, solo vencidas, orden de fecha y registros por página. También conserva búsqueda por factura/orden/cliente y origen con/sin orden. La paginación y los totales usan los mismos filtros. El período de cierre se registra en cada pago y en las facturas afectadas. Los enlaces de volver y cancelar conservan la consulta del listado, sin permitir retornos a otro módulo o dominio.

Cada pago genera una colilla `CAR-RP-000001` con una copia inmutable del detalle. El historial permite descargarla y recuperar el comprobante. No se ejecutan transferencias bancarias: se registra el pago realizado.

## Correos

La configuración de Carburación admite de una a tres copias internas y un correo de respuesta opcional. Usa las credenciales `EMAIL_USER_CARBURACION` / `EMAIL_PASS_CARBURACION` si existen; en caso contrario usa el remitente financiero `EMAIL_USER_FACTURAS` / `EMAIL_PASS_FACTURAS`. Se mantienen las opciones de servidor/puerto del servicio de correo existente. El nombre visible es “Carburación Gas Tomza”. No hereda el remitente general de Taller ni su lista de copias.

El envío se solicita marcando la casilla al pagar o desde el historial. Se adjuntan colilla y comprobante disponible. Sin SMTP o sin correo válido, el pago se conserva y el historial indica el motivo. Un envío confirmado no se repite al volver a pulsar el botón. Un estado “En proceso” interrumpido requiere comprobar la entrega antes de cualquier reenvío; no se reintenta automáticamente para evitar duplicados después de una aceptación SMTP.

## Estaciones

`/carburacion/estaciones` muestra seguimiento, construcción, trámites MINAE, permisos municipales, pendientes de iniciar y mantenimientos. Mejoras se retiró de las vistas y formularios; sus registros originales se conservan como archivo histórico. Usa sus propias tablas de Carburación; no utiliza los módulos de mantenimiento o MINAE de Taller. Para crear o actualizar un registro, se selecciona obligatoriamente un cliente del catálogo; el servidor toma su nombre y rechaza la escritura libre.

Los registros conservan nombre original, detalle, ejecutivo, prioridad, proveedores, campos particulares y procedencia (archivo, hoja y fila). Se vinculan a un cliente únicamente si el nombre normalizado tiene una coincidencia única; los demás permanecen disponibles y se pueden vincular manualmente desde edición. Las filas repetidas se conservan como registros distintos. El literal FINALIZADO en la columna Prioridad de Seguimiento se convierte en estado Finalizado; el valor original también se conserva. Los demás estados no se deducen de textos narrativos.

Mantenimientos calcula únicamente las fórmulas reconocidas de la misma fila, como `=B2+90`. Mantiene las fechas manuales y guarda como notas los textos encontrados en columnas de fecha. Se pueden filtrar vencidos, próximos 30 días y sin fecha, y actualizar el último mantenimiento con próxima fecha manual o por frecuencia. No se envían avisos ni se ejecutan las acciones descritas en las celdas automáticamente.

Cada creación, importación y actualización genera historial con actor, fecha y copia de los datos. El control de versión rechaza una edición si otra persona ya guardó un cambio. No se elimina información de origen al actualizar un avance.

`node src/scripts/importarEstacionesCarburacion.js` importa el extracto `src/data/carburacion_estaciones.json`. La huella del archivo, hoja y fila evitan duplicados al repetir el mismo archivo. No sobrescribe avances existentes. Las 30 filas con datos pero sin estación quedan registradas en `omitidas` del extracto y no generan tareas. El archivo Excel original permanece intacto.

## Instalación y validación

Migraciones: `202610130001_carburacion_ordenes.sql`, `202610130002_carburacion_facturas_pagos.sql`, `202610130003_carburacion_clientes.sql`, `202610130004_carburacion_facturas_independientes.sql` y `202610130005_carburacion_estaciones.sql`. Aplicarlas mediante el mecanismo de migraciones y registrar sus checksums. No se agregan cambios de esquema en las rutas.

Las pruebas habituales se ejecutan con `npm test`. La prueba optativa contra MySQL crea tablas con un prefijo aleatorio, prueba pagos simultáneos, reversión, colillas, monedas y reintentos de correo simulados y elimina sus propias tablas al terminar:

```powershell
$env:CARBURACION_DB_TEST='1'
node --test tests/carburacionFinanzas.db.js
node --test tests/carburacionEstaciones.db.js
Remove-Item Env:CARBURACION_DB_TEST
```

Esta prueba requiere una base de desarrollo/pruebas configurada; nunca envía correos reales ni crea pagos en las tablas normales de Carburación.
# Fichas de clientes

## Incidencias y expediente del cliente

La migración `202610190001_carburacion_expediente_incidencias.sql` agrega reportes de incidencias y documentos asociados por cliente. Desde la ficha se reportan incidencias con título, descripción, fecha y estado (abierta, en seguimiento o resuelta). Se conservan el reporte original y el autor; el estado admite actualización con control de versión. Los usuarios con permiso de edición de clientes pueden crear incidencias y adjuntar archivos; los demás accesos autorizados a Carburación pueden consultarlos.

El expediente reúne fotos y documentos PDF, JPG, PNG o WEBP de hasta 3 MB por archivo. Los archivos se guardan en la base de datos con tipo, tamaño, hash y autor; se descargan exclusivamente mediante rutas autenticadas de Carburación y se comprueba su asociación con el cliente. Las fotos tienen vista previa; los PDF se descargan. No se publican archivos en directorios estáticos.

Al registrar un representante legal se exigen los dos adjuntos: cédula jurídica y poder. Al editar, se reutilizan los documentos existentes del mismo representante; si cambia el representante, debe adjuntar ambos nuevamente. El guardado de la ficha y los adjuntos es transaccional. Los documentos anteriores permanecen en el expediente para consulta histórica. El formulario requiere JavaScript para adjuntar los archivos y respeta el límite de 10 MB del servidor, con un máximo conjunto de 6 MB binarios en el alta.

El rol `CARBURACION_GESTOR` administra estaciones, clientes, proveedores y configuración de correos. Las órdenes, facturas y pagos son solo de consulta: puede filtrar y descargar PDF, adjuntos, colillas y comprobantes, pero no crear, editar, eliminar, facturar, pagar ni enviar colillas. El middleware del departamento protege los métodos de escritura y los formularios, además de ocultar las acciones en las vistas. El script `src/scripts/crearGestorCarburacion.js` da de alta la cuenta individual solicitada de José Luis, sin asignarle otros departamentos ni privilegios de administrador. Rechaza una cédula ya registrada, y crea cuenta, identidad, asignación y permiso de clientes en una transacción. Utiliza el acceso por cédula y PIN de código de trabajador existente en el sistema.

Las órdenes admiten un número de cotización opcional de hasta 100 caracteres, visible en el formulario, listado y PDF. La migración `202610130007_carburacion_ordenes_cotizacion_eliminar.sql` agrega el número y la eliminación lógica con fecha y usuario responsable. Eliminar retira la orden del listado, indicadores y acceso a edición/PDF/facturación. Una orden con factura asociada no se puede eliminar. La comprobación de factura y la eliminación bloquean la misma orden en una transacción para evitar conflictos con una factura simultánea. No se reutilizan consecutivos.

Cada nombre del catálogo abre una ficha con nombre de la gasolinera, razón social, cédula jurídica, representante legal, actividad, código MINAE, provincia, cantón, distrito, dirección exacta y datos de notificación. Los datos desconocidos quedan vacíos y se muestran como «Sin registrar».

La migración `202610130006_carburacion_fichas_clientes.sql` agrega estos campos, control de versiones e historial de cambios. Autoriza la edición a la cuenta individual de Fernández Mora Emily Camila que tenga asignado Carburación; no autoriza la cuenta compartida de Taller. Administradores con Carburación activo también pueden editar. Los demás usuarios del departamento pueden consultar las fichas.

Crear y editar conserva los identificadores de clientes y sus asociaciones existentes. Las órdenes históricas mantienen los nombres guardados; al editar una orden se presenta el nombre actual del catálogo. La importación reconoce también la fila original del archivo para evitar duplicar clientes renombrados.

Validación: `npm test` y `$env:CARBURACION_DB_TEST='1'; node --test tests/carburacionClienteFicha.db.js`. La prueba de base de datos usa tablas temporales aisladas, comprueba creación, edición, historial, duplicados, cambios simultáneos y permisos HTTP.

