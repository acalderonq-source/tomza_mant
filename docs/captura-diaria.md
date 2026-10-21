# Captura diaria automática

Administración → **Captura general de ventas** (`/admin/ventas-gas/captura-diaria`, solo ADMIN).

## Uso diario
1. Subir el **Reporte General** del día (.xlsx). Opcional: adjuntar la Captura General para comparar kilos.
2. Digitar la **cobranza** de Gas Tomza y Super Gas del día y presionar Guardar.
3. **Descargar las 11 capturas (.zip)**: General, Gas Tomza, Super Gas, 5 CEDIs y 3 carteras, en .xlsx con el formato original. Los 11 archivos deben quedar juntos en la misma carpeta (están vinculados).

Volver a subir un día reemplaza ese día. El ZIP incluye `LEEME - avisos.txt` con lo que hay que revisar.

## Cómo se llena
- Unidad de negocio → captura: Cartago → Gas Tomza; Alajuela → Super Gas; La Cruz y Nicoya → Liberia; Atlántico; Zona Sur y Pérez Zeledón → Zona Sur; San Carlos; Pacífico.
- Clasificación contable → fila del Cuadro de Ventas (PULPERIAS = HINOS, DISTRIBUIDOR, PLANTA = PLANTA PUBLICO, VIP = CAMION CF, DISTRIBUIDOR PLANTA, GRANEL, GRAN GRANEL, CARBURACION). Contado/crédito en bruto, kilos y descuentos.
- Detalle: kilos por ruta en CAMION PULPERIAS y GRANEL COMERCIAL; kilos y colones netos por estación en CARBURACION (por código o nombre). Una ruta nueva usa una fila libre de la tabla y se informa.
- La cobranza va a VENTAS TOTALES fila COBRANZA. La General y las carteras se recalculan con sus fórmulas y vínculos (motor propio, verificado contra Excel en las 50 535 fórmulas).
- Un mes distinto al de las plantillas empieza vacío, con sus fechas, y el saldo inicial de cartera sale del saldo final del mes anterior (o del digitado en "Saldo inicial").

## Plantillas
Las 11 plantillas .xlsx tienen datos internos y **no van en el repositorio** (es público). Se suben una vez en la sección *Plantillas* y quedan en `UPLOAD_ROOT/.captura-diaria/plantillas` (disco persistente; incluir en respaldos). En desarrollo se usa `src/templates/captura-diaria/`. Se generaron desde los .xls originales con Excel (Guardar como .xlsx y cambiar vínculos a los nombres .xlsx).

Estado guardado: `UPLOAD_ROOT/.captura-diaria/estado.json` (resumen por día, cobranza y saldos; no guarda las facturas).

## Verificación
`node --test tests/capturaDiaria.test.js` (la prueba con plantillas reales se omite si no están).
