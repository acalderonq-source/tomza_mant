const { exigir, lineasCompra } = require('./proveeduria');
const { lineasCompraPendientes, lineasActivas } = require('./solicitudCompras');
const { codigoInventario, esNoInventariable } = require('./proveeduriaSolicitable');
const r3 = n => Math.round(n * 1000) / 1000;
const asignaciones = s => (s.agrupaciones_compra || []).filter(a => !a.cancelada);

function sinAgrupar(s) {
  return lineasCompraPendientes(s).map(l => ({ ...l,
    cantidad: r3(l.cantidad - asignaciones(s).filter(a => a.codigo === l.codigo).reduce((n,a) => n+Number(a.cantidad),0))
  })).filter(l => l.cantidad > 0);
}
function pendienteRevision(s) {
  return !s.revision_bodega && !s.oc_id && !s.salida_id
    && !['RECHAZADA','ENTREGADA','REPOSICION_RECIBIDA','COMPRA_RECIBIDA','CANCELADA'].includes(s.estado)
    && !['COMPRA_CONSOLIDADA','REPOSICION_STOCK'].includes(s.origen);
}
function estadoAgrupado(s) {
  const grupos=asignaciones(s);
  if(!grupos.length)return s.compra?'SOLICITUD_COMPRA':'PENDIENTE_BODEGA';
  if(sinAgrupar(s).length)return 'COMPRA_PARCIAL';
  if(grupos.every(g=>g.recibida))return s.origen==='REPOSICION_STOCK'?'REPOSICION_RECIBIDA':'LISTA_PARA_ENTREGA';
  return grupos.every(g=>g.orden_id)?'ORDENADA':'AGRUPADA';
}
// La existencia se reparte una sola vez entre los pedidos seleccionados.
function planCompra(pedidos, articulos, seleccion) {
  const stock=new Map(articulos.map(a=>[codigoInventario(a.codigo),Math.max(0,Number(a.cantidad)||0)]));
  const resultado=new Map();
  for(const p of [...pedidos].sort((a,b)=>a.id-b.id))for(const l of sinAgrupar(p.datos)){
    if(seleccion&&!seleccion.some(i=>i.solicitud_id===p.id&&i.codigo===l.codigo))continue;
    const codigo=codigoInventario(l.codigo),existencia=stock.get(codigo)||0;
    const asignada=asignaciones(p.datos).filter(g=>g.codigo===l.codigo).reduce((n,g)=>n+Number(g.cantidad),0);
    const solicitada=Math.max(0,r3(Number(lineasActivas(p.datos).find(x=>x.codigo===l.codigo).cantidad)-asignada));
    const reposicion=p.datos.origen==='REPOSICION_STOCK';
    const bodega=reposicion||esNoInventariable(l)?0:Math.min(solicitada,existencia);
    const comprar=reposicion?l.cantidad:r3(solicitada-bodega);
    if(!reposicion&&!esNoInventariable(l))stock.set(codigo,r3(existencia-bodega));
    resultado.set(JSON.stringify([p.id,l.codigo]),{...l,cantidad:comprar,pendiente:l.cantidad,solicitada,existencia,bodega});
  }
  return resultado;
}
function agruparSeleccion(pedidos, seleccion, articulos) {
  exigir(Array.isArray(seleccion)&&seleccion.length>0&&seleccion.length<=200,'Seleccione entre 1 y 200 productos de los pedidos aceptados');
  const vistos=new Set(),totales=new Map(),desglose=[];
  const plan=articulos?planCompra(pedidos,articulos,seleccion):null;
  for(const item of seleccion){
    exigir(item&&Number.isSafeInteger(item.solicitud_id)&&typeof item.codigo==='string','Selección de producto inválida');
    const key=JSON.stringify([item.solicitud_id,item.codigo]);exigir(!vistos.has(key),'No repita un producto de la misma solicitud');vistos.add(key);
    const p=pedidos.find(p=>p.id===item.solicitud_id);
    exigir(p&&p.datos.compra&&!pendienteRevision(p.datos)&&!p.datos.oc_id&&!p.datos.salida_id&&!['RECHAZADA','CANCELADA'].includes(p.datos.estado),'Revise y acepte las solicitudes antes de agruparlas');
    const pendiente=sinAgrupar(p.datos).find(l=>l.codigo===item.codigo);exigir(pendiente,'El producto ya fue agrupado, rechazado o no pertenece a este pedido');
    const l=plan?.get(key)||pendiente;
    const codigo=codigoInventario(l.codigo),prev=totales.get(codigo);
    exigir(!prev||Number(prev.iva)===Number(l.iva),'No se pueden agrupar artículos con impuestos diferentes');
    if(l.cantidad>0)totales.set(codigo,{...l,codigo,cantidad:r3(Number(prev?.cantidad||0)+Number(l.cantidad))});
    desglose.push({solicitud_id:p.id,codigo,codigo_solicitado:l.codigo,descripcion:l.descripcion,cantidad:Number(l.cantidad),cantidad_pendiente:pendiente.cantidad,bodega:l.bodega||0,existencia:l.existencia||0,
      sede:p.sede,departamento:p.datos.departamento,unidad:p.datos.unidad,solicitante:p.datos.solicitante||`Usuario ${p.usuario_id}`,usuario_id:p.usuario_id});
  }
  exigir(totales.size>0,'Hay existencias suficientes en Bodega. Genere la boleta de entrega en lugar de comprar');
  return {lineas:lineasCompra([...totales.values()]),desglose};
}
module.exports={sinAgrupar,pendienteRevision,estadoAgrupado,agruparSeleccion,asignaciones,planCompra};
