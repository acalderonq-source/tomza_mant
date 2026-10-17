# Diccionario SQL de Gas Tomza

Generado: 2026-10-17T16:22:07.636Z

No contiene datos de trabajadores, proveedores, facturas ni credenciales. Las cantidades de filas son estimaciones de MySQL.

Tablas: 131. Relaciones declaradas: 54.

## Comprobaciones

- Proveedores con nombre repetido: 0.
- Placas repetidas: 0.
- Facturas independientes repetidas por proveedor y numero: 2.
- Ordenes sin proveedor existente: 0.
- Lineas sin orden existente: 0.
- Mantenimientos sin unidad existente: 0.

## Tablas sin clave primaria

 - `import_facturas_pagadas`
 - `minae_excel_temp`
 - `respaldo_pagos_julio_emily`

Son tablas auxiliares o historicas por revisar; no se han eliminado ni modificado.

## aceite_estanones

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 12.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| sede | varchar(100) | NO |
| descripcion | varchar(180) | YES |
| fecha_compra | date | NO |
| litros_capacidad | decimal(10,2) | NO |
| litros_restantes | decimal(10,2) | NO |
| monto_total | decimal(14,2) | NO |
| orden_compra_id | int | YES |
| orden_compra_numero | varchar(50) | YES |
| estado | enum('ACTIVO','AGOTADO','CERRADO') | NO |
| creado_por | int | YES |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_aceite_estanones_fecha: (fecha_compra).
- idx_aceite_estanones_orden_compra: (orden_compra_id).
- idx_aceite_estanones_sede_estado: (sede, estado).
- PRIMARY: (id) UNIQUE.

## aceite_movimientos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 121.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| estanon_id | int | NO |
| cambio_aceite_id | int | YES |
| sede | varchar(100) | NO |
| tipo | enum('ENTRADA','SALIDA','AJUSTE') | NO |
| litros | decimal(10,2) | NO |
| descripcion | varchar(255) | YES |
| unidad_id | int | YES |
| placa | varchar(50) | YES |
| creado_por | int | YES |
| creado_en | timestamp | NO |

Indices:
- idx_aceite_mov_estanon: (estanon_id).
- idx_aceite_mov_fecha: (creado_en).
- idx_aceite_mov_sede: (sede).
- PRIMARY: (id) UNIQUE.

## administracion_propietario

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | tinyint | NO |
| usuario_id | int | NO |

Indices:
- PRIMARY: (id) UNIQUE.
- usuario_id: (usuario_id) UNIQUE.

## aires_acondicionados

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| unidad_id | int | NO |
| sede | varchar(100) | NO |
| tipo_trabajo | enum('REPARACION','CARGA','MANTENIMIENTO') | NO |
| fecha | date | NO |
| realizado_por | varchar(150) | NO |
| proximo_mantenimiento | date | YES |
| observaciones | text | YES |
| creado_por | int | YES |
| creado_en | datetime | NO |

Indices:
- idx_aires_proximo: (proximo_mantenimiento).
- idx_aires_sede_fecha: (sede, fecha).
- idx_aires_unidad_fecha: (unidad_id, fecha).
- PRIMARY: (id) UNIQUE.

## aresep_historial

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 445.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| registro_id | int | NO |
| version | int | NO |
| datos | json | NO |
| usuario_id | int | NO |
| creado_en | timestamp | NO |

Indices:
- PRIMARY: (id) UNIQUE.
- uq_aresep_historial_version: (registro_id, version) UNIQUE.
- Relacion: registro_id -> aresep_registros.id.

## aresep_registros

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 427.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| periodo | char(7) | NO |
| seccion | varchar(20) | NO |
| clave | char(64) | NO |
| unidad_id | int | YES |
| datos | json | NO |
| version | int | NO |
| creado_por | int | NO |
| actualizado_por | int | NO |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_aresep_unidad: (unidad_id).
- PRIMARY: (id) UNIQUE.
- uq_aresep_periodo_seccion_clave: (periodo, seccion, clave) UNIQUE.

## asientos_pasivos_facturas

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 644.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| lote_id | bigint | NO |
| factura_tipo | enum('orden','independiente','portal') | NO |
| factura_id | int | NO |
| clave_electronica | varchar(80) | YES |
| identidad_documento | varchar(255) | YES |
| numero_factura | varchar(100) | YES |
| proveedor_nombre | varchar(180) | YES |
| fecha_factura | date | YES |
| monto_asiento | decimal(18,2) | NO |
| creado_en | timestamp | NO |

Indices:
- idx_asiento_pasivos_lote: (lote_id).
- PRIMARY: (id) UNIQUE.
- uq_asiento_pasivos_clave: (clave_electronica) UNIQUE.
- uq_asiento_pasivos_documento: (identidad_documento) UNIQUE.
- uq_asiento_pasivos_factura: (factura_tipo, factura_id) UNIQUE.

## asientos_pasivos_lotes

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 6.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| creado_en | timestamp | NO |
| creado_por | int | YES |
| cantidad_facturas | int | NO |
| monto_total | decimal(18,2) | NO |
| archivo_nombre | varchar(180) | NO |
| archivo_xlsx | longblob | NO |

Indices:
- idx_asientos_pasivos_fecha: (creado_en).
- PRIMARY: (id) UNIQUE.

## auditoria_sistema

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 381.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| modulo | varchar(80) | NO |
| tabla_afectada | varchar(80) | NO |
| registro_id | bigint | YES |
| accion | varchar(40) | NO |
| resumen | varchar(255) | YES |
| antes | json | YES |
| despues | json | YES |
| usuario_id | int | YES |
| usuario_nombre | varchar(120) | YES |
| creado_en | timestamp | NO |

Indices:
- idx_auditoria_modulo_fecha: (modulo, creado_en).
- idx_auditoria_tabla_registro: (tabla_afectada, registro_id).
- idx_auditoria_usuario: (usuario_id).
- PRIMARY: (id) UNIQUE.

## bodega_articulos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 534.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| codigo_taller | varchar(4) | YES |
| codigo | varchar(80) | YES |
| nombre | varchar(180) | NO |
| tipo_articulo | enum('REPUESTO','CONSUMIBLE','HERRAMIENTA','OTRO') | NO |
| grupo_bodega | varchar(30) | NO |
| origen_inventario | enum('PROPIO','CONSIGNACION') | NO |
| categoria | varchar(100) | YES |
| marca | varchar(100) | YES |
| numero_parte | varchar(120) | YES |
| tipo_unidad | varchar(120) | YES |
| unidad_medida | varchar(30) | NO |
| stock_actual | decimal(12,2) | NO |
| stock_minimo | decimal(12,2) | NO |
| stock_maximo | decimal(12,2) | NO |
| ubicacion | varchar(120) | YES |
| precio_unitario | decimal(12,2) | NO |
| proveedor_id | int | YES |
| proveedor_nombre | varchar(180) | YES |
| proveedor_consignacion | varchar(180) | YES |
| fecha_ultima_compra | date | YES |
| observacion | text | YES |
| activo | tinyint(1) | NO |
| creado_por | int | YES |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_bodega_articulo_categoria: (categoria).
- idx_bodega_articulo_nombre: (nombre).
- idx_bodega_articulo_proveedor: (proveedor_id).
- idx_bodega_articulo_stock: (stock_actual, stock_minimo).
- idx_bodega_articulo_tipo: (tipo_articulo).
- idx_bodega_articulos_codigo_origen: (codigo, origen_inventario).
- idx_bodega_articulos_codigo_taller: (codigo_taller) UNIQUE.
- idx_bodega_articulos_origen: (origen_inventario).
- PRIMARY: (id) UNIQUE.

## bodega_compatibilidades

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 362.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| configuracion_id | int | NO |
| articulo_id | int | NO |
| tipo_servicio | varchar(80) | NO |
| cantidad | decimal(12,2) | NO |
| observacion | varchar(220) | YES |
| nivel_confianza | varchar(30) | NO |
| criterio_compatibilidad | varchar(255) | YES |
| fuente_url | varchar(500) | YES |
| activo | tinyint(1) | NO |
| creado_por | int | YES |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_bodega_compat_articulo: (articulo_id, activo).
- PRIMARY: (id) UNIQUE.
- uk_bodega_compatibilidad: (configuracion_id, articulo_id, tipo_servicio) UNIQUE.

## bodega_configuraciones_unidad

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 23.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| marca | varchar(100) | NO |
| modelo | varchar(120) | NO |
| anio | int | YES |
| motor | varchar(120) | YES |
| descripcion | varchar(220) | YES |
| activo | tinyint(1) | NO |
| creado_por | int | YES |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_bodega_config_vehiculo: (marca, modelo, anio, activo).
- PRIMARY: (id) UNIQUE.

## bodega_entregas

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 427.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| placa | varchar(50) | YES |
| mecanico | varchar(120) | YES |
| tipo_trabajo | enum('MANTENIMIENTO','CORRECTIVO','REPARACION','EMERGENCIA','OTRO') | NO |
| observacion | text | YES |
| creado_por | int | YES |
| creado_en | timestamp | NO |

Indices:
- idx_bodega_entrega_fecha: (creado_en).
- idx_bodega_entrega_mecanico: (mecanico).
- idx_bodega_entrega_placa: (placa).
- PRIMARY: (id) UNIQUE.

## bodega_existencias

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 524.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| articulo_id | int | NO |
| sede | varchar(120) | NO |
| ubicacion | varchar(120) | NO |
| cantidad | decimal(12,2) | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_bodega_existencia_sede: (sede, articulo_id).
- PRIMARY: (id) UNIQUE.
- uk_bodega_existencia: (articulo_id, sede, ubicacion) UNIQUE.
- Relacion: articulo_id -> bodega_articulos.id.

## bodega_movimientos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 1321.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| articulo_id | int | NO |
| entrega_id | int | YES |
| prestamo_id | int | YES |
| movimiento_origen_id | int | YES |
| tipo_movimiento | enum('ENTRADA','SALIDA','DEVOLUCION','AJUSTE','PRESTAMO','DEVOLUCION_HERRAMIENTA','APERTURA','TRASLADO') | NO |
| origen_inventario | enum('PROPIO','CONSIGNACION') | NO |
| sede | varchar(120) | YES |
| ubicacion | varchar(120) | YES |
| sede_destino | varchar(120) | YES |
| ubicacion_destino | varchar(120) | YES |
| cantidad | decimal(12,2) | NO |
| existencia_anterior | decimal(12,2) | NO |
| existencia_nueva | decimal(12,2) | NO |
| placa | varchar(50) | YES |
| destino_recepcion | enum('GENERALES','PLACA') | NO |
| mecanico | varchar(120) | YES |
| tipo_trabajo | varchar(50) | YES |
| proveedor_id | int | YES |
| proveedor_nombre | varchar(180) | YES |
| numero_factura | varchar(120) | YES |
| orden_compra_id | int | YES |
| codigo_taller_snapshot | varchar(4) | YES |
| codigo_proveedor_snapshot | varchar(80) | YES |
| descripcion_snapshot | varchar(180) | YES |
| proveedor_snapshot | varchar(180) | YES |
| precio_unitario | decimal(12,2) | NO |
| motivo | text | YES |
| creado_por | int | YES |
| creado_en | timestamp | NO |

