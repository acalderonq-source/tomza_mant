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
  bodega_articulos: ["id", "nombre", "tipo_articulo", "grupo_bodega", "origen_inventario", "stock_actual", "precio_unitario", "activo"],
  bodega_existencias: ["id", "articulo_id", "sede", "ubicacion", "cantidad"],
  bodega_entregas: ["id", "placa", "mecanico", "creado_por", "creado_en"],
  bodega_movimientos: ["id", "articulo_id", "tipo_movimiento", "origen_inventario", "sede", "cantidad", "existencia_anterior", "existencia_nueva", "movimiento_origen_id"],
  bodega_ordenes_consumo: ["orden_compra_id", "proveedor_id", "fecha_desde", "fecha_hasta", "contacto_confirmacion", "referencia_confirmacion", "confirmado_por", "confirmado_en"],
  bodega_ordenes_consumo_movimientos: ["movimiento_id", "orden_compra_id"]
};

module.exports = { verificarColumnasRequeridas, COLUMNAS_ESENCIALES_TALLER };
