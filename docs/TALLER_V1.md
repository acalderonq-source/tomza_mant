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
- [ ] Se confirma respaldo y restauracion de base de datos y archivos adjuntos.
- [ ] Se ejecutan pruebas automatizadas y una prueba de humo en Render; se identifica el commit activo.
- [ ] El responsable funcional valida los flujos y se publica una nota de version con cambios y limitaciones.

## Estado de auditoria al 2026-10-02

- El sistema usa Node.js, Express, EJS y MySQL; las rutas se organizan por modulo.
- `npm test` pasa 117 pruebas automatizadas (0 fallidas) en el estado local revisado.
- La vista del dashboard se prueba renderizada: ADMIN ve los modulos historicos de Taller al seleccionar Taller y no ve modulos ni indicadores de Taller al seleccionar Operaciones.
- El tablero se prueba para ADMIN, TALLER, Contabilidad, Proveeduría y BODEGUERO; se cruza cada enlace de Taller visible con el middleware para evitar tarjetas que terminen en 403.
- Las rutas de Taller tienen pruebas HTTP de bloqueo por departamento; los flujos de aceites, lavado, bodega, unidades, ARESEP y otros procesos tienen pruebas automatizadas parciales.
- El ejecutor procesa por separado las acciones de `ALTER TABLE`: una columna o indice ya existente no omite las acciones siguientes y los errores reales detienen la migracion.
- `/ready` comprueba conexion y columnas esenciales de unidades y confirmacion de consignaciones; Render no marca listo un esquema incompleto.
- El borrado de unidad usa un formulario separado del guardado masivo; una prueba verifica que no envie los campos de todas las unidades.
- El catalogo de Bodega permite editar fichas con auditoria antes/despues sin cambiar existencias; se prueban permisos de BODEGUERO y denegacion de BODEGA.
- Las entregas rechazan lineas invalidas sin guardar parcialmente, los ajustes no aceptan conteos no numericos y los precios de catalogo/recepcion se validan en el servidor.
- La publicacion `8c84bc52f9fd7b98adf988fe9e854aa0fe53d843` se verifico en Render con `/ready`: `status=ready`, `database=connected` y `schema=ready`.
- La migracion `202610020001_bodega_consumo_confirmacion_completar.sql` recupera esquemas parciales agregando cada columna por separado. No se consulto la base productiva directamente; la verificacion cubre las columnas esenciales declaradas en `/ready`.
- Aun falta validar la interfaz real con perfiles de usuario, completar cobertura de flujos criticos, probar respaldo/restauracion y obtener aceptacion funcional antes de declarar liberada la V1.

Este documento es el alcance de trabajo de la V1, no una declaracion de que todos sus criterios ya estan cumplidos.
