// Existencias físicas de la bodega general; la consulta no reserva productos.
function revisarExistencias(lineas, articulos, ahora = new Date()) {
  const stock = new Map(articulos.map(a => [a.codigo, Math.max(0, Number(a.cantidad) || 0)]));
  const detalle = lineas.map(l => {
    const existencia = l.inventariable === false ? 0 : stock.get(l.codigo) || 0;
    const disponible = Math.min(existencia, l.cantidad);
    return { codigo: l.codigo, solicitada: l.cantidad, existencia, disponible,
      faltante: Math.round((l.cantidad - disponible) * 1000) / 1000 };
  });
  return { revisado_en: ahora.toISOString(), almacen: 'GENERAL',
    estado: detalle.every(l => l.faltante === 0) ? 'COMPLETA' : detalle.some(l => l.disponible > 0) ? 'PARCIAL' : 'SIN_EXISTENCIAS',
    lineas: detalle };
}
module.exports = { revisarExistencias };
