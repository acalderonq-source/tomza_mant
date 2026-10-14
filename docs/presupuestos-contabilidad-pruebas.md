# Presupuestos y ejecución mensual: primera etapa

## Dónde entrar

En el inicio de Contabilidad, abra **Presupuestos**. Ruta: `/contabilidad/presupuestos`.

Acceso para los roles CONTABILIDAD y ADMIN. No requiere cambiar el área activa a Taller.

## Qué está disponible

- Presupuesto mensual por empresa, sede, departamento, rubro y moneda (CRC o USD).
- Registro y ajustes con versión, usuario e historial. Una edición antigua no puede sobrescribir otra más reciente.
- Copia desde otro mes: conserva las partidas ya existentes en el destino.
- Clasificación de documentos completos, conservada para sus facturas y pagos relacionados.
- Comparación por rubro: presupuesto, ordenado, por facturar, facturado, pagado y disponible.
- Listado con paginación de 50 documentos. Los totales utilizan todos los documentos del filtro.
- Vista previa e importación de los ocho presupuestos individuales del ZIP FLUJOS.
- Exportación CSV para Excel con resumen y documentos del filtro.

## Primera prueba: presupuesto manual

1. Abra Presupuestos con un usuario de Contabilidad.
2. Seleccione un mes de prueba y CRC. Puede elegir una sede específica.
3. Abra **Registrar o ajustar presupuesto**.
4. Indique una empresa, una sede, departamento Taller, rubro Mantenimiento y monto `100000`.
5. Escriba una observación que identifique que es una prueba y guarde.
6. Verifique que Mantenimiento muestre el presupuesto de ₡100.000.
7. Abra **Partidas registradas del mes**, cambie el monto a `120000` y guarde.
8. Verifique el nuevo monto y el registro del cambio en **Historial de cambios recientes**.

Los registros de esta prueba son reales. Si no corresponden al presupuesto definitivo, ajuste el monto a cero y deje una observación; el historial se conserva.

## Segunda prueba: comparación con documentos

1. Consulte un mes con órdenes o facturas existentes. Quite los filtros de sede y departamento para encontrar los documentos sin clasificar.
2. Busque un documento conocido en **Documentos del mes**. Use Siguiente para avanzar entre páginas.
3. Abra **Clasificar documento** y asigne empresa, sede, departamento, moneda y rubro.
4. Guarde y compruebe que el importe aparezca en la fila del rubro.
5. Una orden sin factura debe aparecer como ordenada y por facturar.
6. Si esa orden ya fue facturada al cierre del mes, aparece como facturada y libera el compromiso. No se suma como dos gastos.
7. Si tiene un pago en el mes, ese pago aparece en su propia columna. No se resta otra vez del presupuesto.
8. Cambie de mes y compruebe que los pagos se presentan según su fecha, aunque la factura sea del mes anterior.

La clasificación cambia únicamente la asignación presupuestaria. No modifica los importes, facturas ni pagos originales.

## Tercera prueba: importar un presupuesto del ZIP

1. Extraiga FLUJOS.zip en Windows.
2. Abra **Importar presupuesto de Excel**.
3. Seleccione explícitamente el mes, la empresa, la sede y el departamento correctos. Los nombres de los archivos no siempre coinciden con el período interno.
4. Cargue uno de los presupuestos individuales, por ejemplo el de Gas Tomza.
5. Presione **Preparar vista previa**. Todavía no se guardan partidas.
6. Revise conceptos, rubros, total leído y total de control.
7. Use **Cancelar vista previa** si solo está verificando. Para importar, confirme únicamente cuando el contexto sea correcto.
8. Verifique las partidas registradas y el historial después de confirmar.

El importador lee la columna D en colones de la hoja Ordinarios. Excluye subtotales y controla que la suma coincida con el gran total de la hoja, con tolerancia de ₡1 por redondeo. Los ocho presupuestos individuales proporcionados pasaron este control; la mayor diferencia fue ₡0,01.

Se utilizan valores guardados en Excel: no se recalculan fórmulas ni se consultan sus vínculos externos. Se bloquea la confirmación si hay resultados ausentes, errores de fórmula o diferencias en el total. No se sobrescriben partidas existentes: elija un contexto nuevo o ajuste las partidas desde el formulario.

El consolidado y el libro Costa Rica no se importan por esta opción. Sus resúmenes contienen información que también aparece en los presupuestos individuales y requiere un proceso distinto para evitar duplicados. Tamaño máximo por archivo: 5 MB.

## Cuarta prueba: copia y exportación

