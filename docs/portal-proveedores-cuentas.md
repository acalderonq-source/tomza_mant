# Portal con cuentas de proveedores

## Ingreso y primera prueba

1. En la pantalla de departamentos seleccione **Administración** e ingrese con el usuario propietario `admin`. Abra **Portal de proveedores**. La administración de accesos y empresas receptoras está reservada a esta cuenta, incluso frente a otros usuarios con rol ADMIN.
2. Registre las cédulas de las empresas de Tomza que recibirán facturas en **Empresas receptoras**. No se crean cédulas de ejemplo ni empresas ficticias.
3. En **Crear acceso de proveedor**, seleccione un proveedor del catálogo, indique su cédula como emisor, correo de ingreso, contraseña inicial y días de crédito. La misma cuenta permite cargar todas sus facturas, sin OC.
4. Comparta con el proveedor el enlace `/portal-proveedores/login` de la instalación, su correo de ingreso y contraseña inicial. No se envían correos automáticamente.
5. El proveedor ingresa y adjunta el XML original y su PDF. El servidor extrae los datos del XML; no acepta monto, identidad ni estado Hacienda declarados por el navegador.
6. Consulte **Contabilidad → Facturas recibidas del portal de proveedores**, o `/proveeduria/portal-proveedores/facturas`. La bandeja muestra los archivos, el estado real de Hacienda y la revisión interna por separado.
7. Contabilidad aprueba las facturas aceptadas en producción para reconocer cuentas por pagar, o las devuelve indicando el motivo. Registra pagos parciales con comprobante desde esa misma bandeja.

El proveedor solo puede consultar sus facturas y comprobantes. Puede cambiar su contraseña. El propietario puede deshabilitar una cuenta o restablecer la contraseña desde Administración; ambas acciones invalidan sus sesiones existentes. No hay registro público ni recuperación por correo automática. Contabilidad mantiene la bandeja de revisión y pagos; Proveeduría mantiene la consulta de facturas.

La migración `202610140004_administracion_privada.sql` fija el propietario por su ID en `administracion_propietario`. Las asignaciones normales de departamentos no otorgan este acceso. Tanto `/administracion/portal-proveedores` como los endpoints anteriores verifican el propietario del lado del servidor.

## Instalación y Hacienda

Las migraciones `202610140002_proveedores_facturas_claves.sql` y `202610140003_portal_proveedores_cuentas.sql` deben estar aplicadas. Los documentos independientes se guardan como `factura_portal` en `prov_documentos`, con archivos privados en `prov_adjuntos`, auditoría en `prov_auditoria` y claves únicas en `prov_facturas_claves` compartidas con las facturas por OC.

Configurar en el servidor `HACIENDA_USUARIO`, `HACIENDA_PASSWORD` y `HACIENDA_AMBIENTE=produccion`. Sin credenciales, los documentos se reciben pendientes y no pueden aprobarse. Las pruebas en sandbox tampoco generan cuentas por pagar aprobadas. El sistema consulta la aceptación de comprobantes ya emitidos: no emite facturas ni envía mensajes del receptor.

La consulta automática corre cada cinco minutos mientras el servidor está activo, hasta veinte facturas pendientes por ciclo; también existe consulta manual interna. Las cédulas y el total del comprobante deben coincidir con la respuesta oficial. La bandeja consolida todas las facturas independientes; la pantalla general `/proveeduria/cuentas-por-pagar` también incorpora sus saldos aprobados, separados por moneda.

El vencimiento se calcula desde la fecha de emisión y los días de crédito configurados en la cuenta al momento de cargar la factura. Una devolución interna conserva el original y su motivo; no se permite duplicar la clave ni reemplazar el documento histórico.

## Verificación

`node --test tests/portalProveedoresCuentas.test.js` cubre ingreso, sesiones, cuenta deshabilitada, aislamiento de archivos, múltiples facturas sin OC, emisor ajeno, duplicados, aprobación condicionada a Hacienda, pago parcial y prevención de sobrepagos.

## Enlace con órdenes de compra

El sistema intenta enlazar automáticamente al recibir una factura y cada cinco minutos para documentos pendientes o aprobados sin OC ni pagos. Busca en ambos módulos coincidencia de identidad del proveedor, moneda y total exacto (tolerancia de un centavo), sin facturas previas ni montos consumidos. Si hay una sola OC compatible, vuelve a validar bajo bloqueo, guarda el enlace y registra auditoría. No compara precios unitarios ni cantidades de cada renglón; el criterio monetario de este cruce es el total de la factura contra la OC. Las facturas parciales se revisan mediante el enlace explícito.

Si no hay coincidencia, hay varias OC compatibles o se alcanza el límite de candidatos, lo indica sin escoger una orden. No aprueba facturas ni registra pagos. El procesamiento periódico revisa hasta cincuenta facturas por ciclo y no modifica enlaces existentes.

Contabilidad y Proveeduría pueden enlazar una factura pendiente, o asignar su primera OC a una factura aprobada sin pagos, desde **Facturas recibidas → Enlazar orden de compra**, seleccionando Proveeduría o Taller / Compras. Se ingresa el número visible `PR-…` o el PO de Compras; en Compras también se admite `#ID` explícito. Una factura se enlaza a una OC; una OC admite varias facturas sin superar su total acumulado. No se adivina la relación por coincidencia de importe.

El servidor valida existencia, proveedor, moneda y monto acumulado con bloqueo transaccional de la OC. Si Compras tiene cédula del proveedor, debe coincidir con el emisor XML; si no tiene cédula, o se trata de Proveeduría, se compara el nombre normalizado con el catálogo o la razón social del XML. No se enlaza una OC que ya tenga una factura registrada por el flujo anterior. Las facturas devueltas internamente no consumen monto disponible. El vínculo no se cambia después de aprobar o pagar.

El proveedor ve la referencia en Mis facturas. Contabilidad ve el enlace a la OC y sus documentos; los detalles de ambas clases de OC muestran las facturas del portal enlazadas. La relación no crea una segunda cuenta por pagar ni copia la factura al flujo anterior. La migración es `202610140005_portal_facturas_ordenes.sql`.

## Respuestas de Hacienda por Outlook

La conexión Outlook sincroniza automáticamente cada cinco minutos y desde «Sincronizar ahora». Las respuestas MensajeHacienda se cruzan con documentos del portal por clave, emisor, receptor y total. Solo se actualiza Hacienda si se verifican la firma del XML completo, la identidad del Ministerio de Hacienda, el certificado contra la CA SINPE configurada y una lista de revocación vigente y firmada. No basta con el asunto, el remitente o un texto de aceptación.

Se guarda referencia al adjunto original privado, huella del firmante, SHA256 de respuesta y auditoría. La respuesta debe estar entre los adjuntos descargados de Entrada de los últimos 30 días. Los límites por sincronización se conservan. La aceptación no aprueba automáticamente la cuenta por pagar; Contabilidad mantiene esa revisión. Una falla de firma o de consulta CRL no autoriza aceptación. La conexión Outlook está reservada al propietario.
