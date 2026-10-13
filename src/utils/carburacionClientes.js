function resolverClientesOrden(body, clientes) {
  const normalizar = value => String(value || '').trim().normalize('NFC').toLocaleLowerCase('es-CR');
  const porNombre = new Map(clientes.map(c => [normalizar(c.nombre), c]));
  const porId = new Map(clientes.map(c => [String(c.id), c]));
  let cliente = null;
  if (body.cliente_id) cliente = porId.get(String(body.cliente_id));
  else if (body.placa_unidad) cliente = porNombre.get(normalizar(body.placa_unidad));
  if ((body.cliente_id || body.placa_unidad) && !cliente) throw new Error('Seleccione un cliente del catálogo de Carburación.');
  const raw = Array.isArray(body.lineas) ? body.lineas : Object.values(body.lineas || {});
  const lineas = raw.map(linea => {
    const seleccionado = linea.codigo ? porNombre.get(normalizar(linea.codigo)) : cliente;
    if (linea.codigo && !seleccionado) throw new Error('Seleccione un cliente del catálogo en cada línea.');
    return { ...linea, codigo: seleccionado?.nombre || '', cliente_id: seleccionado?.id || null };
  });
  return { cliente_id: cliente?.id || null, placa_unidad: cliente?.nombre || '', lineas };
}
module.exports = { resolverClientesOrden };
