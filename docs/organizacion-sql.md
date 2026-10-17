# Organizacion SQL: primera etapa

## Aplicado el 17 de octubre de 2026

- Auditoria de solo lectura sobre 131 tablas y 54 relaciones declaradas.
- Diccionario de tablas, columnas, tipos, indices y claves foraneas en `base-datos-diccionario.md`.
- Indices compuestos en mantenimientos (estado, fecha_programada, unidad_id),
  ordenes_compra (facturada, pagada, fecha_pago) y facturas (pagada, fecha_pago).
- Migracion versionada 202610170001_indices_taller_erp.sql.
- Estructura previa guardada localmente antes del DDL. Esto es un respaldo de
  estructura, NO un respaldo completo de los datos.
- DDL ejecutado con ALGORITHM=INPLACE y LOCK=NONE, y espera de metadatos limitada
  a cinco segundos. MySQL puede necesitar bloqueos breves de metadatos.
- Verificados los tres indices y repetida la auditoria despues de aplicarlos.

No se borraron ni fusionaron registros; no se modificaron montos ni columnas.
Los indices permiten nuevas estrategias de consulta, pero la mejora real debe
medirse con EXPLAIN y tiempos de carga, no se presupone una aceleracion concreta.

## Hallazgos pendientes

- Dos grupos de facturas independientes con mismo proveedor y numero normalizado
  por espacios y mayusculas. No se eliminaron; primero revisar pagos, asientos y adjuntos.
- `import_facturas_pagadas`, `minae_excel_temp` y `respaldo_pagos_julio_emily`
  carecen de clave primaria. Son auxiliares/historicas, no se alteraron automaticamente.
- Hay indices con columnas repetidas, por ejemplo periodo_cierre en facturas y
  ordenes_compra. No se eliminaron sin comprobar claves foraneas y planes de consulta.
- Las comprobaciones de ordenes sin proveedor, lineas sin orden y mantenimientos
  sin unidad dieron cero. No equivale a comprobar todas las relaciones de la base.

## Operacion

Auditar sin cambiar SQL (desde una carpeta con las variables MySQL configuradas):

```powershell
node src/scripts/auditarBaseDatos.js tmp/auditoria-sql.json docs/base-datos-diccionario.md
node src/scripts/organizarIndicesTaller.js
```

El segundo comando simula por defecto. `--aplicar` crea exclusivamente los tres
indices de esta etapa y registra su checksum; no ejecuta migraciones pendientes
de otros modulos. El ejecutor habitual de migraciones conserva la misma version.

## Siguiente etapa

1. Confirmar respaldo completo y probar restauracion antes de cambios destructivos.
2. Revisar duplicados con sus dependencias; resolver cada caso con autorizacion.
3. Clasificar tablas por modulo sin renombrarlas ni romper consultas.
4. Normalizar relaciones de pagos/documentos que hoy estan en JSON, con backfill
   verificable y compatibilidad temporal con la aplicacion.
5. Agregar restricciones solo despues de limpiar datos y verificar la integridad.