Indices:
- idx_bodega_mov_articulo: (articulo_id).
- idx_bodega_mov_entrega: (entrega_id).
- idx_bodega_mov_fecha: (creado_en).
- idx_bodega_mov_origen: (movimiento_origen_id).
- idx_bodega_mov_placa: (placa).
- idx_bodega_mov_proveedor: (proveedor_id).
- idx_bodega_mov_sede_fecha: (sede, creado_en).
- idx_bodega_mov_tipo: (tipo_movimiento).
- idx_bodega_movimientos_origen: (origen_inventario).
- PRIMARY: (id) UNIQUE.
- Relacion: movimiento_origen_id -> bodega_movimientos.id.

## bodega_ordenes_consumo

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 4.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| orden_compra_id | int | NO |
| proveedor_id | int | NO |
| fecha_desde | date | NO |
| fecha_hasta | date | NO |
| sede | varchar(120) | NO |
| contacto_confirmacion | varchar(180) | YES |
| referencia_confirmacion | varchar(180) | YES |
| confirmado_por | int | YES |
| confirmado_en | datetime | YES |
| creado_por | int | YES |
| creado_en | timestamp | NO |

Indices:
- idx_bodega_consumo_proveedor: (proveedor_id, creado_en).
- PRIMARY: (orden_compra_id) UNIQUE.
- uk_bodega_consumo_periodo: (proveedor_id, fecha_desde, fecha_hasta, sede) UNIQUE.

## bodega_ordenes_consumo_movimientos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 55.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| movimiento_id | int | NO |
| orden_compra_id | int | NO |
| creado_en | timestamp | NO |

Indices:
- idx_bodega_consumo_mov_orden: (orden_compra_id, movimiento_id).
- PRIMARY: (movimiento_id) UNIQUE.

## bodega_prestamos_herramientas

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 4.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| articulo_id | int | NO |
| mecanico | varchar(120) | NO |
| placa | varchar(50) | YES |
| sede | varchar(120) | YES |
| ubicacion | varchar(120) | YES |
| cantidad | decimal(12,2) | NO |
| cantidad_devuelta | decimal(12,2) | NO |
| estado | enum('PRESTADO','DEVUELTO') | NO |
| salida_en | timestamp | NO |
| devolucion_en | timestamp | YES |
| recibido_por | varchar(120) | YES |
| observacion | text | YES |
| creado_por | int | YES |
| actualizado_por | int | YES |

Indices:
- idx_bodega_prestamo_articulo: (articulo_id).
- idx_bodega_prestamo_estado: (estado).
- idx_bodega_prestamo_mecanico: (mecanico).
- idx_bodega_prestamo_placa: (placa).
- PRIMARY: (id) UNIQUE.

## bodega_unidades_configuracion

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 114.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| unidad_id | int | NO |
| configuracion_id | int | NO |
| creado_por | int | YES |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_bodega_unidad_config: (configuracion_id).
- PRIMARY: (unidad_id) UNIQUE.

## caja_chica_cortes

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 1.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| fecha | date | NO |
| base_caja | decimal(14,2) | NO |
| vales_total | decimal(14,2) | NO |
| efectivo_json | text | YES |
| total_gas_tomza | decimal(14,2) | NO |
| total_super_gas | decimal(14,2) | NO |
| total_documentos | decimal(14,2) | NO |
| observacion | text | YES |
| estado | varchar(20) | NO |
| reintegro_id | int | YES |
| creado_por | int | YES |
| creado_en | timestamp | NO |
| reabierto_en | datetime | YES |
| reabierto_por | int | YES |
| documentos_snapshot_json | longtext | YES |

Indices:
- idx_caja_chica_cortes_estado: (estado).
- idx_caja_chica_cortes_fecha: (fecha).
- PRIMARY: (id) UNIQUE.

## caja_chica_documentos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 42.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| factura_electronica_id | bigint | YES |
| corte_id | bigint | YES |
| empresa | varchar(30) | NO |
| fecha | date | NO |
| cuenta_contable | varchar(80) | YES |
| numero_factura | varchar(100) | NO |
| proveedor | varchar(180) | NO |
| unidad | varchar(60) | YES |
| concepto | varchar(80) | NO |
| monto | decimal(14,2) | NO |
| tipo_factura | varchar(30) | NO |
| estado | varchar(20) | NO |
| creado_por | int | YES |
| confirmado_por | int | YES |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_caja_chica_documentos_corte: (corte_id).
- idx_caja_chica_documentos_empresa: (empresa).
- idx_caja_chica_documentos_estado: (estado).
- idx_caja_chica_documentos_fecha: (fecha).
- PRIMARY: (id) UNIQUE.
- uq_caja_chica_factura_electronica: (factura_electronica_id) UNIQUE.

## caja_chica_reintegros

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 6.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| fecha | date | NO |
| monto | decimal(14,2) | NO |
| observacion | text | YES |
| creado_por | int | YES |
| creado_en | timestamp | NO |

Indices:
- idx_caja_chica_fecha: (fecha).
- PRIMARY: (id) UNIQUE.

## cambios_aceite

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 62.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| unidad_id | int | NO |
| sede | varchar(20) | NO |
| km_actual | int | NO |
| galones | decimal(5,2) | NO |
| litros_usados | decimal(10,2) | YES |
| proximo_km | int | NO |
| observaciones | text | YES |
| creado_por | int | NO |
| fecha | timestamp | YES |

Indices:
- creado_por: (creado_por).
- PRIMARY: (id) UNIQUE.
- uniq_unidad: (unidad_id) UNIQUE.
- Relacion: unidad_id -> unidades.id.
- Relacion: creado_por -> usuarios.id.

## cambios_aceite_historial

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 26.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| unidad_id | int | NO |
| sede | varchar(20) | NO |
| km_actual | int | NO |
| galones | decimal(5,2) | NO |
| litros_usados | decimal(10,2) | YES |
| proximo_km | int | NO |
| observaciones | text | YES |
| creado_por | int | NO |
| fecha | timestamp | YES |
| archivado_en | timestamp | NO |

Indices:
- PRIMARY: (id) UNIQUE.

## carburacion_cliente_editores

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 2.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| usuario_id | int | NO |
| motivo | varchar(200) | NO |
| asignado_en | timestamp | NO |

Indices:
- PRIMARY: (usuario_id) UNIQUE.

## carburacion_clientes

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 66.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| nombre | varchar(150) | NO |
| archivo_origen | varchar(200) | YES |
| hoja_origen | varchar(100) | YES |
| fila_origen | int | YES |
| creado_por | int | NO |
| creado_en | timestamp | NO |
| razon_social | varchar(200) | YES |
| cedula_juridica | varchar(40) | YES |
| direccion | text | YES |
| provincia | varchar(100) | YES |
| canton | varchar(100) | YES |
| distrito | varchar(100) | YES |
| representante_legal | varchar(200) | YES |
| tipo_actividad | varchar(200) | YES |
| correo_notificacion | varchar(200) | YES |
| telefono_notificacion | varchar(40) | YES |
| codigo_minae | varchar(100) | YES |
| version | int | NO |
| actualizado_por | int | YES |
| actualizado_en | timestamp | YES |

Indices:
- PRIMARY: (id) UNIQUE.
- uq_carburacion_cliente_nombre: (nombre) UNIQUE.
- uq_carburacion_cliente_origen: (archivo_origen, hoja_origen, fila_origen) UNIQUE.

## carburacion_clientes_historial

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| cliente_id | int | NO |
| accion | varchar(20) | NO |
| antes_json | json | YES |
| despues_json | json | NO |
| usuario_id | int | NO |
| usuario_nombre | varchar(160) | NO |
| creado_en | timestamp | NO |

Indices:
- idx_carburacion_cliente_historial: (cliente_id, id).
- PRIMARY: (id) UNIQUE.
- Relacion: cliente_id -> carburacion_clientes.id.

## carburacion_correo_config

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 1.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | tinyint | NO |
| copia_1 | varchar(200) | YES |
| copia_2 | varchar(200) | YES |
| copia_3 | varchar(200) | YES |
| correo_respuesta | varchar(200) | YES |
| actualizado_por | int | YES |
| actualizado_en | timestamp | YES |

Indices:
- PRIMARY: (id) UNIQUE.

## carburacion_estaciones_historial

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 195.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| registro_id | int | NO |
| accion | varchar(30) | NO |
| antes_json | json | YES |
| despues_json | json | NO |
| observacion | varchar(1000) | YES |
| usuario_id | int | NO |
| usuario_nombre | varchar(160) | NO |
| creado_en | timestamp | NO |

Indices:
- idx_carburacion_estaciones_historial: (registro_id, id).
- PRIMARY: (id) UNIQUE.
- Relacion: registro_id -> carburacion_estaciones_registros.id.

## carburacion_estaciones_proveedores

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 70.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| registro_id | int | NO |
| proveedor_id | int | NO |

Indices:
- PRIMARY: (registro_id, proveedor_id) UNIQUE.
- proveedor_id: (proveedor_id).
- Relacion: registro_id -> carburacion_estaciones_registros.id.
- Relacion: proveedor_id -> carburacion_proveedores.id.

## carburacion_estaciones_registros

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 195.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| categoria | varchar(30) | NO |
| estacion | varchar(250) | NO |
| cliente_id | int | YES |
| ejecutivo | varchar(120) | YES |
| prioridad | varchar(20) | NO |
| estado | varchar(20) | NO |
| detalle | text | YES |
| proveedor_texto | varchar(500) | YES |
| campos_json | json | NO |
| origen_json | json | YES |
| archivo_origen | varchar(200) | YES |
| origen_sha | char(64) | YES |
| hoja_origen | varchar(100) | YES |
| fila_origen | int | YES |
| version | int | NO |
| creado_por | int | NO |
| actualizado_por | int | NO |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- cliente_id: (cliente_id).
- idx_carburacion_estaciones_categoria: (categoria, estado, prioridad).
- PRIMARY: (id) UNIQUE.
- uq_carburacion_estaciones_origen: (origen_sha, hoja_origen, fila_origen) UNIQUE.
- Relacion: cliente_id -> carburacion_clientes.id.