1. Seleccione otro mes de destino.
2. Abra **Copiar presupuesto de otro mes**, indique el mes de origen y copie.
3. Compruebe que se copiaron las partidas de la empresa, moneda, sede y departamento filtrados.
4. Repita la copia: no debe reemplazar las partidas existentes.
5. Presione **Exportar CSV para Excel** y compruebe el período, moneda y los totales contra la pantalla.

## Reglas de cálculo y alcance

- Disponible = presupuesto − facturado del mes − órdenes del mes pendientes de factura al cierre.
- Una orden facturada en un mes posterior conserva su compromiso en el mes de la orden.
- Las órdenes en borrador, anuladas o canceladas de Taller se excluyen.
- Las facturas se asignan por fecha de emisión; cuando corresponde, se identifica el uso de la fecha de recepción. Las facturas sin fecha no se asignan silenciosamente a otro período.
- Los pagos se asignan por fecha de pago. Las colillas tienen prioridad frente a los campos antiguos de abonos para evitar contarlos dos veces.
- Las notas de crédito de Taller reducen los importes de la factura/orden original. No existe todavía una vista mensual separada de notas de crédito por fecha de emisión.
- CRC y USD se consultan por separado. No hay conversión automática ni tipo de cambio en esta etapa.
- Las facturas antiguas de Taller sin campo moneda necesitan confirmación al clasificarse.
- Los documentos sin clasificación no se incluyen en los totales; la pantalla indica cuántos quedan pendientes. Los totales iniciales pueden ser cero aunque haya documentos.
- Si una clave electrónica está repetida entre fuentes, los documentos quedan pendientes de conciliación. Esta comprobación no detecta duplicados sin clave electrónica.
- La disponibilidad es una comparación mensual; todavía no representa saldo bancario ni un flujo acumulado de compromisos de meses anteriores.
- Se clasifica el documento completo. El reparto por líneas, porcentajes o varios centros de costo queda pendiente.

Fuentes incluidas: órdenes y facturas de Taller, documentos de Proveeduría y portal de proveedores, órdenes y facturas de Carburación y sus pagos asociados. No se incluyen todavía caja chica, órdenes de motor ni los registros separados de pagos a proveedores, que deben conciliarse con las fuentes incluidas.

El presupuesto anterior del resumen ejecutivo de Taller se conserva: no se migró automáticamente porque es un total mensual sin reparto por sede ni rubro.

## Etapas siguientes

1. Equivalencias entre sedes, asignación por líneas y aprobación del presupuesto.
2. Conciliación e incorporación de las fuentes restantes, notas de crédito por fecha y cierres mensuales.
3. Flujo de caja: saldos iniciales, cobros, pagos previstos y calendario diario/semanal/mensual.
4. Obligaciones recurrentes, préstamos, provisiones e inversiones, con consolidado del país.

## Instalación y comprobación técnica

Se agregó la migración `202610140005_presupuestos_contabilidad.sql`, con tres tablas nuevas: presupuestos, clasificaciones e historial. Se preparan de forma aditiva en el primer acceso autorizado al módulo. En la primera etapa no se importaron presupuestos. Posteriormente se realizó la carga autorizada de septiembre de 2026 descrita abajo, sin modificar órdenes, facturas ni pagos existentes.

Se agregó JSZip como dependencia directa para leer los valores guardados del Excel, incluidos resultados de fórmula iguales a cero.

Pruebas: `node --test tests/presupuestosContabilidad.test.js tests/presupuestosRoutes.test.js tests/departamentos.test.js`. La suite completa se ejecuta con `npm test`.

## Consulta por empresa

- El filtro **Empresa** permite ver todas las empresas consolidadas, una empresa específica o los registros sin empresa asignada.
- **Resumen por empresa** compara presupuesto, facturado, pagado, disponible y documentos pendientes. Pulse el nombre de una empresa para filtrar el detalle.
- Empresa se conserva al guardar, copiar, importar, paginar y exportar. Puede registrar partidas con la misma sede, departamento, rubro y mes para empresas diferentes.
- Se reconocen las razones sociales equivalentes de Gas Tomza, Super Gas y Transportadora de Cataluña. Los formularios permiten escribir otras empresas, además de las sugeridas; aparecerán en el selector cuando se guarden.
- Las órdenes aportan su empresa destinataria y el portal aporta la razón social del receptor. Las facturas antiguas sin esa información requieren asignación explícita.
- Granel no se considera automáticamente una razón social. Debe confirmarse la empresa destinataria cuando el origen solo identifica ese negocio.
- Las partidas creadas antes de incorporar Empresa conservan su importe e historial. Abra **Sin empresa asignada**, entre a **Partidas registradas del mes**, indique la empresa y guarde el ajuste. No se asignaron automáticamente a Gas Tomza.
- El importador valida la empresa del encabezado cuando puede reconocerla. No permite importar, por ejemplo, un presupuesto identificado como Super Gas bajo Gas Tomza.
- La exportación incluye el filtro de empresa y la empresa de cada documento.

