# Taller V1 - alcance y criterios de liberacion

## Objetivo

La primera version del software cubre el departamento Taller de Gas Tomza. Los departamentos restantes se incorporaran en versiones posteriores. Mientras no tengan procesos habilitados, no deben mostrar datos ni modulos de Taller.

El numero `1.0.0` que aparece en `package.json` identifica la version del paquete; por si solo no significa que la V1 este aceptada o liberada.

## Alcance funcional

- Inicio, indicadores, prioridades e historial de prioridades.
- Unidades, sedes, condicion (activa, varada o comodin) y placas autorizadas.
- Mantenimientos preventivos, correctivos, agenda, reprogramacion y ejecucion.
- Acceso de mecanicos, supervisores, Pesados y administrador segun sede y rol.
- Solicitudes de repuestos, repuestos semanales y recepcion de productos.
- Bodega: inventario propio, consignaciones, compatibilidad por placa, entregas, devoluciones y movimientos.
- Aceites y rellenos con o sin placa, consumos e inventario por sede.
- Llantas, prioridades de taller, giras y oficina del taller.
- Rutas y choferes, revision de salida, lavado semanal y evidencia fotografica.
- Seguimiento de DEKRA y MINAE.
- KPIs, reportes y exportaciones propias de los procesos del taller.

## Reglas de negocio y acceso

- Cambiar de departamento no cambia la sede, y cambiar la sede no cambia el departamento.
- Las rutas operativas de Taller se bloquean fuera de Taller, incluso por URL directa. Facturas/asientos, consulta de órdenes y ARESEP se comparten con Contabilidad; compras, bodega y solicitudes autorizadas se comparten con Proveeduría, siempre sujetos al rol del módulo.
- El administrador conserva los accesos historicos completos de Taller cuando selecciona el area Taller.
- En Operaciones y en departamentos aun no habilitados no aparecen indicadores ni modulos pertenecientes a Taller.
- Las restricciones de placa, sede y rol se validan en el servidor; ocultar una tarjeta no constituye un permiso.
- Todo movimiento de inventario, mantenimiento y cambio de estado conserva responsable y fecha.
- Fechas y horas de operacion se presentan en horario de Costa Rica.
- Los formularios rechazan placas inexistentes, cantidades invalidas y transiciones de estado no permitidas.

## Criterios para liberar V1

- [ ] Cada flujo critico tiene pruebas de exito, validacion de datos y permisos permitidos/denegados.
- [ ] Las migraciones se ejecutan sobre una copia representativa y pueden repetirse sin duplicar cambios.
- [ ] Se concilian existencias antes y despues de recibir, entregar, devolver y ajustar productos.
- [ ] Se verifica en pantalla el recorrido de administrador, supervisor, mecanico, Pesados y bodeguero.
- [ ] Exportaciones y reportes coinciden con los registros filtrados por sede, fecha y placa.
- [ ] Se configura y prueba respaldo/restauracion en Railway y Render siguiendo [el runbook](RESPALDO_Y_RESTAURACION.md).
- [ ] Se ejecutan pruebas automatizadas y una prueba de humo en Render sobre el release vigente; se identifica el commit activo.
- [ ] El responsable funcional valida los flujos y se publica una nota de version con cambios y limitaciones.

## Estado de auditoria al 2026-10-02

