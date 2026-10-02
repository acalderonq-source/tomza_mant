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

module.exports = { verificarColumnasRequeridas };