## carburacion_facturas

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| orden_id | int | YES |
| proveedor_id | int | NO |
| numero | varchar(100) | NO |
| fecha | date | NO |
| vencimiento | date | NO |
| moneda | varchar(10) | NO |
| total | decimal(16,2) | NO |
| pagado | decimal(16,2) | NO |
| cliente | varchar(100) | YES |
| observacion | text | YES |
| archivo_nombre | varchar(200) | YES |
| archivo_tipo | varchar(60) | YES |
| archivo | mediumblob | YES |
| creado_por | int | NO |
| creado_en | timestamp | NO |
| cliente_id | int | YES |
| periodo_cierre | char(7) | YES |

Indices:
- fk_carburacion_factura_cliente: (cliente_id).
- PRIMARY: (id) UNIQUE.
- uq_carburacion_factura_numero: (proveedor_id, numero) UNIQUE.
- uq_carburacion_factura_orden: (orden_id) UNIQUE.
- Relacion: orden_id -> carburacion_ordenes.id.
- Relacion: proveedor_id -> carburacion_proveedores.id.
- Relacion: cliente_id -> carburacion_clientes.id.

## carburacion_ordenes

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 3.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| po_numero | varchar(40) | YES |
| fecha | date | NO |
| proveedor_id | int | NO |
| forma_pago | varchar(100) | YES |
| moneda | varchar(10) | NO |
| empresa_destino | varchar(40) | NO |
| placa_unidad | varchar(100) | YES |
| subtotal | decimal(16,2) | NO |
| descuento | decimal(16,2) | NO |
| transporte | decimal(16,2) | NO |
| iva | decimal(8,2) | NO |
| total | decimal(16,2) | NO |
| observaciones | text | YES |
| lineas_json | json | NO |
| estado | varchar(30) | NO |
| creado_por | int | NO |
| creado_en | timestamp | NO |
| actualizado_por | int | YES |
| actualizado_en | timestamp | YES |
| cliente_id | int | YES |
| numero_cotizacion | varchar(100) | YES |
| eliminado_en | timestamp | YES |
| eliminado_por | int | YES |

Indices:
- fk_carburacion_orden_cliente: (cliente_id).
- po_numero: (po_numero) UNIQUE.
- PRIMARY: (id) UNIQUE.
- proveedor_id: (proveedor_id).
- Relacion: proveedor_id -> carburacion_proveedores.id.
- Relacion: cliente_id -> carburacion_clientes.id.

## carburacion_pago_envios

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| pago_id | int | NO |
| estado | varchar(30) | NO |
| correo_destino | varchar(200) | YES |
| copias_json | json | YES |
| correo_respuesta | varchar(200) | YES |
| intentos | int | NO |
| error | varchar(500) | YES |
| bloqueo_token | char(36) | YES |
| iniciado_en | timestamp | YES |
| enviado_en | timestamp | YES |
| solicitado_por | int | YES |

Indices:
- PRIMARY: (id) UNIQUE.
- uq_carburacion_envio_pago: (pago_id) UNIQUE.
- Relacion: pago_id -> carburacion_pagos.id.

## carburacion_pagos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| token | char(36) | NO |
| recibo_numero | varchar(40) | YES |
| proveedor_id | int | NO |
| fecha | date | NO |
| moneda | varchar(10) | NO |
| total | decimal(16,2) | NO |
| tipo | varchar(20) | NO |
| comprobante_numero | varchar(120) | YES |
| comprobante_nombre | varchar(200) | YES |
| comprobante_tipo | varchar(60) | YES |
| comprobante | mediumblob | YES |
| observacion | text | YES |
| facturas_json | json | NO |
| creado_por | int | NO |
| generado_por | varchar(160) | NO |
| creado_en | timestamp | NO |
| periodo_cierre | char(7) | YES |

Indices:
- PRIMARY: (id) UNIQUE.
- proveedor_id: (proveedor_id).
- uq_carburacion_pago_recibo: (recibo_numero) UNIQUE.
- uq_carburacion_pago_token: (token) UNIQUE.
- Relacion: proveedor_id -> carburacion_proveedores.id.

## carburacion_pagos_detalle

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| pago_id | int | NO |
| factura_id | int | NO |
| monto | decimal(16,2) | NO |

Indices:
- factura_id: (factura_id).
- PRIMARY: (pago_id, factura_id) UNIQUE.
- Relacion: pago_id -> carburacion_pagos.id.
- Relacion: factura_id -> carburacion_facturas.id.

## carburacion_proveedores

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 2.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| nombre | varchar(200) | NO |
| direccion | text | YES |
| telefono | varchar(60) | YES |
| email | varchar(200) | YES |
| contacto | varchar(200) | YES |
| cedula_juridica | varchar(60) | YES |
| creado_por | int | NO |
| creado_en | timestamp | NO |

Indices:
- PRIMARY: (id) UNIQUE.

## carnets_trabajador

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 51.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| cedula | varchar(20) | NO |
| qr_token | char(64) | NO |
| foto_data | mediumblob | YES |
| foto_mime | varchar(30) | YES |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- PRIMARY: (cedula) UNIQUE.
- uq_carnets_trabajador_qr_token: (qr_token) UNIQUE.

## colillas_pago_envios

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 7.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint unsigned | NO |
| colilla_id | bigint unsigned | NO |
| usuario_id | int | YES |
| clave_proveedor | varchar(220) | NO |
| proveedor_id | bigint unsigned | YES |
| proveedor_nombre | varchar(220) | NO |
| correo_destino | varchar(254) | YES |
| correo_respuesta | varchar(254) | YES |
| correos_copia | text | YES |
| recibo_numero | varchar(80) | NO |
| fecha_pago | date | NO |
| tipo_pago | varchar(24) | NO |
| comprobante_numero | varchar(120) | YES |
| monto | decimal(14,2) | NO |
| facturas_json | longtext | NO |
| comprobantes_json | longtext | NO |
| estado | varchar(30) | NO |
| error | text | YES |
| intentos | int | NO |
| enviado_en | datetime | YES |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_colillas_envios_estado: (estado, actualizado_en).
- idx_colillas_envios_proveedor: (proveedor_id).
- PRIMARY: (id) UNIQUE.
- uq_colilla_proveedor_envio: (colilla_id, clave_proveedor) UNIQUE.

## colillas_pago_proveedor

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 1682.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint unsigned | NO |
| recibo_numero | varchar(80) | NO |
| fecha_pago | date | NO |
| periodo_cierre | char(7) | YES |
| tipo_pago | varchar(24) | NO |
| total_pagado | decimal(14,2) | NO |
| comprobante_numero | varchar(120) | YES |
| comprobante_archivo | varchar(255) | YES |
| generado_por | varchar(160) | NO |
| facturas_json | longtext | NO |
| origen | varchar(20) | NO |
| creado_en | timestamp | NO |

Indices:
- idx_colillas_pago_fecha: (fecha_pago).
- idx_colillas_pago_origen: (origen).
- idx_colillas_pago_periodo: (periodo_cierre).
- PRIMARY: (id) UNIQUE.
- uq_colillas_pago_recibo: (recibo_numero) UNIQUE.

## configuracion_correo_pagos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 1.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | tinyint unsigned | NO |
| copia_1 | varchar(254) | YES |
| copia_2 | varchar(254) | YES |
| copia_3 | varchar(254) | YES |
| actualizado_por | int | YES |
| actualizado_en | timestamp | NO |

Indices:
- PRIMARY: (id) UNIQUE.

## cont_clasificaciones

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| fuente | varchar(30) | NO |
| documento_id | bigint | NO |
| sede | varchar(120) | NO |
| departamento | varchar(40) | NO |
| rubro | varchar(60) | NO |
| moneda | char(3) | NO |
| actualizado_por | int | NO |
| actualizado_en | timestamp | NO |
| empresa | varchar(120) | NO |

Indices:
- PRIMARY: (fuente, documento_id) UNIQUE.

## cont_documentos_historial

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| documento | varchar(100) | NO |
| estado | varchar(20) | NO |
| empresa | varchar(180) | NO |
| moneda | varchar(10) | NO |
| huella | char(64) | NO |
| motivo | text | YES |
| actor | int | NO |
| creado_en | timestamp | NO |

Indices:
- idx_cont_documento_historial: (documento, id).
- PRIMARY: (id) UNIQUE.

## cont_documentos_revision

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| documento | varchar(100) | NO |
| estado | varchar(20) | NO |
| empresa | varchar(180) | NO |
| moneda | varchar(10) | NO |
| huella | char(64) | NO |
| motivo | text | YES |
| revisado_por | int | YES |
| actualizado_en | timestamp | NO |

Indices:
- PRIMARY: (documento) UNIQUE.

## cont_planilla_pagos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| registro_id | bigint | NO |
| fecha | date | NO |
| referencia | varchar(120) | NO |
| monto | decimal(16,2) | NO |
| actor | int | NO |
| creado_en | timestamp | NO |

Indices:
- PRIMARY: (id) UNIQUE.
- uq_cont_planilla_pago: (registro_id, referencia) UNIQUE.
- Relacion: registro_id -> cont_planilla_registros.id.

## cont_planilla_personas

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 568.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| periodo | char(7) | NO |
| empresa | varchar(120) | NO |
| moneda | char(3) | NO |
| sede | varchar(120) | NO |
| departamento | varchar(40) | NO |
| nombre | varchar(180) | NO |
| puesto | varchar(180) | NO |
| grupo | varchar(120) | NO |
| presupuesto | decimal(16,2) | YES |
| archivo_id | bigint | YES |
| fila_origen | int | YES |
| periodo_origen | varchar(120) | NO |
| version | int | NO |
| actualizado_por | int | NO |

Indices:
- idx_cont_planilla_personas: (periodo, empresa, moneda).
- PRIMARY: (id) UNIQUE.
- uq_cont_planilla_origen: (archivo_id, fila_origen) UNIQUE.

## cont_planilla_registros

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| persona_id | bigint | NO |
| fecha | date | NO |
| salario | decimal(16,2) | NO |
| extras | decimal(16,2) | NO |
| rebajos | decimal(16,2) | NO |
| observacion | varchar(500) | NO |
| version | int | NO |
| actualizado_por | int | NO |
| actualizado_en | timestamp | NO |

Indices:
- PRIMARY: (id) UNIQUE.
- uq_cont_planilla_registro: (persona_id) UNIQUE.
- Relacion: persona_id -> cont_planilla_personas.id.

