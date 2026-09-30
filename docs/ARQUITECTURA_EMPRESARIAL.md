# Arquitectura objetivo para Gas Tomza

## Propósito

Preparar Tomza Mantenimiento para crecer a una plataforma empresarial por áreas, conservando los procesos actuales y sus datos. Este documento define una dirección técnica y una lista de preparación; no afirma que las capacidades pendientes ya estén implementadas.

## Estado actual observado

- Aplicación web Node.js/Express con plantillas EJS.
- MySQL compartido; la conexión se centraliza en `src/db.js`.
- Rutas HTTP montadas desde `src/server.js`; las pantallas están en `src/views`.
- Cambios de esquema en `migrations/`, aplicados por `npm run migrate` y registrados con checksum.
- Pruebas automatizadas con `node --test`.
- Áreas actuales incluyen mantenimiento y unidades, taller, bodega, repuestos, compras, facturas, pagos, caja chica, asientos, ARESEP, DEKRA, MINAE, llantas, lavado, reportes de supervisores y logística.
- Despliegue web configurado en Render con almacenamiento persistente. La configuración del repositorio por sí sola no demuestra que existan respaldos restaurables ni alta disponibilidad.

## Dirección recomendada

Mantener inicialmente un **monolito modular**. Separar las responsabilidades dentro del mismo producto y despliegue, sin introducir microservicios hasta que existan necesidades de escala, equipos propietarios y contratos de integración claros.

Los dominios deben ser explícitos. Una estructura objetivo gradual puede ser:

```text
src/
  core/                 # identidad, permisos, organización, auditoría
  modules/
    fleet/              # unidades, activos, sedes, rutas y disponibilidad
    workshop/           # correctivos, preventivos y prioridades
    distribution/       # despacho, choferes y telemetría
    warehouse/          # inventario, consignaciones y entregas
    procurement/        # solicitudes, cotizaciones y órdenes
    finance/            # facturas, pagos, caja chica y asientos
    compliance/         # ARESEP, DEKRA, MINAE y evidencias
    people/             # personal, capacitación y asignaciones
```

Esta es una meta, no una instrucción para mover hoy todos los archivos. Cada módulo se extraerá de forma incremental, con pruebas y sin duplicar lógica que otros procesos usan.

## Reglas para cada módulo nuevo

1. Definir responsable del proceso, usuarios, permisos, estados, reportes y evidencia requerida antes de programar.
2. Reutilizar catálogos corporativos. Una unidad, persona, proveedor, producto, sede o empresa debe tener una identidad estable; evitar volver a capturarla con texto libre en cada módulo.
3. Mantener permisos por acción y alcance: por ejemplo `warehouse.items.read`, `warehouse.items.manage` y ámbito de sede. No basar autorizaciones nuevas solo en el nombre de usuario.
4. Guardar quién creó, editó, aprobó y anuló cada registro, con fecha y motivo cuando corresponda. Los cambios financieros y de cumplimiento deben conservar historial.
5. Modelar estados y transiciones permitidas. Una factura, orden o entrega no debe cambiar de estado sin reglas explícitas.
6. Diseñar integraciones para reintentos sin duplicar operaciones; registrar origen, identificador externo, resultado y errores.
7. Adjuntar archivos en almacenamiento privado con control de acceso, límites y auditoría; no exponer documentos financieros como archivos públicos.
8. Añadir una migración nueva, pruebas de permisos, pruebas del flujo principal y una forma de verificar el resultado antes de desplegar.

## Preparación obligatoria antes de abrirlo a toda la empresa

- Confirmar respaldo automático de la base de datos y practicar una restauración en un entorno separado.
- Crear ambientes de desarrollo, pruebas y producción con credenciales y bases distintas.
- Documentar responsables de producción, acceso de emergencia, despliegue y reversión.
- Centralizar errores, fallos de tareas programadas, latencia y disponibilidad; definir alertas y responsables.
- Inventariar los permisos existentes y probar explícitamente tanto accesos permitidos como denegados.
- Revisar crecimiento y retención de archivos, cuotas, respaldo y acceso al almacenamiento.
- Comprobar que los cambios de esquema se prueban contra una copia de datos representativa antes del despliegue.
- Corregir duplicaciones de montaje de rutas y reducir gradualmente los módulos de mayor tamaño. Evitar refactorizaciones masivas sin pruebas de regresión.

## Secuencia de crecimiento

### Etapa 0: proteger lo existente

Respaldo y restauración, ambientes, observabilidad, matriz de permisos, auditoría y revisión de archivos privados.

### Etapa 1: núcleo corporativo

Definir empresas legales, sedes, áreas, personas, usuarios, activos, proveedores, productos y permisos. Acordar cuáles son maestros y quién puede mantener cada catálogo.

### Etapa 2: consolidar los procesos actuales

Conectar unidades, mantenimiento, rutas, bodega, compras y finanzas mediante identificadores compartidos, historial y flujos de aprobación. Validar conciliaciones e informes con usuarios de cada área.

### Etapa 3: sumar áreas nuevas por piloto

Elegir un proceso nuevo, una sede piloto y un responsable funcional. Medir resultados, corregir controles y luego habilitar las demás sedes.

### Etapa 4: integraciones y analítica

Integrar correo/XML, contabilidad, GPS/telemetría y otros sistemas con trazabilidad de intercambio. Construir indicadores ejecutivos sobre datos conciliados, no sobre capturas duplicadas.

## Criterio de salida para cada piloto

No se considera listo solo porque la pantalla funciona. Debe pasar permisos, validación de datos, historial, exportación/reporte, respaldo, pruebas, capacitación, aceptación del responsable y un plan de reversión.
