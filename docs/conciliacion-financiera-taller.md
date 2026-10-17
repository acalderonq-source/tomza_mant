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

## Pendiente antes de sustituir todos los indicadores

1. Normalizar aplicaciones de pago en tabla relacional con moneda y referencia estable.
2. Reconciliar historicos con colillas, abonos y estados de cuenta sin duplicarlos.
3. Aplicar mismo criterio de fechas, sede, cierre y moneda al reporte completo.
4. Conectar notas de credito, anulaciones y reversos con trazabilidad.
5. Aprobar el resultado contra comprobantes y contabilidad, antes de cerrar periodos.