## cont_presupuesto_archivos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 8.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| periodo | char(7) | NO |
| empresa | varchar(120) | NO |
| nombre | varchar(200) | NO |
| sha256 | char(64) | NO |
| contenido | mediumblob | NO |
| datos | json | NO |
| total_crc | decimal(16,2) | NO |
| actor | int | NO |
| creado_en | timestamp | NO |

Indices:
- idx_cont_archivo_periodo: (periodo, empresa).
- PRIMARY: (id) UNIQUE.
- uq_cont_archivo: (periodo, empresa, sha256) UNIQUE.

## cont_presupuesto_auditoria

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 8.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| actor | int | NO |
| accion | varchar(40) | NO |
| referencia | varchar(200) | NO |
| antes | json | YES |
| despues | json | NO |
| creado_en | timestamp | NO |

Indices:
- PRIMARY: (id) UNIQUE.

## cont_presupuestos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 45.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| periodo | char(7) | NO |
| sede | varchar(120) | NO |
| departamento | varchar(40) | NO |
| moneda | char(3) | NO |
| rubro | varchar(60) | NO |
| monto | decimal(16,2) | NO |
| observacion | varchar(500) | NO |
| version | int | NO |
| actualizado_por | int | NO |
| actualizado_en | timestamp | NO |
| empresa | varchar(120) | NO |

Indices:
- PRIMARY: (id) UNIQUE.
- uq_cont_presupuesto: (periodo, empresa, sede, departamento, moneda, rubro) UNIQUE.

## cont_rubro_conceptos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 478.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| periodo | char(7) | NO |
| empresa | varchar(120) | NO |
| rubro | varchar(60) | NO |
| moneda | char(3) | NO |
| sede | varchar(120) | NO |
| departamento | varchar(40) | NO |
| concepto | varchar(200) | NO |
| presupuesto | decimal(16,2) | YES |
| archivo_id | bigint | YES |
| celda_origen | varchar(120) | YES |
| version | int | NO |
| actualizado_por | int | NO |

Indices:
- idx_cont_rubro_conceptos: (periodo, empresa, rubro, moneda).
- PRIMARY: (id) UNIQUE.
- uq_cont_rubro_origen: (archivo_id, celda_origen) UNIQUE.

## cont_rubro_pagos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| registro_id | bigint | NO |
| fecha | date | NO |
| referencia | varchar(120) | NO |
| monto | decimal(16,2) | NO |
| actor | int | NO |
| creado_en | timestamp | NO |

Indices:
- PRIMARY: (id) UNIQUE.
- uq_cont_rubro_pago: (registro_id, referencia) UNIQUE.
- Relacion: registro_id -> cont_rubro_registros.id.

## cont_rubro_registros

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| concepto_id | bigint | NO |
| fecha | date | NO |
| monto | decimal(16,2) | NO |
| proveedor | varchar(180) | NO |
| documento | varchar(120) | NO |
| vencimiento | date | YES |
| observacion | varchar(500) | NO |
| version | int | NO |
| actualizado_por | int | NO |
| actualizado_en | timestamp | NO |

Indices:
- PRIMARY: (id) UNIQUE.
- uq_cont_rubro_registro: (concepto_id) UNIQUE.
- Relacion: concepto_id -> cont_rubro_conceptos.id.

## control_cambios_aceite_programaciones

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 21.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| unidad_id | int | NO |
| kilometros_mes | decimal(10,2) | NO |
| intervalo_km | int | NO |
| fecha_ultimo_cambio | date | NO |
| fecha_proximo_cambio | date | NO |
| observaciones | varchar(500) | YES |
| activo | tinyint(1) | NO |
| creado_por | int | YES |
| actualizado_por | int | YES |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_control_cambios_aceite_actualizado: (actualizado_en).
- idx_control_cambios_aceite_proximo: (fecha_proximo_cambio, activo).
- PRIMARY: (id) UNIQUE.
- uq_control_cambios_aceite_unidad: (unidad_id) UNIQUE.

## correctivo_mecanicos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 206.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| correctivo_id | int | NO |
| mecanico_id | int | NO |

Indices:
- mecanico_id: (mecanico_id).
- PRIMARY: (correctivo_id, mecanico_id) UNIQUE.
- Relacion: correctivo_id -> correctivos.id.
- Relacion: mecanico_id -> mecanicos.id.

## correctivo_trabajos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 463.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| correctivo_id | int | NO |
| mecanico_id | int | NO |
| trabajo | text | YES |
| repuestos | text | YES |
| horas | decimal(5,2) | YES |
| fecha | timestamp | YES |
| repuesto_id | int | YES |
| cantidad_usada | decimal(10,2) | YES |

Indices:
- PRIMARY: (id) UNIQUE.
- repuesto_id: (repuesto_id).
- Relacion: repuesto_id -> repuestos.id.

## correctivos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 818.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| unidad_id | int | NO |
| sede | varchar(20) | NO |
| tipo_mantenimiento | varchar(20) | NO |
| trabajo_realizado | text | NO |
| pendiente | text | YES |
| creado_por | int | NO |
| fecha | timestamp | YES |
| puntos | int | YES |

Indices:
- creado_por: (creado_por).
- PRIMARY: (id) UNIQUE.
- unidad_id: (unidad_id).
- Relacion: unidad_id -> unidades.id.
- Relacion: creado_por -> usuarios.id.

## dekra_control

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 222.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| unidad_id | int | NO |
| sede | varchar(50) | NO |
| mes | varchar(20) | NO |
| estado | enum('PENDIENTE','REALIZADO','NO_REALIZADO') | NO |
| observacion | text | YES |
| fecha_registro | timestamp | YES |
| actualizado_por | int | YES |
| fecha_actualizacion | timestamp | YES |
| negocio | varchar(20) | YES |
| cita_fecha | date | YES |
| cita_hora | time | YES |
| cita_lugar | varchar(200) | YES |
| cita_correos | text | YES |
| estado_segunda | varchar(20) | NO |
| observacion_segunda | text | YES |
| cita_fecha_segunda | date | YES |
| cita_hora_segunda | time | YES |
| cita_lugar_segunda | varchar(200) | YES |
| recordatorio_15d_enviado | tinyint(1) | NO |
| recordatorio_2d_enviado | tinyint(1) | NO |
| recordatorio_15d_segundo_enviado | tinyint(1) | NO |
| recordatorio_2d_segundo_enviado | tinyint(1) | NO |

Indices:
- PRIMARY: (id) UNIQUE.
- unidad_id: (unidad_id).
- Relacion: unidad_id -> unidades.id.

## ejecuciones

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| mantenimiento_id | int | NO |
| realizado_texto | text | YES |
| pendientes_texto | text | YES |
| fecha_ejecucion | timestamp | YES |

Indices:
- fk_ejec_mantenimiento: (mantenimiento_id).
- PRIMARY: (id) UNIQUE.
- Relacion: mantenimiento_id -> mantenimientos.id.

## facturas

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 1241.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| numero_factura | text | YES |
| fecha | date | NO |
| monto | decimal(14,4) | NO |
| proveedor_nombre | varchar(255) | YES |
| pagada | tinyint(1) | YES |
| fecha_pago | date | YES |
| periodo_cierre | char(7) | YES |
| monto_pagado_cierre | decimal(14,4) | YES |
| creado_por | int | YES |
| created_at | timestamp | YES |
| proveedor_id | int | YES |
| nota_credito_numero | varchar(100) | YES |
| nota_credito_fecha | date | YES |
| nota_credito_monto | decimal(14,4) | NO |
| nota_credito_motivo | text | YES |
| factura_fecha_recepcion | date | YES |
| factura_tipo_entrega | varchar(80) | YES |
| factura_entregado_por | varchar(150) | YES |
| factura_recibido_por | varchar(150) | YES |
| factura_producto_recibido | tinyint(1) | NO |
| factura_observacion | text | YES |
| factura_foto_producto | varchar(255) | YES |
| abono_monto | decimal(14,4) | NO |
| abono_fecha | date | YES |
| abono_observacion | text | YES |
| factura_placa_producto | varchar(50) | YES |
| clave_electronica | varchar(80) | YES |
| consecutivo_electronico | varchar(40) | YES |
| estado_hacienda | varchar(40) | NO |
| fecha_aceptacion | datetime | YES |
| comprobante_pago_numero | varchar(120) | YES |
| comprobante_pago_archivo | varchar(255) | YES |

Indices:
- creado_por: (creado_por).
- idx_facturas_clave_electronica: (clave_electronica).
- idx_facturas_consecutivo_electronico: (consecutivo_electronico).
- idx_facturas_cruce_numero_fecha: (numero_factura, fecha).
- idx_facturas_estado_fecha: (pagada, fecha).
- idx_facturas_estado_hacienda: (estado_hacienda).
- idx_facturas_fecha_pago: (fecha_pago).
- idx_facturas_pagadas_fecha_pago: (pagada, fecha_pago).
- idx_facturas_periodo: (periodo_cierre).
- idx_facturas_periodo_cierre: (periodo_cierre).
- idx_facturas_proveedor_fecha: (proveedor_id, fecha).
- PRIMARY: (id) UNIQUE.
- Relacion: creado_por -> usuarios.id.
- Relacion: proveedor_id -> proveedores.id.

## facturas_correo_adjuntos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 1254.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint unsigned | NO |
| mensaje_id | bigint unsigned | NO |
| graph_adjunto_hash | char(64) | NO |
| nombre_archivo | varchar(255) | NO |
| mime_type | varchar(120) | YES |
| ruta_archivo | varchar(255) | NO |
| tipo_documento | enum('XML','PDF') | NO |
| clave_electronica | varchar(80) | YES |
| consecutivo | varchar(40) | YES |
| emisor | varchar(180) | YES |
| fecha_emision | datetime | YES |
| monto | decimal(14,4) | YES |
| creado_en | datetime | NO |

Indices:
- idx_facturas_correo_adjunto_mensaje: (mensaje_id).
- PRIMARY: (id) UNIQUE.
- uq_facturas_correo_adjunto_hash: (graph_adjunto_hash) UNIQUE.
- Relacion: mensaje_id -> facturas_correo_mensajes.id.

## facturas_correo_conexion

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 1.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | tinyint unsigned | NO |
| correo | varchar(255) | NO |
| cuenta_id | varchar(255) | NO |
| token_cache | mediumtext | NO |
| conectado_por | int | YES |
| conectado_en | datetime | NO |
| sincronizado_en | datetime | YES |
| actualizado_en | datetime | NO |

Indices:
- PRIMARY: (id) UNIQUE.