- El sistema usa Node.js, Express, EJS y MySQL; las rutas se organizan por modulo.
- `npm test` pasa 145 pruebas automatizadas (0 fallidas) en el estado local revisado.
- El menu de ADMIN en Taller conserva los accesos historicos, y Operaciones queda sin modulos ni indicadores de Taller; `tests/dashboardDepartamentos.test.js` verifica ambas vistas y los accesos de los roles Taller, Contabilidad, Proveeduria y BODEGUERO. El commit `8676b38` contiene la restauracion del menu Taller.
- Una prueba HTTP recorre todos los prefijos Taller y sus subrutas: Operaciones recibe 403, Taller conserva acceso y los modulos compartidos de Contabilidad/Proveeduria mantienen sus permisos.
- El tablero se prueba para ADMIN, TALLER, Contabilidad, Proveeduría y BODEGUERO; se cruza cada enlace de Taller visible con el middleware para evitar tarjetas que terminen en 403.
- Las rutas y choferes prueban alta semanal con historial atomico, cambio de chofer con motivo obligatorio y rechazo de asignaciones fuera de la sede del supervisor.
- Los usuarios nuevos con rol `TALLER` reciben solo el departamento Taller por defecto; otros accesos se conceden expresamente desde administración.
- La asignación de departamentos se prueba por HTTP: solo ADMIN puede cambiarla, los valores invalidos se rechazan y un error de escritura revierte toda la transacción.
- La API del buscador de placas devuelve 403 fuera de Taller y funciona al seleccionar Taller.
- Las rutas de Taller tienen pruebas HTTP de bloqueo por departamento; los flujos de aceites, lavado, bodega, unidades, ARESEP y otros procesos tienen pruebas automatizadas parciales.
- El ejecutor procesa por separado las acciones de `ALTER TABLE`: una columna o indice ya existente no omite las acciones siguientes y los errores reales detienen la migracion.
- Los reintentos toleran una llave foranea duplicada solo cuando `INFORMATION_SCHEMA` confirma la misma tabla, columna y referencia; una colision distinta detiene la migracion.
- `/ready` comprueba columnas esenciales de los 31 esquemas que sostienen unidades, mantenimientos, correctivos, prioridades, reportes, rutas, lavado, aceites, llantas, DEKRA, MINAE y Bodega; tambien exige un directorio de adjuntos explicito y legible/escribible en produccion. Una base, esquema o almacenamiento incompleto devuelve `503`.
- El borrado de unidad usa un formulario separado del guardado masivo; una prueba verifica que no envie los campos de todas las unidades.
- Se documento el procedimiento de respaldo y restauracion para la base MySQL en Railway y los archivos del disco persistente de Render; falta configurarlo y probarlo desde las cuentas.
- El catalogo de Bodega permite editar fichas con auditoria antes/despues sin cambiar existencias; se prueban permisos de BODEGUERO y denegacion de BODEGA.
- Las paginas HTML renderizadas para usuarios autenticados usan `Cache-Control: private, no-store`, para que el navegador no reutilice informacion de un departamento o sesion anterior; se prueban respuestas autenticadas y publicas.
- Los adjuntos privados de facturas y cotizaciones siguen los mismos departamentos y roles autorizados para Facturas y Órdenes; se valida acceso permitido y denegado por carpeta.
- Las entregas rechazan lineas invalidas y una prueba verifica rollback total si una linea no tiene saldo; las recepciones exitosas por placa y generales conservan destino, cantidad, precio y transaccion; los ajustes no aceptan conteos no numericos y los precios de catalogo/recepcion se validan en el servidor.
- La devolucion de herramientas distingue cantidad vacia (devolver saldo completo) de valores invalidos; cero, negativos, texto y mas de dos decimales se rechazan antes de modificar inventario.
- Las solicitudes de llantas validan unidad, medida y cantidad entera positiva en el servidor; una prueba HTTP confirma que cantidades vacias, cero, negativas, decimales o no numericas no crean movimientos y que una solicitud valida deja historial.
- Las rutas individuales y el formulario de edicion de llantas exigen transiciones validas; las actualizaciones condicionales rechazan cambios concurrentes obsoletos. Se prueba el flujo SOLICITADA -> COTIZADA -> COMPRADA -> RECIBIDA, los rechazos y un intento de saltar directamente a RECIBIDA.
- El registro de correctivos con placa actualiza la condicion de la unidad, el correctivo, sus trabajos y el reporte relacionado dentro de una transaccion; una prueba confirma el rollback de todos los cambios cuando falla el detalle.
- La publicacion `6f8a745b97d8947cd1bbe02b019a6f2c6b77e72a` se verifico en Render con `/ready`: `status=ready`, `database=connected` y `schema=ready`; posteriormente, el commit `4c99d4f` se comprobo en la interfaz de Render para la separacion Taller/Operaciones.
- `npm audit --omit=dev` reporta cero vulnerabilidades en el estado revisado; la suite completa pasa sobre las dependencias instaladas.
- Mantenimientos falla cerrado cuando un mecanico de sede no tiene sede autorizada, sin impedir el cierre dentro de su sede; ADMIN/TALLER conservan el acceso global solo cuando no hay filtro de sede. Render responde `ready` con el commit `07292c39327814f306201dec4f45b0b3ec0eaa43`.
- El commit `1b4512e` evita almacenar paginas HTML privadas en caché. `npm test` pasa 131 pruebas, `npm audit --omit=dev` reporta cero vulnerabilidades y Render responde `ready` con la base y el esquema conectados.
- Los adjuntos de facturas y cotizaciones respetan el departamento activo autorizado por sus pantallas, en vez de quedar limitados a Taller; una prueba HTTP comprueba lectura autorizada, denegacion a Operaciones y rechazo sin sesion. `npm test` pasa 133 pruebas y `npm audit --omit=dev` no reporta vulnerabilidades.
- La disponibilidad requiere almacenamiento de adjuntos fuera del directorio incluido con el codigo; en Render comprueba que la ruta exista, sea legible/escribible y esté dentro de un punto de montaje real. Hay pruebas para configuracion, fallback no persistente, montaje ausente y rutas invalidas.
- En Render, si `UPLOAD_ROOT` no se sincroniza o apunta por error al directorio efimero incluido en el codigo, se usa `/var/data/uploads`, el punto declarado para el disco persistente en `render.yaml`; una ruta personalizada explicita conserva prioridad.
- `/ready` incluye ahora el identificador del commit tambien cuando la base, el esquema o los adjuntos no pasan la verificacion; falta comprobar ese dato en la instancia activa de Render.
- La migracion `202610020001_bodega_consumo_confirmacion_completar.sql` recupera esquemas parciales agregando cada columna por separado. Render responde `ready` con las nuevas columnas esenciales de Bodega en el commit `4117c75aae1cbb88b4221523680fff89840c1df7`.
- El resumen ejecutivo ahora inicia en el mes actual de Costa Rica cuando no se indica un rango, limita las subconsultas de ordenes a ese periodo y comparte calculos concurrentes identicos para reducir picos de memoria; se conservan los filtros de periodos anteriores.
- Verificacion mas reciente de produccion: `https://tomza-mant.onrender.com/ready` devuelve `503 not_ready`, con base y esquema conectados, pero adjuntos no disponibles (`persistent_root_not_configured`). El release activo no se pudo identificar y la separacion Taller/Operaciones aun requiere confirmacion visual en el release vigente; no se declara publicado ni saludable hasta resolverlo.
- Aun falta validar la interfaz real con perfiles de supervisor, mecanico, Pesados y bodeguero; completar cobertura de flujos criticos, probar respaldo/restauracion y obtener aceptacion funcional antes de declarar liberada la V1.

Este documento es el alcance de trabajo de la V1, no una declaracion de que todos sus criterios ya estan cumplidos.