Prueba de separación: registre en el mismo mes y sede una partida de mantenimiento de ₡100.000 para Gas Tomza y otra de ₡200.000 para Super Gas. El resumen consolidado debe indicar ₡300.000 y cada filtro de empresa debe mostrar únicamente su partida.

## Septiembre de 2026: carga de todos los datos

Se cargaron los ocho presupuestos individuales de FLUJOS.zip para `2026-09`. Los ocho archivos indican septiembre de 2026 en su hoja principal, aunque algunos nombres todavía mencionan julio de 2025.

| Empresa / unidad | Hojas | Partidas originales | Presupuesto CRC |
| --- | ---: | ---: | ---: |
| Gas Tomza | 8 | 45 | 275.728.611,38 |
| Super Gas | 8 | 40 | 125.209.354,33 |
| Transportadora de Cataluña | 7 | 20 | 109.678.819,17 |
| La Cruz | 8 | 34 | 86.027.388,41 |
| Cedis Zona Sur | 8 | 29 | 83.958.696,81 |
| Cedis Atlántico | 8 | 29 | 50.400.021,09 |
| Cedis San Carlos | 8 | 29 | 22.591.093,43 |
| Administrativo | 4 | 19 | 76.205.137,63 |
| Total | 59 | 245 | 829.799.122,25 |

Para ver la carga, consulte septiembre de 2026, moneda CRC, sede Todas y departamento Todos. Se registró como sede **General de la empresa** y departamento **General de la empresa**: los archivos describen presupuestos de cada empresa/unidad y no un reparto completo por departamentos del sistema.

En **Datos de los Excel**, use **Ver todas las hojas**. Se conservan las hojas principales, Ordinarios, ingresos, planilla, servicios, gastos generales, mantenimiento, tiendas, fletes y las hojas ocultas que contiene cada archivo. Cada hoja tiene todas sus filas con datos, columnas, valores guardados, fórmulas y errores originales. Hay paginación y descarga del Excel original.

Los presupuestos se forman exclusivamente desde las partidas de Ordinarios que cuadran con su total de control. Las otras hojas aportan el detalle; no se vuelven a sumar. La diferencia máxima contra el total de control fue de ₡0,01 por redondeo de las partidas a céntimos.

Los libros conservan 359 celdas con errores en otras hojas, principalmente referencias rotas y divisiones por cero. Se muestran en su contexto y no se sustituyen por cero. No se siguieron ni recalcularon los vínculos externos. Las proyecciones del Excel no se registraron como ventas, facturas o pagos reales.

El consolidado y el archivo Costa Rica del ZIP no se sumaron de nuevo a estos presupuestos: esta carga corresponde a los ocho archivos señalados por el usuario.

La carga usa una transacción e identifica cada original por SHA-256. Repetir el mismo archivo y período no duplica su presupuesto. Las partidas existentes no se sobrescriben. El historial identifica la operación como **IMPORTACION_EXCEL_COMPLETO**, realizada por el sistema a solicitud del usuario.

Para preparar otra carga compatible, el comando `node src/scripts/cargarFlujosCompletos.js RUTA_DEL_ZIP --periodo=AAAA-MM` muestra primero una revisión sin escribir. La opción `--aplicar` ejecuta la carga validada. El período interno debe coincidir con el período solicitado.

## Control propio de Planilla

En **Ejecución por rubro**, pulse **Planilla**. También los enlaces Planilla de la lista de hojas abren el control del sistema. Ya no se necesita trabajar sobre las celdas del archivo para llevar la planilla.

El control contiene las personas y conceptos identificados en las ocho hojas salariales, con empresa, grupo, puesto y salario de referencia. Permite buscar, paginar, agregar personas y corregir nombres, puestos y referencias. Las referencias se conservan separadas del presupuesto general del rubro.

Prueba:

1. Consulte septiembre de 2026 y elija una empresa.
2. Pulse **Registrar gasto real** en una fila.
3. Ingrese fecha del gasto, salario real, extras, rebajos y observación. La fecha del gasto debe pertenecer al mes de esa planilla.
4. Guarde. El control calcula bruto = salario + extras y neto = bruto − rebajos.
5. Registre un pago con fecha, referencia y monto. El saldo es neto − pagos acumulados. Se admiten pagos parciales y fechas de pago de meses posteriores.
6. Vuelva al presupuesto: el gasto bruto aparece automáticamente en Planilla. Los pagos aparecen por su fecha, sin volver a sumar el gasto.
7. Revise el historial de cambios en Contabilidad. Un gasto real puede corregirse con control de versión, siempre que el neto no sea menor que lo ya pagado.

