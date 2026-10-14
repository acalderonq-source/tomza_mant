# Revisión de Contabilidad — 14 de octubre de 2026

Se revisaron los cálculos comunes, el resumen ejecutivo, Presupuestos, el directorio de Planilla, el control salarial, los nueve controles por rubro, la clasificación, la exportación, la navegación y los permisos. Se mantuvo el estilo visual de Taller.

## Correcciones realizadas

- Una orden de Carburación con varias facturas conserva todas sus facturas. La ejecución se suma por mes de factura y los pagos mantienen su fecha. Antes, la última factura reemplazaba el importe de las anteriores.
- La parte de una orden aún no facturada permanece como compromiso del mes de la orden, incluso cuando existe facturación parcial. El disponible descuenta ejecución y compromisos, sin descontar nuevamente los pagos.
- Resumen ejecutivo, Presupuestos, Planilla y controles por rubro aplican el mismo criterio de inclusión. Un documento sin empresa, moneda, clasificación válida o con clave repetida no entra en los totales confirmados. Su motivo queda visible.
- Presupuestos permite filtrar documentos pendientes o incluidos, y por origen. Estos filtros afectan la lista, no los indicadores financieros. La exportación incorpora el motivo de exclusión.
- Presupuestos y el control salarial abren el último período disponible cuando no se indica mes. La navegación financiera conserva mes, empresa, moneda, sede y departamento. Los accesos a rubros respetan ese contexto.
- El historial de pagos de Planilla respeta empresa, sede y departamento.
- El directorio de Planilla tiene páginas de 50 filas e indicadores de empresas, registros y salarios pendientes. Los salarios confirmados en cero se distinguen de los importes ausentes.
- Los formularios de clasificación se abren en ventana, como los otros controles. La edición identifica la persona o concepto para evitar confundir filas.
- Se mejoraron los mensajes de referencias duplicadas, concurrencia y filtros inválidos. El directorio muestra errores dentro de la interfaz de Contabilidad.
- Los menús de rubros se cierran al salir o presionar Escape. Se conservan los ajustes de móvil y la navegación horizontal de Taller.

## Estado de los datos verificado

En septiembre de 2026, moneda CRC, el presupuesto consolidado conserva **₡829.799.122,25**. El directorio contiene **572 personas y conceptos salariales** de ocho empresas/unidades; no todos son empleados individuales.

El resumen consulta **889 documentos** del período: **888 sin clasificación** y **uno excluido por clave electrónica repetida**. Esta revisión no asigna rubros o empresas por suposición y no registra proyecciones del Excel como gastos reales. Tampoco modifica los importes presupuestados ni crea pagos de prueba.

El consolidado sigue limitado a las fuentes incorporadas: documentos y pagos relacionados de Taller, Proveeduría/portal, Carburación, Planilla y controles nativos por rubro. Caja chica, órdenes de motor y otros pagos independientes requieren integración y conciliación específica.

## Cómo probar

1. Recargue con Ctrl + F5 y entre a Contabilidad → Resumen ejecutivo. Consulte septiembre de 2026 en CRC y compare el total consolidado.
2. Seleccione Gas Tomza y abra Planilla o Servicios. Debe ver solamente esa empresa. Al navegar desde el menú hacia Presupuestos o Planilla se conservan el mes y la empresa.
3. En Presupuestos → Documentos del mes, seleccione **Pendientes / excluidos** y un origen. Revise el motivo de cada fila. Abra **Clasificar documento**: la ventana identifica el documento. Para incluirlo, confirme empresa, sede, departamento, moneda y rubro con información real.
4. Exporte el resumen: incluye el estado y motivo de exclusión de los documentos del período. El filtro de estado/origen solo cambia la lista en pantalla; la exportación general conserva todas las operaciones de los filtros financieros.
5. En Planilla, use Siguiente, búsqueda y empresa. El total representa toda la selección; la tabla muestra hasta 50 filas por página. Ver / editar abre el control de la persona y su moneda.
6. En el control salarial, filtre sede y departamento y revise Pagos registrados. Debe mostrar únicamente los pagos de esa selección.
7. En los controles nativos, registrar un importe confirmado actualiza la ejecución; registrar un pago parcial reduce el saldo. Los gastos y pagos se auditan. No use importes de prueba en datos reales.

## Validación

- `npm test`: **353 pruebas aprobadas, cero fallos**.
- Casos específicos: múltiples facturas en diferentes meses, facturación parcial, pagos en otro mes, documentos excluidos, contexto de navegación, paginación, salarios cero y separación de pagos por sede/departamento.
- Revisión con la base local: los nueve módulos, dashboard, filtros por empresa, clasificación en ventana, directorio, páginas siguientes y acceso denegado a roles ajenos.
- Revisión visual en escritorio y móvil; sin desbordamiento horizontal de la página en la consulta de Planilla.

Los cambios están en el código local. No se realizó publicación, commit ni despliegue remoto durante esta revisión.