## facturas_correo_mensajes

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 466.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint unsigned | NO |
| graph_id_hash | char(64) | NO |
| graph_id | text | NO |
| internet_message_id | varchar(998) | YES |
| recibido_en | datetime | YES |
| remitente | varchar(255) | YES |
| asunto | text | YES |
| vista_previa | text | YES |
| creado_en | datetime | NO |

Indices:
- idx_facturas_correo_recibido: (recibido_en).
- PRIMARY: (id) UNIQUE.
- uq_facturas_correo_graph_hash: (graph_id_hash) UNIQUE.

## facturas_electronicas_cruce

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 985.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| fecha_emision | datetime | YES |
| clave | varchar(80) | NO |
| consecutivo | varchar(40) | YES |
| cedula_emisor | varchar(30) | YES |
| nombre_emisor | varchar(180) | YES |
| codigo_documento_fe | varchar(60) | YES |
| numero_factura | varchar(100) | YES |
| estado_hacienda | varchar(40) | NO |
| monto_total | decimal(14,4) | NO |
| moneda | varchar(10) | YES |
| detalle_resumen | text | YES |
| fuente_archivo | varchar(255) | YES |
| orden_compra_id | int | YES |
| factura_id | int | YES |
| creado_por | int | YES |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |
| codigos_producto | text | YES |
| criterio_cruce | varchar(120) | YES |

Indices:
- idx_facturas_electronicas_consecutivo: (consecutivo).
- idx_facturas_electronicas_estado: (estado_hacienda).
- idx_facturas_electronicas_factura: (factura_id).
- idx_facturas_electronicas_numero: (numero_factura).
- idx_facturas_electronicas_orden: (orden_compra_id).
- PRIMARY: (id) UNIQUE.
- uq_facturas_electronicas_clave: (clave) UNIQUE.

## gasto_clasificacion_manual

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 29.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| fuente | varchar(30) | NO |
| referencia_id | int | NO |
| detalle_id | int | NO |
| familia_clave | varchar(40) | NO |
| observacion | varchar(255) | YES |
| creado_por | int | YES |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_gasto_clasificacion_manual_familia: (familia_clave).
- PRIMARY: (id) UNIQUE.
- uq_gasto_clasificacion_manual: (fuente, referencia_id, detalle_id) UNIQUE.

## gasto_clasificacion_reglas

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 32.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| patron | varchar(180) | NO |
| familia_clave | varchar(40) | NO |
| aplicar_en | enum('TODO','DESCRIPCION','PROVEEDOR','PLACA') | NO |
| prioridad | int | NO |
| activo | tinyint(1) | NO |
| observacion | varchar(255) | YES |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_gasto_reglas_activo_prioridad: (activo, prioridad).
- PRIMARY: (id) UNIQUE.
- uq_gasto_regla_patron_familia: (patron, familia_clave, aplicar_en) UNIQUE.

## gastos_operativos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 494.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| fuente | varchar(40) | NO |
| fuente_id | bigint | NO |
| detalle_id | bigint | NO |
| fecha | date | NO |
| periodo | char(7) | NO |
| placa | varchar(50) | YES |
| sede | varchar(120) | YES |
| negocio | varchar(80) | YES |
| tipo_unidad | varchar(80) | YES |
| rubro | varchar(80) | NO |
| tipo_trabajo | varchar(30) | NO |
| proveedor | varchar(180) | YES |
| descripcion | text | YES |
| cantidad | decimal(14,4) | NO |
| precio_unitario | decimal(14,4) | NO |
| monto | decimal(14,4) | NO |
| estado | varchar(40) | NO |
| creado_por | int | YES |
| metadata | json | YES |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_gastos_operativos_estado: (estado).
- idx_gastos_operativos_fecha: (fecha).
- idx_gastos_operativos_negocio: (negocio).
- idx_gastos_operativos_periodo: (periodo).
- idx_gastos_operativos_placa: (placa).
- idx_gastos_operativos_rubro: (rubro).
- idx_gastos_operativos_sede: (sede).
- idx_gastos_operativos_tipo_trabajo: (tipo_trabajo).
- PRIMARY: (id) UNIQUE.
- uq_gastos_operativos_fuente: (fuente, fuente_id, detalle_id) UNIQUE.

## giras_taller

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 22.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| sede | varchar(100) | NO |
| fecha | date | NO |
| inspector | varchar(150) | NO |
| estado | enum('ABIERTA','EN_SEGUIMIENTO','CERRADA') | NO |
| orden_limpieza | enum('BIEN','REGULAR','MAL','NA') | NO |
| herramientas | enum('BIEN','REGULAR','MAL','NA') | NO |
| seguridad | enum('BIEN','REGULAR','MAL','NA') | NO |
| repuestos | enum('BIEN','REGULAR','MAL','NA') | NO |
| documentacion | enum('BIEN','REGULAR','MAL','NA') | NO |
| observaciones | text | NO |
| pendientes | text | YES |
| acciones_recomendadas | text | YES |
| creado_por | int | YES |
| creado_en | datetime | NO |
| actualizado_en | datetime | NO |

Indices:
- idx_giras_estado: (estado).
- idx_giras_sede_fecha: (sede, fecha).
- PRIMARY: (id) UNIQUE.

## giras_taller_recomendaciones

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 43.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| gira_id | int | NO |
| sede | varchar(100) | NO |
| placa | varchar(50) | NO |
| recomendacion | text | NO |
| creado_en | datetime | NO |
| tema_mecanico | text | YES |
| tema_estetico | text | YES |

Indices:
- idx_giras_rec_gira: (gira_id).
- idx_giras_rec_sede_placa: (sede, placa).
- PRIMARY: (id) UNIQUE.

## import_facturas_pagadas

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| fecha_solicitud | varchar(50) | YES |
| proveedor_nombre | varchar(255) | YES |
| cuenta_iban | varchar(100) | YES |
| concepto | varchar(255) | YES |
| numero_factura | varchar(100) | YES |
| placa_unidad | varchar(50) | YES |
| monto_a_pagar | varchar(50) | YES |
| partida_presupuestaria | varchar(255) | YES |
| fecha_pago | varchar(50) | YES |

Indices:

## lavado_unidades

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 85.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| numero_lavado | varchar(30) | NO |
| unidad_id | int | NO |
| placa | varchar(80) | NO |
| sede | varchar(100) | NO |
| fecha | date | NO |
| semana_inicio | date | YES |
| observaciones | text | YES |
| creado_por | int | YES |
| creado_en | datetime | NO |

Indices:
- idx_lavado_fecha: (fecha).
- idx_lavado_sede_fecha: (sede, fecha).
- idx_lavado_unidad_fecha: (unidad_id, fecha).
- numero_lavado: (numero_lavado) UNIQUE.
- PRIMARY: (id) UNIQUE.
- uq_lavado_unidad_semana: (unidad_id, semana_inicio) UNIQUE.
- Relacion: unidad_id -> unidades.id.

## lavado_unidades_fotos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 413.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| lavado_id | int | NO |
| angulo_clave | varchar(80) | NO |
| angulo_nombre | varchar(120) | NO |
| foto_nombre | varchar(255) | YES |
| foto_tipo | varchar(100) | YES |
| foto_base64 | longtext | NO |
| foto_hash | char(64) | NO |
| creado_en | datetime | NO |

Indices:
- idx_lavado_fotos_lavado: (lavado_id).
- PRIMARY: (id) UNIQUE.
- uk_lavado_foto_hash: (foto_hash) UNIQUE.
- Relacion: lavado_id -> lavado_unidades.id.

## logistica_taller

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 293.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| fecha | date | NO |
| prioridad_id | int | YES |
| unidad_id | int | YES |
| placa | varchar(50) | NO |
| sede | varchar(100) | YES |
| detalle_malo | text | YES |
| tipo_mantenimiento | varchar(20) | NO |
| estado | enum('PENDIENTE','EN_PROCESO','LISTO','DESCARTADO') | NO |
| creado_por | int | YES |
| actualizado_por | int | YES |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_logistica_estado: (estado).
- idx_logistica_fecha: (fecha).
- idx_logistica_placa: (placa).
- idx_logistica_sede: (sede).
- idx_logistica_tipo: (tipo_mantenimiento).
- PRIMARY: (id) UNIQUE.
- uq_logistica_prioridad: (prioridad_id) UNIQUE.

## mantenimiento_mecanicos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 2016.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| mantenimiento_id | int | NO |
| mecanico_id | int | NO |

Indices:
- mecanico_id: (mecanico_id).
- PRIMARY: (mantenimiento_id, mecanico_id) UNIQUE.
- Relacion: mantenimiento_id -> mantenimientos.id.
- Relacion: mecanico_id -> mecanicos.id.

## mantenimientos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 1688.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| numero_mantenimiento | varchar(30) | YES |
| unidad_id | int | NO |
| fecha_programada | date | NO |
| tipo | enum('PREVENTIVO','CORRECTIVO') | NO |
| prioridad | enum('BAJA','MEDIA','ALTA') | YES |
| estado | varchar(20) | YES |
| creado_en | timestamp | YES |
| plan | text | YES |
| ejecucion | text | YES |
| pendiente | text | YES |
| fecha_cierre | datetime | YES |
| pendientes | text | YES |
| sede | varchar(20) | NO |
| creado_por_rol | varchar(50) | YES |
| creado_por | int | YES |

Indices:
- fk_mant_unidad: (unidad_id).
- idx_mant_estado: (estado).
- idx_mant_estado_fecha_unidad: (estado, fecha_programada, unidad_id).
- idx_mant_fecha: (fecha_programada).
- idx_mantenimientos_numero: (numero_mantenimiento).
- PRIMARY: (id) UNIQUE.
- Relacion: unidad_id -> unidades.id.

## mecanicos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 41.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| nombre | varchar(100) | NO |
| sede | varchar(20) | NO |
| activo | tinyint(1) | YES |

Indices:
- PRIMARY: (id) UNIQUE.

## minae_excel_temp

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| unidad | varchar(50) | YES |
| cr | varchar(50) | YES |
| vencimiento | date | YES |
| empresa | varchar(150) | YES |
| tipo | varchar(50) | YES |
| cedi | varchar(50) | YES |
| mes | varchar(30) | YES |

Indices:

## minae_tramites

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 119.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| unidad_id | int | NO |
| sede | varchar(100) | NO |
| tipo | varchar(100) | NO |
| cr | varchar(100) | YES |
| estado | varchar(100) | YES |
| fecha_envio | date | YES |
| vencimiento | date | YES |
| presentacion | date | YES |
| subsane | date | YES |
| ot | varchar(100) | YES |
| empresa | varchar(150) | YES |
| lugar | varchar(150) | YES |
| hora | varchar(50) | YES |
| observacion | text | YES |
| creado_por | int | YES |
| actualizado_por | int | YES |
| created_at | timestamp | YES |
| updated_at | timestamp | YES |
| negocio | varchar(50) | YES |
| tiene_cita | tinyint(1) | YES |
| fecha_cita | date | YES |
| hora_cita | varchar(20) | YES |
| lugar_cita | varchar(150) | YES |
| mes | varchar(30) | YES |
| anio | int | YES |
| recordatorio_15d_enviado | tinyint(1) | YES |
| recordatorio_2d_enviado | tinyint(1) | YES |
| email_notificacion | varchar(255) | YES |

