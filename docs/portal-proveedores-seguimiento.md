# Portal de proveedores: seguimiento y revisión

## Proveedor

En `/portal-proveedores` solo presenta XML y PDF. No selecciona ni escribe una orden de compra. El sistema busca coincidencias entre Proveeduría y Taller / Compras; si hay varias o ninguna, la vinculación se resuelve internamente. El proveedor puede consultar la OC una vez enlazada en el historial.

Al seleccionar XML se verifican emisor, receptor autorizado y duplicados. La carga definitiva vuelve a validar. La vista previa nunca equivale a aceptación fiscal ni a aprobación de pago. Los campos de OC enviados por un cliente antiguo se ignoran; solo el cruce automático y los usuarios internos autorizados pueden vincularla.

Cada factura muestra próximo paso, responsable, plazo, observaciones, programación, saldo y comprobantes de pago. Una devolución admite respuesta del proveedor y regresa a revisión. Se conservan el XML y PDF originales, motivo y conversación. Los cambios fiscales requieren nota de crédito y nuevo comprobante; responder no altera importes, no aprueba ni registra pagos.

## Contabilidad y Administración

Bandeja: `/proveeduria/portal-proveedores/facturas`. Panel del propietario: `/administracion/portal-proveedores/seguimiento`, también accesible desde la administración del portal.

Las facturas vencidas y los plazos vencidos aparecen primero. Hay filtros por responsable, excepciones, vencidas, revisión atrasada, sin OC, correcciones y estados de pago. El resumen muestra cuentas por pagar en CRC y USD, vencimientos a siete días y carga de trabajo por responsable, sin mezclar documentos sin aprobación con cuentas por pagar aprobadas.

Se puede asignar un usuario autorizado y fecha límite, escribir comentarios visibles para el proveedor, devolver con motivo, aprobar, programar y registrar pagos mediante los controles existentes. Las nuevas facturas tienen un plazo inicial de revisión de tres días calendario; al responder una devolución empieza un nuevo plazo de tres días. Las fechas operativas usan Costa Rica. No se envían correos nuevos automáticamente: las alertas están dentro de la bandeja.

Se valida empresa receptora de la OC cuando contiene razón social o empresa reconocida, además de proveedor, moneda, artículos, precios, impuestos y límites de monto. Para aprobar y pagar continúa siendo necesaria la aceptación de Hacienda en producción y superar los controles de OC. No se exige recepción de entregas ni cantidades recibidas.

Los cambios usan el JSON y auditoría existentes; no requieren migración ni modificación de facturas históricas. Facturas antiguas sin responsable o plazo se muestran como sin asignar y permiten asignación manual.
