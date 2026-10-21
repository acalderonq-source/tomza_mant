# Captura general desde archivos

Acceso exclusivo del administrador: `/admin/ventas-gas/captura-general/archivos`. Este es el flujo único para completar la captura; no utiliza una conexión con el sistema externo.

Adjuntar uno o varios `.xls`, `.xlsx` o un ZIP recibido por correo. El límite por carga es 6 MB, diez archivos y treinta libros dentro del lote. El ZIP de informes puede incluir la captura general, las capturas de Gas Tomza, Super Gas y CEDIs, además de los libros de cartera. Los machotes vacíos no se contabilizan.

## Fuentes y prioridades

- **Reporte general:** reconoce las columnas de documentos, fechas, unidad de negocio, clasificación contable, forma de pago, litros, kilos, bruto, descuentos y total general. Cada fila es un documento. Conserva los ajustes negativos. Rechaza filas sin fecha, clasificación, forma de pago o importes válidos.
- **Informe diario de ventas:** reconoce el resumen contado/crédito de cada día y verifica sus totales. Completa las categorías de la captura con el mismo factor de 0,54 kilos/litro. Las hojas vacías de fechas futuras no representan ventas en cero.
- **Captura general recibida:** conserva el historial de ventas y el detalle de las filas de su plantilla. Aporta los datos financieros que ya contenga y sirve como comparación. Las fechas con todos sus volúmenes en cero se tratan como no documentadas, pues el archivo original también usa ceros para días pendientes.
- **Capturas individuales:** se guardan separadas por archivo para conservar el detalle de Gas Tomza, Super Gas, Liberia, Atlántico, Zona Sur, San Carlos y Pacífico. Cuando también existe la captura general, sus totales tienen prioridad y las capturas individuales no vuelven a sumar las ventas.
- **Cartera:** reconoce las hojas en colones y dólares de los libros general, Gas Tomza y Super Gas. Sus registros se incorporan como información complementaria del día.

Si hay resumen diario y reporte general para una fecha, los totales usan el resumen diario y se comparan con el reporte general por categoría, forma de pago, litros, kilos e importes. No se suman las dos fuentes. El detalle se obtiene del reporte general, o de la captura recibida cuando no hay documentos desglosados para esa fecha. La captura aporta el respaldo para fechas anteriores.

La clasificación contable VIP del reporte general se asigna a CAMION C.F., según la correspondencia comprobada con los archivos de referencia. Las categorías desconocidas requieren revisar el archivo de origen.

Las placas y los choferes no se deducen de nombres de cliente: se conservan los de la captura recibida. El reporte general nuevo se asigna por código de ruta, nombre exacto o CEDI, y agrega filas cuando la plantilla no tiene un destino conocido.

## Historial y duplicados

Los registros normalizados se guardan en `UPLOAD_ROOT/.captura-general/importaciones.json`. Los Excel originales se guardan por su huella SHA-256 en `UPLOAD_ROOT/.captura-general/originales`, fuera del acceso de descargas públicas. Debe incluirse todo ese directorio en los respaldos del disco persistente. Los archivos se conservan exactamente como fueron recibidos.

La clave de documento incluye fecha, unidad de negocio y número de documento. Repetir un archivo con otro nombre no duplica las ventas. Un documento o resumen cambiado se rechaza y se informa para revisión; no se sustituye silenciosamente. Las capturas contradictorias también se rechazan. Cada carga guarda actor, fecha y revisión. Las escrituras se serializan en un proceso y se publican con renombrado atómico. El almacenamiento está diseñado para una instancia de la aplicación, igual que las otras configuraciones locales del módulo.

## Exportación

**Descargar Excel originales (.zip)** entrega los mismos `.xls` o `.xlsx` recibidos. No convierte el formato ni reconstruye hojas, fórmulas, estilos, imágenes o configuración de impresión.

Cada fila de la tabla diaria ofrece **Descargar originales**. El ZIP contiene el paquete completo de Excel del mes, aunque alguna captura tenga la columna de esa fecha vacía; así ninguna hoja desaparece. **Descargar originales por día (.zip)** crea una carpeta por fecha y coloca dentro copias exactas de todos los Excel del mes.

Las fechas sin fuente quedan vacías. No se confunden las notas de crédito con descuentos comerciales. Las diferencias entre fuentes aparecen en la pantalla.

## Verificación

`node --test tests/capturaGeneralArchivos.test.js`

Las pruebas cubren ambos formatos de Excel, ZIP, conservación de ajustes negativos y meses anteriores, duplicados, conflictos, persistencia, igualdad binaria de los Excel descargados, datos faltantes, conciliación, acceso exclusivo ADMIN y ausencia de rutas para conectar o desconectar una base externa.