Indices:
- PRIMARY: (id) UNIQUE.
- unidad_id: (unidad_id).
- Relacion: unidad_id -> unidades.id.

## oficina_dia_dia

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 8.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| fecha | date | NO |
| nombre_persona | varchar(150) | NO |
| actividad | text | NO |
| sede | varchar(100) | YES |
| creado_por | int | YES |
| creado_en | timestamp | YES |

Indices:
- idx_oficina_fecha: (fecha).
- idx_oficina_sede: (sede).
- PRIMARY: (id) UNIQUE.

## ordenes_compra

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 2014.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| po_numero | varchar(50) | NO |
| fecha | date | NO |
| proveedor_id | int | NO |
| forma_pago | varchar(100) | YES |
| moneda | enum('CRC','USD') | YES |
| subtotal | decimal(12,2) | YES |
| descuento | decimal(12,2) | YES |
| transporte | decimal(12,2) | YES |
| iva | decimal(12,2) | YES |
| total | decimal(12,2) | YES |
| observaciones | text | YES |
| estado | enum('BORRADOR','ENVIADA','RECIBIDA_PARCIAL','RECIBIDA_TOTAL','ANULADA') | YES |
| creado_por | int | YES |
| fecha_creacion | timestamp | YES |
| empresa_destino | enum('GAS TOMZA','SUPER GAS') | YES |
| factura | text | YES |
| facturada | tinyint(1) | YES |
| fecha_vencimiento_factura | date | YES |
| pagada | tinyint(1) | YES |
| fecha_pago | date | YES |
| periodo_cierre | char(7) | YES |
| monto_pagado_cierre | decimal(14,4) | YES |
| nota_credito_numero | varchar(100) | YES |
| nota_credito_fecha | date | YES |
| nota_credito_monto | decimal(12,2) | NO |
| nota_credito_motivo | text | YES |
| factura_fecha | date | YES |
| factura_fecha_recepcion | date | YES |
| factura_tipo_entrega | varchar(80) | YES |
| factura_entregado_por | varchar(150) | YES |
| factura_recibido_por | varchar(150) | YES |
| factura_producto_recibido | tinyint(1) | NO |
| factura_observacion | text | YES |
| factura_foto_producto | varchar(255) | YES |
| abono_monto | decimal(12,2) | NO |
| abono_fecha | date | YES |
| abono_observacion | text | YES |
| factura_placa_producto | varchar(50) | YES |
| placa_unidad | varchar(50) | YES |
| tipo_mantenimiento | varchar(20) | NO |
| cotizacion_archivo | varchar(255) | YES |
| cotizacion_nombre | varchar(255) | YES |
| cotizacion_tipo | varchar(100) | YES |
| factura_clave_electronica | varchar(80) | YES |
| factura_consecutivo_electronico | varchar(40) | YES |
| factura_estado_hacienda | varchar(40) | NO |
| factura_fecha_aceptacion | datetime | YES |
| comprobante_pago_numero | varchar(120) | YES |
| comprobante_pago_archivo | varchar(255) | YES |

Indices:
- creado_por: (creado_por).
- idx_ordenes_compra_periodo_cierre: (periodo_cierre).
- idx_ordenes_cruce_factura_fecha: (factura, factura_fecha).
- idx_ordenes_cruce_facturacion: (facturada, fecha, proveedor_id, total).
- idx_ordenes_factura_clave_electronica: (factura_clave_electronica).
- idx_ordenes_factura_consecutivo_electronico: (factura_consecutivo_electronico).
- idx_ordenes_factura_estado_hacienda: (factura_estado_hacienda).
- idx_ordenes_facturas_estado_fecha: (facturada, pagada, factura_fecha, fecha).
- idx_ordenes_facturas_periodo: (periodo_cierre).
- idx_ordenes_facturas_proveedor_fecha: (proveedor_id, factura_fecha, fecha).
- idx_ordenes_facturas_vencimiento: (facturada, pagada, fecha_vencimiento_factura).
- idx_ordenes_pagadas_fecha_pago: (facturada, pagada, fecha_pago).
- po_numero: (po_numero) UNIQUE.
- PRIMARY: (id) UNIQUE.
- Relacion: proveedor_id -> proveedores.id.
- Relacion: creado_por -> usuarios.id.

## ordenes_compra_detalle

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 4660.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| orden_compra_id | int | NO |
| codigo | varchar(100) | YES |
| codigo_producto | varchar(80) | YES |
| descripcion | text | NO |
| cantidad | int | NO |
| precio_unitario | decimal(12,2) | YES |
| subtotal | decimal(12,2) | YES |

Indices:
- idx_ordenes_detalle_cruce_producto: (orden_compra_id, codigo_producto).
- PRIMARY: (id) UNIQUE.
- Relacion: orden_compra_id -> ordenes_compra.id.

## ordenes_motor

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 15.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| numero | varchar(30) | NO |
| fecha | date | NO |
| proveedor_id | int | YES |
| placa_unidad | varchar(50) | YES |
| tipo_mantenimiento | varchar(20) | NO |
| motor | varchar(100) | YES |
| moneda | varchar(10) | NO |
| subtotal | decimal(14,2) | NO |
| iva | decimal(14,2) | NO |
| total | decimal(14,2) | NO |
| observaciones | text | YES |
| estado | varchar(40) | NO |
| pagada | tinyint(1) | NO |
| fecha_pago | date | YES |
| periodo_cierre | char(7) | YES |
| monto_pagado_cierre | decimal(14,4) | YES |
| creado_por | int | YES |
| creado_en | timestamp | YES |
| forma_pago | varchar(100) | YES |
| descuento | decimal(10,2) | NO |
| transporte | decimal(14,2) | NO |
| cotizacion_archivo | varchar(255) | YES |
| cotizacion_nombre | varchar(255) | YES |
| cotizacion_tipo | varchar(100) | YES |
| empresa_destino | varchar(80) | NO |

Indices:
- idx_motor_estado: (estado).
- idx_motor_fecha: (fecha).
- idx_motor_placa: (placa_unidad).
- numero: (numero) UNIQUE.
- PRIMARY: (id) UNIQUE.

## ordenes_motor_detalle

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 41.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| orden_motor_id | int | NO |
| descripcion | varchar(255) | NO |
| cantidad | decimal(12,2) | NO |
| precio_unitario | decimal(14,2) | NO |
| subtotal | decimal(14,2) | NO |
| codigo | varchar(80) | YES |

Indices:
- idx_motor_detalle_orden: (orden_motor_id).
- PRIMARY: (id) UNIQUE.
- Relacion: orden_motor_id -> ordenes_motor.id.

## pagos_proveedor

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 229.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| empresa | varchar(80) | NO |
| fecha_solicitud | date | YES |
| proveedor_nombre | varchar(180) | NO |
| cuenta_iban | varchar(60) | YES |
| concepto | text | YES |
| numero_factura | varchar(100) | YES |
| placa | varchar(50) | YES |
| monto | decimal(14,4) | NO |
| partida_presupuestaria | varchar(150) | YES |
| pagada | tinyint(1) | NO |
| fecha_pago | date | YES |
| periodo_cierre | char(7) | YES |
| monto_pagado_cierre | decimal(14,4) | YES |
| archivo_nombre | varchar(255) | YES |
| creado_por | int | YES |
| creado_en | timestamp | NO |

Indices:
- idx_pagos_proveedor_empresa: (empresa).
- idx_pagos_proveedor_fecha: (fecha_solicitud).
- idx_pagos_proveedor_periodo_cierre: (periodo_cierre).
- idx_pagos_proveedor_placa: (placa).
- idx_pagos_proveedor_proveedor: (proveedor_nombre).
- PRIMARY: (id) UNIQUE.

## palabras_clave_trabajo

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 11.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| palabra | varchar(50) | YES |
| puntos | int | YES |

Indices:
- PRIMARY: (id) UNIQUE.

## planes_taller

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| mantenimiento_id | int | NO |
| plan_texto | text | NO |
| creado_en | timestamp | YES |

Indices:
- fk_plan_mantenimiento: (mantenimiento_id).
- PRIMARY: (id) UNIQUE.
- Relacion: mantenimiento_id -> mantenimientos.id.

## portal_departamento_config

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 1.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | tinyint | NO |
| asignacion_inicial_completa | tinyint(1) | NO |

Indices:
- PRIMARY: (id) UNIQUE.

## preventivos_programaciones

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 226.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| unidad_id | int | NO |
| fecha_inicio | date | NO |
| intervalo_semanas | int | NO |
| plan | text | YES |
| activa | tinyint(1) | NO |
| procesada_hasta | date | NO |
| version | int | NO |
| creado_por | int | YES |
| actualizado_por | int | YES |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_preventivos_programaciones_pendientes: (activa, procesada_hasta).
- PRIMARY: (id) UNIQUE.
- uq_preventivos_programaciones_unidad: (unidad_id) UNIQUE.

## prov_adjuntos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 6.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| nombre | varchar(120) | NO |
| mime | varchar(50) | NO |
| contenido | longblob | NO |
| creado_en | timestamp | NO |

Indices:
- PRIMARY: (id) UNIQUE.

## prov_alertas

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 2.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| usuario_id | int | YES |
| grupo | varchar(30) | YES |
| mensaje | varchar(500) | NO |
| documento_id | int | NO |
| creado_en | timestamp | NO |

Indices:
- idx_prov_alertas_destino: (usuario_id, grupo, id).
- PRIMARY: (id) UNIQUE.

## prov_auditoria

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 21.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| documento_id | int | NO |
| actor | varchar(120) | NO |
| accion | varchar(100) | NO |
| creado_en | timestamp | NO |

Indices:
- PRIMARY: (id) UNIQUE.

## prov_documentos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 7.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| tipo | varchar(20) | NO |
| usuario_id | int | NO |
| sede | varchar(100) | NO |
| datos | json | NO |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_prov_tipo: (tipo, id).
- PRIMARY: (id) UNIQUE.

## prov_facturas_claves

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 2.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| clave | char(50) | NO |
| documento_id | int | NO |
| creado_en | timestamp | NO |

