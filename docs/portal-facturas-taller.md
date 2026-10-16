# Pendientes de Taller dentro del portal

El portal consulta directamente las facturas pendientes de Taller de los 14 proveedores solicitados. No crea copias contables ni documentos fiscales, no genera XML/PDF y no modifica pagos, abonos, notas de crédito o estados de Hacienda.

Se incluyen órdenes marcadas como facturadas y facturas independientes, siempre que no estén pagadas y conserven saldo positivo. Se excluyen órdenes enlazadas a una factura del portal vigente y claves ya registradas en el portal. Cuando se registra un pago en Taller, el siguiente acceso al portal muestra el saldo actualizado y las facturas totalmente pagadas desaparecen de pendientes.

La sección tiene resumen de saldos en CRC y USD y filtros por proveedor, empresa de la OC y número de factura u orden. Las independientes sin empresa documentada aparecen como «Por confirmar»; no se les atribuye una empresa por defecto. La información de la OC no equivale a verificación fiscal del receptor. Los archivos históricos se conservan en su registro de origen y las nuevas facturas siguen requiriendo XML y PDF.

Contabilidad y Administración consultan `/proveeduria/portal-proveedores/facturas-taller` mediante la bandeja del portal. El proveedor consulta `/portal-proveedores/taller/facturas` desde su sesión y solo recibe documentos cuya cédula fiscal registrada en Taller coincide exactamente con su cuenta. Sin cédula no se devuelve información. No se exponen enlaces internos en la respuesta externa. Para proveedores sin acceso o sin cédula en Taller, Administración debe completar esos datos antes de que puedan ver sus pendientes externos.

Selección confirmada:

| Nombre usado | Registro de Taller |
| --- | --- |
| JM REPUESTOS | Repuestos y Servicios Técnicos JM |
| PURDY | Purdy Motor S A |
| MP RADIADORES | JOSE GUILLERMO CAMPOS PRADO |
| TURBOS CARTAGO | Reconstruccion de Turbos Cartago S.R.L |
| JSM | JSM Unity Costa Rica S.A |
| JF | JF INDUSTRIAL S.A |
| MORA | INVERSIONES AUTOMOTRICES MORA SEQUEIRA S.A |
| PINTURAS ALEX | Alexander Inces Alfaro |
| DAITOMO | Daitoma Costa Rica S.A |
| EURO EMBRAGUES | EURO EMBRAGUES Y MAS LTDA |
| 2001 | COORPORACIÓN 2001 |
| ORTEGA Y ROJAS | Transportes Ortega y Rojas |
| H G C | Recontructora y Accesorios H G C S.A |
| COMPUTRANS | COMPUTRANS |

Revisión del 16/10/2026: 311 facturas pendientes, saldo CRC 38.949.648,70, saldo USD 0. Para 2001 no se encontraron pendientes. Estos valores son una instantánea; la consulta del portal es dinámica.
