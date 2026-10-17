# Conciliacion financiera: alcance de esta etapa

## Cambios

- Total pagado del resumen ya no considera pagadas las ordenes de motor pendientes.
- Nueva consulta `/dashboard/conciliacion-pagos` desde Resumen ejecutivo y Facturas.
- Consulta por mes de fecha_pago, independiente del periodo de cierre contable.
- Colillas `origen=actual`, detalle de aplicaciones por documento, totales separados CRC/USD.
- Las colillas que no cuadran, mezclan monedas o carecen de referencias/importe
  explicito quedan fuera de los totales y se muestran como casos por revisar.
- Acceso solo ADMIN, TALLER, PROVEEDURIA_TALLER y CONTABILIDAD en areas autorizadas.
- No se modifican pagos, estados, facturas ni saldos.

## No confundir con un total bancario completo

Esta consulta muestra pagos documentados por colillas. No incluye pagos anteriores
sin colilla, origen historico, caja chica, pagos_proveedor ni ordenes de motor.
No reemplaza la conciliacion bancaria ni calcula el saldo actual de todas las facturas.
Las monedas de OC se consultan en el documento actual; las facturas independientes
del esquema existente estan registradas en CRC. Si el documento no permite comprobar
su moneda, se marca para revisar. Cada mes admite hasta 2000 colillas, sin truncar
totales silenciosamente.

El resumen ejecutivo aun combina fuentes y criterios temporales historicos. La
correccion de motor pendiente es acotada: no cambia por si sola el criterio temporal
de motor ni reconstruye abonos historicos. La serie de presupuesto mensual requiere
su propia conciliacion para quedar alineada con un futuro libro de pagos unico.

## Validacion de solo lectura

En octubre de 2026 se consultaron 6 colillas actuales, con 121 aplicaciones y
CRC 8 084 449,36 en aplicaciones verificadas, sin alertas en ese conjunto.
Esto NO significa que ese sea el total de todo lo pagado por Taller en octubre.

## Continuacion: historicos separados

La consulta permite seleccionar `actual` o `reconstruido`; no acepta sumar ambas
fuentes. Un historico reconstruido refleja estados de la aplicacion, no evidencia
bancaria original. Se cotejan las referencias con los documentos actuales para
señalar documentos ausentes, documentos pendientes sin abonos y aplicaciones que
superan el importe neto actual. Una nota de credito posterior puede explicar una
diferencia; no se corrige ni se anula automaticamente.

Revision de solo lectura de junio a octubre de 2026:

| Mes | Colillas actuales | Historicos reconstruidos | Importe reconstruido CRC |
|---|---:|---:|---:|
| Junio | 0 | 6 | 395 047,66 |
| Julio | 0 | 595 | 117 577 474,34 |
| Agosto | 1 | 719 | 115 311 533,00 |
| Septiembre | 0 | 472 | 69 925 367,07 |
| Octubre | 6 | 7 | 6 475 762,00 |

En este conjunto no se detectaron diferencias bajo las reglas del cotejo. No es
una certificacion bancaria: los reconstruidos proceden de los mismos estados con
que se comparan. No se modificaron documentos ni pagos.

## Pendiente para conciliacion completa

1. Normalizar aplicaciones de pago en tabla relacional con moneda y referencia estable.
2. Reconciliar historicos con colillas, abonos y estados de cuenta sin duplicarlos.
3. Aplicar mismo criterio de fechas, sede, cierre y moneda al reporte completo.
4. Conectar notas de credito, anulaciones y reversos con trazabilidad.
5. Aprobar el resultado contra comprobantes y contabilidad, antes de cerrar periodos.
