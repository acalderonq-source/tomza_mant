# Taller V1: evolucion a ERP interno

## Entregado

- Interfaz de escritorio con menu lateral por areas desplegables, sin cambiar TV ni movil.
- Busqueda de aplicaciones y estilos consistentes en dashboard y mantenimientos.
- Panel de seguimiento en el detalle de ordenes de Taller: recepcion confirmada,
  factura registrada, estado de pago y asientos relacionados.
- Colillas vinculadas por tipo e identificador de factura; descarga del documento existente.
- En pagos multiples se muestra exclusivamente el monto aplicado a esta orden.
- Finanzas del seguimiento visibles solo para ADMIN, TALLER, PROVEEDURIA_TALLER
  y CONTABILIDAD. Bodeguero y mensajeria no consultan estas tablas.
- Consultas fallidas se muestran como no disponibles, nunca como ausencia de registros.

## Limites de esta entrega

No se modifican documentos, saldos, pagos, permisos ni asientos historicos.
El seguimiento consulta hasta 100 colillas recientes de la orden y 20 asientos.
No reconstruye colillas antiguas sin tipo e identificador de factura.
Los documentos del portal conservan su apartado independiente existente.
Los estados de pago reflejan los datos registrados; no equivalen a una conciliacion bancaria.

## Trabajo pendiente para cerrar Taller V1

1. Conciliar total gastado, pagado y pendiente con movimientos por fecha de pago,
   abonos, notas de credito y monedas. Validar tambien filtros de sede y cierre.
2. Inventariar duplicados de proveedores y productos; presentar propuesta de
   unificacion sin fusionar ni eliminar registros financieros automaticamente.
3. Normalizar relacion de solicitud, orden, recepcion, factura y pago en tablas
   relacionales, conservando referencias a documentos historicos.
4. Aprobaciones por importe, responsable y departamento, con auditoria transaccional.
5. Trazabilidad completa por unidad: mantenimiento, repuestos, bodega y costos.
6. Pruebas integrales por perfil, respaldos y restauracion comprobada antes de V2.

No es una implementacion de SAP ni una reproduccion de su codigo o marca.
