const { exigir } = require('./proveeduria');

function lineasActivas(pedido) {
  const rechazados = new Set((pedido.rechazos || []).map(r => r.codigo));
  return pedido.lineas.filter(l => !rechazados.has(l.codigo));
}

function lineasCompraPendientes(pedido) {
  const activos = new Set(lineasActivas(pedido).map(l => l.codigo));
  return (pedido.compra?.lineas || pedido.lineas).filter(l => activos.has(l.codigo));
}

function rechazarProductos(pedido, codigos, motivo, usuario, ahora = new Date()) {
  exigir(!pedido.oc_id && !pedido.salida_id, 'No se puede rechazar después de generar una OC o boleta de entrega');
  const activas = lineasActivas(pedido);
  const seleccion = codigos === undefined ? activas.map(l => l.codigo) : codigos;
  exigir(Array.isArray(seleccion) && seleccion.length > 0 && seleccion.length <= 200,
    'Seleccione al menos un producto para rechazar');
  exigir(new Set(seleccion).size === seleccion.length && seleccion.every(c => activas.some(l => l.codigo === c)),
    'Seleccione productos vigentes de este pedido, sin repetirlos');
  exigir(!(pedido.agrupaciones_compra||[]).some(g=>!g.cancelada&&seleccion.includes(g.codigo)), 'El producto ya está agrupado para compra; cancele primero la agrupación');
  exigir(typeof motivo === 'string' && motivo.trim().length > 0 && motivo.trim().length <= 2000,
    'Indique la razón del rechazo, de hasta 2000 caracteres');
  pedido.rechazos = [...(pedido.rechazos || []), ...seleccion.map(c => {
    const l = activas.find(l => l.codigo === c);
    return { codigo: c, descripcion: l.descripcion, cantidad: l.cantidad,
      motivo: motivo.trim(), usuario_id: usuario.id, responsable: usuario.nombre || usuario.usuario,
      fecha: ahora.toISOString() };
  })];
  // Una cotización anterior incluye productos rechazados: conservarla y volver a cotizar el resto.
  if (pedido.cotizacion) {
    pedido.cotizaciones_anteriores = [...(pedido.cotizaciones_anteriores || []), pedido.cotizacion];
    delete pedido.cotizacion;
  }
  pedido.estado = !lineasActivas(pedido).length ? 'RECHAZADA'
    : pedido.compra ? (lineasCompraPendientes(pedido).length?'SOLICITUD_COMPRA':'LISTA_PARA_ENTREGA') : pedido.requiere_revision_bodega ? 'PENDIENTE_BODEGA' : 'PENDIENTE';
  return pedido;
}

function revisarProductos(pedido, revision, usuario) {
  const libres = lineasActivas(pedido).filter(l => !(pedido.agrupaciones_compra || []).some(g => !g.cancelada && g.codigo === l.codigo));
  exigir(Array.isArray(revision) && revision.length > 0 && revision.length <= 200 && revision.length === libres.length,
    'Revise todos los productos pendientes de esta solicitud');
  const vistos = new Set();
  // Validar todo antes de aplicar los rechazos: cada producto tiene su propia razón.
  for (const r of revision) {
    exigir(r && typeof r.codigo === 'string' && libres.some(l => l.codigo === r.codigo) && !vistos.has(r.codigo),
      'La revisión contiene productos inválidos o repetidos');
    vistos.add(r.codigo);
    exigir(typeof r.comprar === 'boolean', 'Indique si cada producto se va a comprar');
    if (!r.comprar) exigir(typeof r.motivo === 'string' && r.motivo.trim().length > 0 && r.motivo.trim().length <= 2000,
      'Escriba la justificación de cada producto que no se va a comprar');
  }
  const rechazados = revision.filter(r => !r.comprar);
  for (const r of rechazados) rechazarProductos(pedido, [r.codigo], r.motivo, usuario);
  return rechazados;
}

module.exports = { lineasActivas, lineasCompraPendientes, rechazarProductos, revisarProductos };