Indices:
- idx_prov_facturas_documento: (documento_id).
- PRIMARY: (clave) UNIQUE.

## prov_inventario

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 17.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| sede | varchar(100) | NO |
| codigo | varchar(80) | NO |
| descripcion | varchar(255) | NO |
| iva | decimal(5,2) | NO |
| cantidad | decimal(14,3) | NO |

Indices:
- PRIMARY: (sede, codigo) UNIQUE.

## prov_inventario_fichas

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 17.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| sede | varchar(100) | NO |
| codigo | varchar(80) | NO |
| grupo | varchar(20) | NO |
| tipo | varchar(20) | NO |
| categoria | varchar(100) | NO |
| unidad | varchar(30) | NO |
| ubicacion | varchar(120) | NO |
| stock_minimo | decimal(14,3) | NO |
| stock_maximo | decimal(14,3) | NO |
| proveedor | varchar(255) | NO |

Indices:
- PRIMARY: (sede, codigo) UNIQUE.

## prov_inventario_movimientos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 11.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| sede | varchar(100) | NO |
| codigo | varchar(80) | NO |
| descripcion | varchar(255) | NO |
| tipo | varchar(30) | NO |
| cantidad | decimal(14,3) | NO |
| existencia_anterior | decimal(14,3) | NO |
| existencia_nueva | decimal(14,3) | NO |
| documento_id | int | YES |
| usuario_id | int | NO |
| motivo | varchar(500) | NO |
| creado_en | timestamp | NO |

Indices:
- idx_prov_mov_articulo: (sede, codigo, id).
- idx_prov_mov_sede: (sede, id).
- PRIMARY: (id) UNIQUE.

## prov_portal_cuentas

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 21.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| proveedor_id | int | NO |
| email | varchar(254) | NO |
| cedula | varchar(12) | NO |
| password_hash | varchar(100) | NO |
| plazo_dias | int | NO |
| activo | tinyint(1) | NO |
| version_acceso | int | NO |
| creado_en | timestamp | NO |

Indices:
- cedula: (cedula) UNIQUE.
- email: (email) UNIQUE.
- PRIMARY: (id) UNIQUE.
- proveedor_id: (proveedor_id) UNIQUE.

## prov_portal_factura_orden

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| factura_id | int | NO |
| origen | enum('PROVEEDURIA','COMPRAS') | NO |
| orden_id | int | NO |
| monto | decimal(14,5) | NO |
| moneda | varchar(10) | NO |
| vinculado_por | int | NO |
| creado_en | timestamp | NO |

Indices:
- idx_portal_factura_orden: (origen, orden_id).
- PRIMARY: (factura_id) UNIQUE.
- Relacion: factura_id -> prov_documentos.id.

## prov_portal_recepciones_compras

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| orden_id | int | NO |
| referencia | varchar(100) | NO |
| lineas | json | NO |
| actor | int | NO |
| creado_en | timestamp | NO |

Indices:
- idx_portal_recepcion_orden: (orden_id).
- PRIMARY: (id) UNIQUE.
- uq_portal_recepcion: (orden_id, referencia) UNIQUE.

## prov_portal_receptores

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 2.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| cedula | varchar(12) | NO |
| nombre | varchar(255) | NO |
| activo | tinyint(1) | NO |

Indices:
- PRIMARY: (cedula) UNIQUE.

## prov_proveedor_contactos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 94.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| clave | varchar(255) | NO |
| telefono | varchar(120) | NO |
| correos | json | NO |
| correo_original | varchar(500) | NO |
| direccion | text | NO |
| condicion_pago | varchar(10) | YES |
| actualizado_en | timestamp | NO |

Indices:
- PRIMARY: (clave) UNIQUE.

## prov_proveedores

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 102.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| nombre | varchar(255) | NO |
| clave | varchar(255) | NO |
| activo | tinyint(1) | NO |
| creado_en | timestamp | NO |

Indices:
- clave: (clave) UNIQUE.
- PRIMARY: (id) UNIQUE.

## proveedores

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 52.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| nombre | varchar(255) | NO |
| direccion | text | YES |
| telefono | varchar(50) | YES |
| email | varchar(255) | YES |
| contacto | varchar(255) | YES |
| activo | tinyint | YES |
| cedula_juridica | varchar(50) | YES |

Indices:
- idx_proveedores_nombre: (nombre).
- PRIMARY: (id) UNIQUE.

## push_subscriptions

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 757.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| usuario_id | int | YES |
| usuario | varchar(100) | YES |
| rol | varchar(50) | YES |
| sede | varchar(100) | YES |
| endpoint | text | NO |
| p256dh | text | NO |
| auth | text | NO |
| activo | tinyint(1) | NO |
| ultimo_envio | date | YES |
| creado_en | timestamp | YES |
| actualizado_en | timestamp | YES |

Indices:
- idx_push_activo: (activo).
- idx_push_sede: (sede).
- PRIMARY: (id) UNIQUE.
- uq_push_endpoint: (endpoint) UNIQUE.

## recepciones_compra

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| orden_compra_id | int | NO |
| fecha_recepcion | date | NO |
| cantidad_recibida | int | YES |
| observaciones | text | YES |

Indices:
- orden_compra_id: (orden_compra_id).
- PRIMARY: (id) UNIQUE.
- Relacion: orden_compra_id -> ordenes_compra.id.

## reintegros_gastos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 27.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| fecha | date | NO |
| entregado_a | varchar(180) | NO |
| numero_factura | varchar(100) | NO |
| monto | decimal(14,2) | NO |
| observacion | text | YES |
| creado_por | int | YES |
| creado_en | timestamp | NO |

Indices:
- idx_reintegros_gastos_entregado_a: (entregado_a).
- idx_reintegros_gastos_factura: (numero_factura).
- idx_reintegros_gastos_fecha: (fecha).
- PRIMARY: (id) UNIQUE.

## reportes_supervisores

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 685.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| unidad_id | int | NO |
| sede | varchar(100) | NO |
| supervisor_id | int | YES |
| supervisor_nombre | varchar(150) | YES |
| descripcion_original | text | NO |
| descripcion_limpia | text | YES |
| nota_taller | text | YES |
| importante | tinyint(1) | NO |
| estado | enum('PENDIENTE','EN_REVISION','HISTORIAL','DESCARTADO') | NO |
| fecha_reporte | datetime | NO |
| semana_reporte | date | YES |
| tipo_mantenimiento | varchar(20) | NO |
| actualizado_en | datetime | YES |
| cerrado_por | int | YES |
| fecha_cierre | datetime | YES |
| correctivo_id | int | YES |
| mantenimiento_id | int | YES |
| cierre_motivo | text | YES |
| cierre_confianza | decimal(5,2) | YES |

Indices:
- idx_reportes_correctivo: (correctivo_id).
- idx_reportes_estado_sede: (estado, sede).
- idx_reportes_unidad_estado: (unidad_id, estado).
- PRIMARY: (id) UNIQUE.

## reportes_supervisores_sugerencias

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 274.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| reporte_id | int | NO |
| correctivo_id | int | NO |
| confianza | decimal(5,2) | NO |
| motivo | text | YES |
| estado | enum('PENDIENTE','CONFIRMADA','DESCARTADA') | NO |
| creado_en | datetime | NO |
| resuelto_por | int | YES |
| resuelto_en | datetime | YES |

Indices:
- idx_sugerencias_correctivo: (correctivo_id).
- idx_sugerencias_estado: (estado).
- PRIMARY: (id) UNIQUE.
- uq_reporte_correctivo: (reporte_id, correctivo_id) UNIQUE.

## repuestos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| codigo | varchar(100) | YES |
| nombre | varchar(255) | NO |
| descripcion | text | YES |
| stock_actual | decimal(10,2) | YES |
| stock_minimo | decimal(10,2) | YES |
| unidad_medida | varchar(50) | YES |
| precio_compra | decimal(12,2) | YES |
| proveedor_id | int | YES |

Indices:
- codigo: (codigo) UNIQUE.
- PRIMARY: (id) UNIQUE.
- proveedor_id: (proveedor_id).
- Relacion: proveedor_id -> proveedores.id.

## repuestos_semanales

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 386.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| fecha | date | NO |
| sede | varchar(100) | NO |
| placa | varchar(80) | NO |
| solicitud | text | NO |
| marcado_rojo | text | YES |
| no_compra | text | YES |
| estado | enum('PENDIENTE','LLEGANDO','NO_COMPRA','COMPLETO') | NO |
| creado_por | int | YES |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_repuestos_semanales_estado: (estado).
- idx_repuestos_semanales_fecha: (fecha).
- idx_repuestos_semanales_placa: (placa).
- idx_repuestos_semanales_sede: (sede).
- PRIMARY: (id) UNIQUE.

## respaldo_pagos_julio_emily

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| empresa | varchar(80) | NO |
| fecha_solicitud | date | YES |
| proveedor_nombre | varchar(180) | NO |
| cuenta_iban | varchar(60) | YES |
| concepto | text | YES |
| numero_factura | varchar(100) | YES |
| placa | varchar(50) | YES |
| monto | decimal(14,2) | NO |
| partida_presupuestaria | varchar(150) | YES |
| pagada | tinyint(1) | NO |
| fecha_pago | date | YES |
| periodo_cierre | char(7) | YES |
| archivo_nombre | varchar(255) | YES |
| creado_por | int | YES |
| creado_en | timestamp | NO |

Indices:

## revisiones_ruta

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 2738.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| unidad_id | int | NO |
| sede | varchar(100) | NO |
| fecha | date | NO |
| turno | varchar(50) | YES |
| kilometraje | int | YES |
| apto_ruta | tinyint(1) | NO |
| observaciones_generales | text | YES |
| creado_por | int | YES |
| creado_en | datetime | NO |
| foto_nombre | varchar(255) | YES |
| foto_tipo | varchar(100) | YES |
| foto_base64 | longtext | YES |

Indices:
- idx_revision_ruta_fecha: (fecha).
- idx_revision_ruta_sede_fecha: (sede, fecha).
- idx_revision_ruta_unidad_fecha: (unidad_id, fecha).
- PRIMARY: (id) UNIQUE.

## revisiones_ruta_detalle

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 33025.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| revision_id | int | NO |
| item_clave | varchar(80) | NO |
| item_nombre | varchar(150) | NO |
| estado | enum('BIEN','REGULAR','MAL','NO_APLICA') | NO |
| observacion | text | YES |
| foto_nombre | varchar(255) | YES |
| foto_tipo | varchar(100) | YES |
| foto_base64 | longtext | YES |

Indices:
- idx_revision_ruta_detalle_estado: (estado).
- idx_revision_ruta_detalle_revision: (revision_id).
- PRIMARY: (id) UNIQUE.

