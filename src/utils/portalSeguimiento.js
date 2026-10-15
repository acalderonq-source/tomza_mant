const {exigir,saldo}=require('./proveeduria');
const diaCR=fecha=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Costa_Rica',year:'numeric',month:'2-digit',day:'2-digit'}).format(fecha);
function seguimiento(d,ahora=new Date()){
  const f=d.factura,s=saldo(d),h=f.electronica.hacienda,hoy=diaCR(ahora);
  const pagada=!!f.cuenta_por_pagar&&s.saldo<=0;
  const estado=pagada?'Pagada':f.estado==='RECHAZADA_INTERNA'?'Requiere corrección':f.cuenta_por_pagar?(d.programacion?'Pago programado':'Aprobada para pago'):h.estado==='RECHAZADA'?'Rechazada por Hacienda':h.estado==='ACEPTADA'?'En revisión':'Pendiente de Hacienda';
  const responsable=f.estado==='RECHAZADA_INTERNA'?'Proveedor':d.gestion?.responsable_nombre||(f.cuenta_por_pagar?'Contabilidad':'Sin asignar');
  const plazo=d.gestion?.fecha_limite||'';
  const vencida=!pagada&&f.fecha_vencimiento<hoy;
  const limite=new Date(ahora.getTime()+7*86400000);
  const proxima=!pagada&&!vencida&&f.fecha_vencimiento<=diaCR(limite);
  const atrasada=!pagada&&!!plazo&&plazo<hoy;
  const siguiente=pagada?'Consultar comprobantes':f.estado==='RECHAZADA_INTERNA'?'Responder observaciones':h.estado==='RECHAZADA'?'Revisar rechazo fiscal con el proveedor':!d.orden_compra?'Enlazar orden de compra':!f.cuenta_por_pagar?'Revisar factura y validación fiscal':d.programacion?'Registrar pago en la fecha programada':'Programar pago';
  return {estado,responsable,plazo,vencida,proxima,atrasada,siguiente,prioridad:vencida?0:atrasada?1:proxima?2:pagada?5:3};
}
function responderCorreccion(row,body,actor){
  const d=row.datos,f=d.factura,texto=String(body.mensaje||'').trim();
  exigir(f.estado==='RECHAZADA_INTERNA'&&!f.cuenta_por_pagar&&!d.pagos?.length,'La factura no está pendiente de corrección');
  exigir(texto.length>=5&&texto.length<=2000,'Explique la corrección (5 a 2000 caracteres)');
  f.estado='PENDIENTE';
  (d.mensajes??=[]).push({tipo:'respuesta',texto,actor,fecha:new Date().toISOString()});
  d.gestion={...d.gestion,fecha_limite:diaCR(new Date(Date.now()+3*86400000))};
  return texto;
}
module.exports={seguimiento,responderCorreccion,diaCR};