Las referencias importadas **no son gastos ni pagos confirmados**. Las columnas reales empiezan vacías. La hoja salarial de Gas Tomza conserva AGOSTO 2026 y la de Super Gas tiene un error en su cabecera de período; el control expone esas referencias para revisión y no las convierte automáticamente en gastos de septiembre.

Los rebajos se registran como un importe confirmado; no se aplican tasas legales automáticamente. Este es un control de importes presupuestados, gastados y pagados, con trazabilidad por persona y mes.

Los otros documentos ya clasificados como Planilla se muestran en una sección separada y se consideran en el disponible. El control de personas muestra sus propios salarios y pagos. Un pago de octubre asociado a la planilla de septiembre se ve en esa planilla, mientras que en la comparación mensual de pagos se contabiliza en octubre.

La carga de referencias es idempotente: abrir otra vez la pantalla no duplica las filas ni reemplaza las correcciones hechas en el sistema. No se modificaron los originales ni se registraron gastos reales durante la carga de las referencias.

## Controles propios de los otros nueve rubros

En **Ejecución por rubro**, cada nombre abre su control: Servicios y alquileres, Gastos generales, Combustible, Mantenimiento, Impuestos, Extraordinarios, Inversiones, Préstamos y Provisiones. Los enlaces de las hojas Servicios, Gastos Generales y Mantenimientos también abren estos controles.

Para septiembre de 2026 hay 478 conceptos de referencia de los ocho archivos. Se conservan separados por empresa y moneda. Las referencias no generan gastos ni pagos y su edición no cambia el presupuesto aprobado del rubro. Provisiones no contiene conceptos de origen identificables; permite agregarlos directamente.

Prueba de uso:

1. Consulte septiembre de 2026, seleccione una empresa y pulse el rubro.
2. Revise sus conceptos; puede editar una referencia o usar **Agregar concepto**.
3. Registre el importe real, fecha del mes, proveedor, documento, vencimiento y observación cuando corresponda. El formulario comienza sin importe real.
4. Guarde y registre un pago parcial con fecha, referencia e importe. El saldo disminuye y el historial conserva el pago. No se admite pagar más del saldo ni reducir el registro por debajo de lo pagado.
5. Vuelva al presupuesto: el importe registrado aparece automáticamente en su rubro. Las facturas y otros documentos clasificados se incluyen por separado, sin volver a sumar este registro.
6. Cambie de empresa para comprobar la separación. Un pago de octubre para un concepto de septiembre se muestra en el control de septiembre y en los pagos mensuales de octubre.

Inversiones identifica el importe como inversión; Préstamos como cuota u obligación; Provisiones como reserva. El resumen utiliza **Ejecutado / facturado** para incluir estos movimientos sin presentarlos todos como gastos. Los formularios están restringidos a Administración y Contabilidad; las modificaciones y pagos quedan auditados y las ediciones detectan cambios simultáneos.

En Servicios de Gas Tomza, el detalle original suma ₡196.000 menos que el presupuesto del rubro. La pantalla señala la diferencia y conserva ambos valores: no inventa un ajuste ni modifica el presupuesto. Los errores y valores ausentes del origen quedan sin importe de referencia.

Validación de esta incorporación: `npm test`, 344 pruebas aprobadas. Se verificaron los nueve controles con la base local, la navegación desde Presupuestos y la presentación en escritorio y móvil.


## Dashboard ejecutivo de presupuesto

En Contabilidad, abra **Resumen ejecutivo**. Inicia en el último mes con presupuesto. Permite filtrar mes, empresa, sede, departamento y moneda; presenta presupuesto, ejecución, compromisos por facturar, pagos por fecha y disponible. Incluye comparaciones por empresa y rubro, evolución de seis meses y enlaces a los controles. Los avisos señalan documentos excluidos o sin clasificación, importes sin presupuesto, sobreejecución y utilización de al menos 90 % incluyendo compromisos. Los meses sin datos muestran cero y no acreditan una carga completa.

Pruebe septiembre de 2026 en CRC: el presupuesto consolidado debe ser ₡829.799.122,25. Filtre Gas Tomza: debe ser ₡275.728.611,38. La ejecución incluye solamente documentos correctamente clasificados e importes reales confirmados; no las referencias importadas. La exportación respeta los mismos filtros.
