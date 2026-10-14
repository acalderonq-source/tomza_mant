# Prueba del portal de proveedores

Acceso interno: **Contabilidad → Facturas de proveedores** (`/proveeduria/portal-proveedores/facturas`). Acceso externo: `/portal-proveedores`.

1. Cree una OC con el proveedor, moneda, códigos comerciales, cantidades, precios e IVA correctos. El código del XML debe identificar un único artículo de la OC.
2. Desde la cuenta del proveedor, suba el XML y PDF. Si existe una sola OC compatible, el sistema la enlaza. Si hay varias, Contabilidad o Proveeduría selecciona la correcta. Las claves electrónicas duplicadas se rechazan al cargar.
3. En Contabilidad, abra **Excepciones** y **Detalle de artículos y recepción**. Se comparan cantidades acumuladas, precio unitario, descuento por unidad e IVA; no basta con que el total coincida.
4. Espere la aceptación de Hacienda por Outlook o API. Después puede aprobar la cuenta por pagar si no hay diferencias. La aceptación fiscal y la aprobación interna son estados independientes.
5. Registre la entrega real. En Proveeduría se usa la recepción de la OC. Para Taller / Compras, el usuario de Proveeduría o administrador puede confirmar cantidades en el detalle de la bandeja. Una recepción total ya existente también se reconoce. No se puede pagar ni programar cantidades aún no recibidas.
6. Pruebe dos facturas parciales de la misma OC. La suma de cantidades y montos no puede superar lo ordenado. La recepción disponible considera las otras facturas con pagos o programación, para no usar la misma entrega dos veces.
7. Use **Programar pago** y compruebe que el proveedor ve la fecha. Programar no reduce el saldo ni transfiere dinero. **Registrar pago** requiere referencia, fecha y comprobante; actualiza el saldo y conserva el historial.
8. Suba una nota de crédito XML y PDF desde la factura original. Debe tener el mismo emisor, receptor y moneda y referenciar una única factura original. Se verifica Hacienda automáticamente. Contabilidad usa **Aplicar al saldo** cuando esté aceptada en producción. Se impide aplicarla dos veces o dejar saldo negativo. Los créditos que exceden el saldo requieren revisar devolución de fondos fuera de este flujo.

Las facturas anteriores recuperan su detalle desde el XML privado guardado. Si falta detalle verificable, no se autoriza el pago. Transporte, otros cargos, exoneraciones e impuestos especiales quedan como excepciones; este cambio no autoriza diferencias fiscales automáticamente. Las notas de crédito no reabren cantidades de una OC para facturar nuevamente.

Use órdenes y facturas de prueba en un entorno de pruebas. No marque entregas ni pagos reales solo para desbloquear una factura. La factura existente sin OC compatible permanece en excepciones.

## Despliegue

La nueva tabla de recepción se crea con `npm run migrate` mediante `202610140010_portal_recepciones_compras.sql`. El arranque de Render ya ejecuta las migraciones. Outlook en producción requiere sus variables de entorno y el callback de producción registrado en Microsoft Entra; una conexión local no confirma que producción esté conectada.