## schema_migrations

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 74.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| filename | varchar(255) | NO |
| checksum | char(64) | NO |
| executed_at | timestamp | NO |

Indices:
- filename: (filename) UNIQUE.
- PRIMARY: (id) UNIQUE.

## sessions

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 244.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| session_id | varchar(128) | NO |
| expires | int unsigned | NO |
| data | text | YES |

Indices:
- PRIMARY: (session_id) UNIQUE.

## solicitudes_llantas

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 178.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| unidad_id | int | YES |
| placa | varchar(50) | NO |
| sede | varchar(100) | NO |
| medida | varchar(100) | NO |
| cantidad | int | NO |
| posicion | varchar(100) | YES |
| marca_sugerida | varchar(100) | YES |
| motivo | text | YES |
| observaciones | text | YES |
| estado | varchar(30) | NO |
| proveedor | varchar(150) | YES |
| precio_unitario | decimal(12,2) | YES |
| monto_total | decimal(12,2) | YES |
| cotizacion_notas | text | YES |
| solicitado_por | int | YES |
| cotizado_por | int | YES |
| comprado_por | int | YES |
| recibido_por | int | YES |
| fecha_solicitud | datetime | NO |
| fecha_cotizada | datetime | YES |
| fecha_comprada | datetime | YES |
| fecha_recibida | datetime | YES |

Indices:
- idx_fecha: (fecha_solicitud).
- idx_sede_estado: (sede, estado).
- idx_unidad: (unidad_id).
- PRIMARY: (id) UNIQUE.
- Relacion: unidad_id -> unidades.id.

## solicitudes_llantas_historial

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 229.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| solicitud_id | int | NO |
| estado_anterior | varchar(30) | YES |
| estado_nuevo | varchar(30) | NO |
| comentario | text | YES |
| usuario_id | int | YES |
| fecha | datetime | NO |

Indices:
- idx_solicitud: (solicitud_id).
- PRIMARY: (id) UNIQUE.
- Relacion: solicitud_id -> solicitudes_llantas.id.

## solicitudes_repuestos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 708.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| fecha_solicitud | date | NO |
| sede | varchar(100) | NO |
| placa | varchar(50) | NO |
| solicitado_por | varchar(150) | NO |
| repuesto_solicitado | text | NO |
| cantidad | decimal(10,2) | NO |
| prioridad | enum('BAJA','MEDIA','ALTA') | NO |
| estado | enum('PENDIENTE_COMPRAR','PEDIDO','EN_TRANSITO','ENTREGADO') | NO |
| proveedor_id | int | YES |
| proveedor | varchar(180) | YES |
| llegando_detalle | text | YES |
| llegando_actualizado_en | datetime | YES |
| creado_por | int | YES |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |
| entregado_por | varchar(150) | YES |
| recibido_por | varchar(150) | YES |
| entregado_en | datetime | YES |
| salida_en | datetime | YES |

Indices:
- idx_repuestos_estado: (estado).
- idx_repuestos_fecha: (fecha_solicitud).
- idx_repuestos_placa: (placa).
- idx_repuestos_sede: (sede).
- PRIMARY: (id) UNIQUE.

## supervisor_rutas_movimientos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 385.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| asignacion_id | int | NO |
| accion | varchar(30) | NO |
| semana_inicio | date | NO |
| sede_anterior | varchar(100) | YES |
| sede_nueva | varchar(100) | YES |
| ruta_anterior | varchar(150) | YES |
| ruta_nueva | varchar(150) | YES |
| chofer_anterior | varchar(180) | YES |
| chofer_nuevo | varchar(180) | YES |
| unidad_id_anterior | int | YES |
| placa_reportada_anterior | varchar(30) | YES |
| unidad_id_nueva | int | YES |
| placa_reportada_nueva | varchar(30) | YES |
| observacion_anterior | varchar(255) | YES |
| observacion_nueva | varchar(255) | YES |
| motivo | varchar(255) | YES |
| cambiado_por | int | YES |
| cambiado_por_nombre | varchar(180) | YES |
| cambiado_en | timestamp | NO |

Indices:
- idx_supervisor_rutas_mov_asignacion: (asignacion_id, cambiado_en).
- idx_supervisor_rutas_mov_semana: (semana_inicio, cambiado_en).
- PRIMARY: (id) UNIQUE.

## supervisor_rutas_semanales

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 373.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| semana_inicio | date | NO |
| sede | varchar(100) | NO |
| ruta | varchar(150) | NO |
| chofer | varchar(180) | NO |
| unidad_id | int | YES |
| placa_reportada | varchar(30) | YES |
| identificador | varchar(80) | NO |
| observacion | varchar(255) | YES |
| supervisor_id | int | YES |
| supervisor_nombre | varchar(180) | YES |
| activo | tinyint(1) | NO |
| creado_en | timestamp | NO |
| actualizado_en | timestamp | NO |

Indices:
- idx_supervisor_rutas_chofer: (chofer, semana_inicio).
- idx_supervisor_rutas_semana_sede: (semana_inicio, sede, activo).
- PRIMARY: (id) UNIQUE.
- uk_supervisor_ruta_unidad_semana: (semana_inicio, sede, ruta, identificador) UNIQUE.

## taller_presupuestos_mensuales

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 2.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| periodo | char(7) | NO |
| monto | decimal(14,2) | NO |
| observacion | varchar(255) | YES |
| actualizado_por | int | YES |
| actualizado_en | timestamp | NO |

Indices:
- PRIMARY: (periodo) UNIQUE.

## taller_prioridades

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 587.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| placa | varchar(50) | NO |
| sede | varchar(80) | YES |
| fecha_prioridad | date | YES |
| observacion | text | NO |
| estado | enum('PENDIENTE','ATENDIDA') | NO |
| mostrar_operativos | tinyint(1) | NO |
| creado_por | int | YES |
| creado_en | timestamp | NO |
| atendido_por | int | YES |
| atendido_en | datetime | YES |

Indices:
- idx_taller_prioridades_creado: (creado_en).
- idx_taller_prioridades_estado: (estado).
- idx_taller_prioridades_sede: (sede).
- PRIMARY: (id) UNIQUE.

## trabajos_taller_sin_placa

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| sede | varchar(100) | NO |
| observacion | text | NO |
| pendiente | text | YES |
| creado_por | int | NO |
| fecha | timestamp | NO |

Indices:
- idx_trabajo_sin_placa_creado_por: (creado_por).
- idx_trabajo_sin_placa_sede_fecha: (sede, fecha).
- PRIMARY: (id) UNIQUE.
- Relacion: creado_por -> usuarios.id.

## trabajos_taller_sin_placa_mecanicos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 2.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| trabajo_sin_placa_id | int | NO |
| mecanico_id | int | NO |
| trabajo | text | YES |
| repuestos | text | YES |

Indices:
- idx_trabajo_sin_placa_mecanico: (mecanico_id).
- PRIMARY: (id) UNIQUE.
- uq_trabajo_sin_placa_mecanico: (trabajo_sin_placa_id, mecanico_id) UNIQUE.
- Relacion: trabajo_sin_placa_id -> trabajos_taller_sin_placa.id.
- Relacion: mecanico_id -> mecanicos.id.

## unidades

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 227.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| placa | varchar(20) | NO |
| sede | varchar(50) | NO |
| marca | varchar(100) | YES |
| modelo | varchar(120) | YES |
| motor | varchar(120) | YES |
| anio | int | YES |
| activa | tinyint(1) | YES |
| negocio | varchar(20) | YES |
| varada | tinyint(1) | NO |
| razon_varada | text | YES |
| comodin | tinyint(1) | NO |

Indices:
- idx_unidad_placa: (placa).
- placa: (placa) UNIQUE.
- PRIMARY: (id) UNIQUE.

## unidades_sede_historial

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 93.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| unidad_id | int | NO |
| placa | varchar(80) | NO |
| sede_anterior | varchar(100) | YES |
| sede_nueva | varchar(100) | NO |
| usuario_id | int | YES |
| usuario_nombre | varchar(120) | YES |
| creado_en | timestamp | NO |

Indices:
- idx_placa_fecha: (placa, creado_en).
- idx_sede_nueva: (sede_nueva).
- idx_unidad_fecha: (unidad_id, creado_en).
- PRIMARY: (id) UNIQUE.
- Relacion: unidad_id -> unidades.id.

## usuario_cedulas

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 59.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | bigint | NO |
| cedula | varchar(20) | NO |
| usuario_id | int | NO |
| persona_nombre | varchar(150) | NO |
| codigo_trabajador | varchar(30) | YES |
| pin_hash | varchar(100) | YES |
| requiere_cambio_pin | tinyint(1) | NO |
| perfil_excel | varchar(80) | NO |
| creado_en | timestamp | NO |

Indices:
- idx_usuario_cedulas_cedula: (cedula).
- idx_usuario_cedulas_usuario: (usuario_id).
- PRIMARY: (id) UNIQUE.
- uq_usuario_cedulas_cuenta: (cedula, usuario_id) UNIQUE.
- Relacion: usuario_id -> usuarios.id.

## usuario_correo_conexiones

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 0.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| usuario_id | int | NO |
| correo | varchar(254) | NO |
| cuenta_id | varchar(255) | NO |
| token_cache | longtext | NO |
| conectado_en | timestamp | NO |

Indices:
- PRIMARY: (usuario_id) UNIQUE.

## usuario_departamentos

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 47.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| usuario_id | int | NO |
| departamento | varchar(40) | NO |
| es_principal | tinyint(1) | NO |
| asignado_en | timestamp | NO |

Indices:
- idx_usuario_departamentos_departamento: (departamento).
- PRIMARY: (usuario_id, departamento) UNIQUE.

## usuarios

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 48.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| nombre | varchar(100) | NO |
| usuario | varchar(50) | NO |
| password | varchar(255) | NO |
| rol | varchar(20) | NO |
| creado_en | timestamp | YES |
| sede | varchar(50) | YES |
| email | varchar(100) | YES |
| cedula | varchar(20) | YES |
| requiere_cambio_password | tinyint(1) | NO |

Indices:
- PRIMARY: (id) UNIQUE.
- uq_usuarios_cedula: (cedula) UNIQUE.
- usuario: (usuario) UNIQUE.

## usuarios_sedes

Motor: InnoDB. Cotejamiento: utf8mb4_0900_ai_ci. Filas estimadas: 36.

| Columna | Tipo SQL | Permite nulos |
|---|---|---|
| id | int | NO |
| usuario_id | int | NO |
| sede | varchar(100) | NO |

Indices:
- PRIMARY: (id) UNIQUE.
