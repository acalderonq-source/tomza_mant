# Control ARESEP

Las dos plantillas fueron entregadas por el usuario el 23/09/2026:

- `a7.xlsx`: A7_Unidades Transporte.xlsx.
- `costos.xlsx`: Costos distribucion Datos iniciales (002).xlsx.

Se conservan como fuentes de formato, encabezados y catalogos. No constituyen
validacion de requisitos regulatorios vigentes. El modulo no envia reportes a ARESEP.

El control es mensual. Las fichas A7 pueden incorporar las unidades activas del
sistema sin modificar sus datos maestros. Potencia, codigo CR, activo, medidor y
otros campos no presentes quedan pendientes. No se infiere el tipo de transporte
a partir de una sede ni se realizan conversiones de libras a litros.

Los datos se guardan en `aresep_registros` (JSON validado mediante el esquema de
campos) y cada version en `aresep_historial`, dentro de la misma transaccion. Hay
una clave unica por mes y ficha/unidad-ruta/persona/producto-fecha-ruta. Los cambios
con version obsoleta se rechazan. No se modifican compras, inventario ni planillas
externas. El acceso es ADMIN, CONTABILIDAD y TRAMITES; planilla solo para los dos
primeros, incluyendo exportaciones y consulta directa por ID.

La exportacion mantiene las hojas y columnas originales, salvo que elimina
Planilla para TRAMITES y agrega una hoja Control con pendientes. Elimina ejemplos
y formulas sin datos, adapta el anio de los encabezados y usa el porcentaje CCSS
ingresado (columna M de Planilla), nunca el 10.67% fijo del ejemplo. Los totales de
litros usan el periodo exportado y no el ultimo mes como denominador. Los campos
vacios no equivalen a cero. Los archivos exportados incluyen fichas pendientes.

Pruebas: `node --test tests/aresep.test.js`. La prueba visual usa Playwright en
`tests/aresep.browser.js`. Ambas sustituyen la base de datos; nunca insertan datos
de prueba en la base del entorno.
