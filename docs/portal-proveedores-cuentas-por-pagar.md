# Portal de proveedores y cuentas por pagar

Para el portal con correo y contraseña y facturas independientes de OC, consulte [Portal con cuentas de proveedores](portal-proveedores-cuentas.md). Este documento describe el flujo anterior por orden de compra, que sigue disponible.

El portal existente funciona con un enlace privado por orden de compra de Proveeduría, con vencimiento y revocación al regenerarlo. No crea usuarios externos ni permite consultar órdenes ajenas. El envío del correo se conserva como una acción explícita del usuario.

1. Proveeduría envía la OC desde su detalle; el correo incluye el acceso al portal.
2. El proveedor adjunta XML y PDF o imagen. El XML completa consecutivo, proveedor, moneda y total; las líneas se revisan contra la OC.
3. El servidor consulta Hacienda. Un error de conexión, credenciales faltantes, rechazo o estado de procesamiento no habilitan la aprobación. El proveedor no puede declarar el estado Hacienda.
4. Proveeduría acepta la factura coincidente con la OC y confirmada en producción.
5. Contabilidad concilia la factura desde el detalle; se reconoce como cuenta por pagar. La pantalla `/proveeduria/cuentas-por-pagar` muestra también las facturas pendientes de revisión, sin sumarlas al saldo aprobado.
6. Contabilidad registra pagos parciales con comprobante. El saldo se calcula desde los pagos registrados y se impiden pagos superiores al saldo. El proveedor consulta sus comprobantes desde el mismo enlace.

## Configuración

Aplicar `migrations/202610140002_proveedores_facturas_claves.sql` con el mecanismo de migraciones. La tabla reserva claves electrónicas para evitar cargar una misma factura en distintas OC, incluso con envíos simultáneos.

Variables del servidor (nunca en JavaScript público):

```
HACIENDA_USUARIO=usuario_de_la_api
HACIENDA_PASSWORD=clave_de_la_api
HACIENDA_AMBIENTE=produccion
```

`HACIENDA_AMBIENTE=sandbox` permite consultar pruebas, pero no habilita cuentas por pagar. Sin credenciales, las cargas se conservan pendientes. La acción «Consultar Hacienda» permite reintentar desde el detalle sin volver a subir la factura. El servidor reconsulta automáticamente hasta 20 facturas pendientes cada cinco minutos mientras está en ejecución y tiene credenciales configuradas.

El vencimiento se calcula desde la fecha de emisión del XML y el plazo de crédito de la OC. Los saldos CRC y USD se presentan por separado. Las facturas anteriores sin XML deben devolverse para que el proveedor lo adjunte antes de aprobarlas o registrar nuevos pagos.

La consulta usa OAuth y `GET /recepcion/{clave}`. La aceptación exige que la respuesta oficial corresponda a la clave, cédulas y total cargados. No envía comprobantes, mensajes de aceptación del receptor ni asientos al libro mayor. Las cuentas por pagar de Proveeduría se mantienen en sus documentos, separadas de las facturas de Taller.

Documentación oficial: https://www.hacienda.go.cr/docs/ComprobantesElectronicosAPI.html

Validación: `node --test tests/proveedorHacienda.test.js tests/proveeduria.test.js`.
