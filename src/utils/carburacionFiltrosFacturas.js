const {fechaValida,fallo}=require('./carburacionFinanzas');
const {fechaActualCostaRica}=require('./fechaCostaRica');
function filtrosFactura(query={}) {
  const condiciones=[],params=[];
  const proveedor_id=/^[1-9]\d*$/.test(String(query.proveedor_id || '')) ? String(query.proveedor_id) : '';
  const buscar=String(query.buscar || '').trim().slice(0,100);
  const fecha_desde=fechaValida(query.fecha_desde) ? query.fecha_desde : '';
  const fecha_hasta=fechaValida(query.fecha_hasta) ? query.fecha_hasta : '';
  if(fecha_desde && fecha_hasta && fecha_desde>fecha_hasta)throw fallo('La fecha desde no puede ser posterior a la fecha hasta.');
  const pagada=['0','1'].includes(String(query.pagada ?? '')) ? String(query.pagada) : query.estado==='pagadas' ? '1' : ['pendientes','vencidas'].includes(query.estado) ? '0' : '';
  const vencida=query.vencida==='1' || query.estado==='vencidas' ? '1' : '';
  const periodo_cierre=/^\d{4}-(0[1-9]|1[0-2])$/.test(String(query.periodo_cierre || '')) ? query.periodo_cierre : '';
  const orden=query.orden==='asc' ? 'asc' : 'desc';
  const por_pagina=[50,100,150,300].includes(Number(query.por_pagina)) ? Number(query.por_pagina) : 100;
  const pagina=Number.isSafeInteger(Number(query.pagina)) && Number(query.pagina)>0 ? Number(query.pagina) : 1;
  const origen=['orden','independiente'].includes(query.origen) ? query.origen : '';
  if(proveedor_id){condiciones.push('f.proveedor_id=?');params.push(proveedor_id);}
  if(fecha_desde){condiciones.push('f.fecha>=?');params.push(fecha_desde);}
  if(fecha_hasta){condiciones.push('f.fecha<=?');params.push(fecha_hasta);}
  if(pagada)condiciones.push(pagada==='1'?'f.pagado>=f.total':'f.pagado<f.total');
  if(periodo_cierre){condiciones.push('f.periodo_cierre=?');params.push(periodo_cierre);}
  if(vencida){condiciones.push('f.pagado<f.total AND f.vencimiento<?');params.push(fechaActualCostaRica());}
  if(buscar){condiciones.push('(f.numero LIKE ? OR o.po_numero LIKE ? OR f.cliente LIKE ?)');params.push(...Array(3).fill(`%${buscar}%`));}
  if(origen)condiciones.push(origen==='orden'?'f.orden_id IS NOT NULL':'f.orden_id IS NULL');
  return {where:condiciones.length?` WHERE ${condiciones.join(' AND ')}`:'',params,pagina,
    filtros:{proveedor_id,fecha_desde,fecha_hasta,pagada,periodo_cierre,vencida,orden,por_pagina,buscar,origen}};
}
function retornoFacturas(value) {
  return typeof value==='string' && /^\/carburacion\/facturas(?:\?[^#\r\n]*)?$/.test(value) ? value : '/carburacion/facturas';
}
module.exports={filtrosFactura,retornoFacturas};
