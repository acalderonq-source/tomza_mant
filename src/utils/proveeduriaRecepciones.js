const {exigir,hash}=require('./proveeduria');
const {cantidadInventario}=require('./proveeduriaInventario');
const redondear=n=>Math.round(n*1000)/1000;

function resumenRecepcion(oc){
  const historial=oc.recepciones||[];
  // Las OC recibidas antes de este módulo ya ingresaron al inventario.
  const anterior=oc.estado==='RECIBIDA'&&!historial.length;
  const lineas=oc.lineas.map(l=>{
    const recibida=anterior?Number(l.cantidad):redondear(historial.reduce((s,r)=>s+r.lineas.filter(x=>x.codigo===l.codigo).reduce((n,x)=>n+Number(x.cantidad),0),0));
    return {...l,cantidad:Number(l.cantidad),recibida,pendiente:redondear(Number(l.cantidad)-recibida)};
  });
  const completas=lineas.filter(l=>l.pendiente===0).length;
  const estado=completas===lineas.length?'RECIBIDA':lineas.some(l=>l.recibida>0)?'PARCIAL':'PENDIENTE';
  return {lineas,historial,anterior,completas,estado,version:historial.length,progreso:Math.round(lineas.reduce((s,l)=>s+l.recibida/l.cantidad,0)/lineas.length*100)};
}

function leerRecepcion(body={}){
  exigir(/^[a-f0-9]{32}$/.test(body.token||''),'Abra nuevamente la recepción para registrar la mercadería');
  exigir(body.version!==''&&body.version!==undefined&&Number.isInteger(Number(body.version))&&Number(body.version)>=0,'Versión de recepción inválida');
  const referencia=String(body.referencia||'').trim(),observaciones=String(body.observaciones||'').trim();
  exigir(referencia&&referencia.length<=120,'Indique el número de factura, remisión o referencia de entrega (máximo 120 caracteres)');
  exigir(observaciones.length<=500,'Observaciones: máximo 500 caracteres');
  exigir(Array.isArray(body.lineas)&&body.lineas.length>0&&body.lineas.length<=200,'Indique los artículos que está recibiendo');
  const codigos=new Set();
  const lineas=body.lineas.map(l=>{
    const codigo=String(l.codigo||'');
    exigir(codigo&&!codigos.has(codigo),'No repita códigos en la recepción');codigos.add(codigo);
    return {codigo,cantidad:cantidadInventario(l.cantidad,`Cantidad de ${codigo}`)};
  }).sort((a,b)=>a.codigo.localeCompare(b.codigo));
  exigir(lineas.some(l=>l.cantidad>0),'Ingrese al menos una cantidad recibida mayor que cero');
  const huella=hash(JSON.stringify({referencia,observaciones,lineas}));
  return {id:body.token,version:Number(body.version),referencia,observaciones,lineas,huella};
}

function validarPendientes(resumen,recepcion){
  exigir(resumen.estado!=='RECIBIDA','Mercadería ya recibida');
  exigir(recepcion.version===resumen.version,'Otra recepción modificó esta OC. Actualice la página y revise las cantidades pendientes');
  for(const l of recepcion.lineas){
    const ordenada=resumen.lineas.find(x=>x.codigo===l.codigo);
    exigir(ordenada,`El artículo ${l.codigo} no pertenece a esta OC`);
    exigir(l.cantidad<=ordenada.pendiente,`${l.codigo}: solo quedan ${ordenada.pendiente} por recibir`);
  }
}
module.exports={resumenRecepcion,leerRecepcion,validarPendientes};
