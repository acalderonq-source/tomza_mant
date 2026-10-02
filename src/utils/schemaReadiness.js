async function verificarColumnasRequeridas(query, columnasRequeridas) {
  const tablas = Object.keys(columnasRequeridas);
  if (!tablas.length) return { listo: true, faltantes: [] };

  const placeholders = tablas.map(() => "?").join(", ");
  const [filas] = await query(
    `SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    tablas
  );

  const existentes = new Set(filas.map(fila => `${fila.tabla}.${fila.columna}`.toLowerCase()));
  const faltantes = tablas.flatMap(tabla =>
    columnasRequeridas[tabla]
      .filter(columna => !existentes.has(`${tabla}.${columna}`.toLowerCase()))
      .map(columna => ({ tabla, columna }))
  );

  return { listo: faltantes.length === 0, faltantes };
}

const COLUMNAS_ESENCIALES_TALLER = {
  unidades: ["id", "placa", "sede", "activa", "varada", "comodin"],
  mantenimientos: ["id", "unidad_id", "fecha_programada", "tipo", "prioridad", "estado", "plan", "ejecucion", "pendiente"],
  mantenimiento_mecanicos: ["mantenimiento_id", "mecanico_id"],
  correctivos: ["id", "unidad_id", "sede", "tipo_mantenimiento", "trabajo_realizado", "pendiente", "fecha"],
  correctivo_trabajos: ["correctivo_id", "mecanico_id", "trabajo", "repuestos"],
  mecanicos: ["id", "nombre", "sede", "activo"],
  taller_prioridades: ["id", "placa", "sede", "fecha_prioridad", "observacion", "estado", "mostrar_operativos"],
  reportes_supervisores: ["id", "unidad_id", "sede", "supervisor_id", "estado", "fecha_reporte"],
  reportes_supervisores_sugerencias: ["reporte_id", "correctivo_id", "confianza", "estado"],
  trabajos_taller_sin_placa: ["id", "sede", "observacion", "creado_por", "fecha"],
  trabajos_taller_sin_placa_mecanicos: ["trabajo_sin_placa_id", "mecanico_id", "trabajo", "repuestos"],
  supervisor_rutas_semanales: ["id", "semana_inicio", "sede", "ruta", "chofer", "unidad_id", "supervisor_id", "activo"],
  supervisor_rutas_movimientos: ["id", "asignacion_id", "accion", "semana_inicio", "motivo", "cambiado_por", "cambiado_en"],
  lavado_unidades: ["id", "unidad_id", "sede", "fecha", "semana_inicio", "creado_por"],
  lavado_unidades_fotos: ["id", "lavado_id", "angulo_clave", "foto_nombre", "foto_tipo", "foto_base64", "foto_hash"],
  cambios_aceite: ["id", "unidad_id", "sede", "galones", "fecha"],
  cambios_aceite_historial: ["id", "unidad_id", "fecha"],
  aceite_estanones: ["id", "sede", "litros_restantes", "estado"],
  aceite_movimientos: ["id", "estanon_id", "tipo", "litros", "sede"],
  revisiones_ruta: ["id", "unidad_id", "sede", "fecha", "apto_ruta", "creado_por"],
  revisiones_ruta_detalle: ["revision_id", "item_clave", "estado"],
  solicitudes_llantas: ["id", "unidad_id", "placa", "sede", "estado", "solicitado_por"],
  solicitudes_llantas_historial: ["solicitud_id", "estado_anterior", "estado_nuevo", "usuario_id"],
  dekra_control: ["id", "unidad_id", "sede", "mes", "estado", "negocio"],
  minae_tramites: ["id", "unidad_id", "sede", "tipo", "estado", "vencimiento", "negocio"],
  bodega_articulos: ["id", "nombre", "tipo_articulo", "grupo_bodega", "origen_inventario", "stock_actual", "precio_unitario", "activo"],
  bodega_existencias: ["id", "articulo_id", "sede", "ubicacion", "cantidad"],
  bodega_entregas: ["id", "placa", "mecanico", "creado_por", "creado_en"],
  bodega_movimientos: ["id", "articulo_id", "tipo_movimiento", "origen_inventario", "sede", "cantidad", "existencia_anterior", "existencia_nueva", "movimiento_origen_id"],
  bodega_ordenes_consumo: ["orden_compra_id", "proveedor_id", "fecha_desde", "fecha_hasta", "contacto_confirmacion", "referencia_confirmacion", "confirmado_por", "confirmado_en"],
  bodega_ordenes_consumo_movimientos: ["movimiento_id", "orden_compra_id"]
};

module.exports = { verificarColumnasRequeridas, COLUMNAS_ESENCIALES_TALLER };
