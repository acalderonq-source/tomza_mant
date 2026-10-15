# Portal de proveedores: seguimiento y revisión

## Proveedor

En `/portal-proveedores` puede consultar sus órdenes de Proveeduría y Taller / Compras, elegir una al presentar el XML y PDF o conservar la búsqueda automática. La selección es opcional. La consulta se limita a su identidad fiscal; una orden antigua sin cédula solo se muestra si corresponde exactamente a un proveedor registrado con una única cédula en sus cuentas. Se muestran hasta 200 órdenes por módulo.

Al seleccionar XML se verifican emisor, receptor autorizado y duplicados; si se elige OC, también se muestran diferencias con su detalle. La carga definitiva vuelve a validar y bloquea la orden dentro de una transacción. Una vista previa nunca equivale a aceptación fiscal ni a aprobación de pago.

Cada factura muestra próximo paso, responsable, plazo, observaciones, programación, saldo y comprobantes de pago. Una devolución admite respuesta del proveedor y regresa a revisión. Se conservan el XML y PDF originales, motivo y conversación. Los cambios fiscales requieren nota de crédito y nuevo comprobante; responder no altera importes, no aprueba ni registra pagos.

## Contabilidad y Administración

Bandeja: `/proveeduria/portal-proveedores/facturas`. Panel del propietario: `/administracion/portal-proveedores/seguimiento`, también accesible desde la administración del portal.

Las facturas vencidas y los plazos vencidos aparecen primero. Hay filtros por responsable, excepciones, vencidas, revisión atrasada, sin OC, correcciones y estados de pago. El resumen muestra cuentas por pagar en CRC y USD, vencimientos a siete días y carga de trabajo por responsable, sin mezclar documentos sin aprobación con cuentas por pagar aprobadas.

Se puede asignar un usuario autorizado y fecha límite, escribir comentarios visibles para el proveedor, devolver con motivo, aprobar, programar y registrar pagos mediante los controles existentes. Las nuevas facturas tienen un plazo inicial de revisión de tres días calendario; al responder una devolución empieza un nuevo plazo de tres días. Las fechas operativas usan Costa Rica. No se envían correos nuevos automáticamente: las alertas están dentro de la bandeja.

Se valida empresa receptora de la OC cuando contiene razón social o empresa reconocida, además de proveedor, moneda, artículos, precios, impuestos y límites de monto. Para aprobar y pagar continúa siendo necesaria la aceptación de Hacienda en producción y superar los controles de OC. No se exige recepción de entregas ni cantidades recibidas.

Los cambios usan el JSON y auditoría existentes; no requieren migración ni modificación de facturas históricas. Facturas antiguas sin responsable o plazo se muestran como sin asignar y permiten asignación manual.
