const crypto=require('node:crypto');
const {clasificar,identidad}=require('./pasivosPdf');

function condicionVenta(codigo){
  const c=typeof codigo==='string'&&/^\d{2}$/.test(codigo.trim())?codigo.trim():'';
  const pago=c==='01'?'CONTADO':['02','10'].includes(c)?'CREDITO':c?'OTRA':'SIN_DATO';
  const texto=c==='01'?'Contado':c==='02'?'Crédito':c==='10'?'Crédito · IVA hasta 90 días':c?'Otra condición ('+c+')':'Sin dato en XML';
  return {condicionVenta:c,condicionPago:pago,condicionTexto:texto};
}
function documentoId(r){
  const proveedor=clasificar(r.proveedor_nombre,r.empresa,r.cedulaEmisor,r.cedulaReceptor)?.nombre||r.proveedor_nombre;
  return crypto.createHash('sha256').update(JSON.stringify([r.empresa,proveedor,r.numero_factura])).digest('hex');
}
function respuestaHacienda(doc){
  const r=doc.MensajeHacienda;
  // La respuesta a un mensaje del receptor no es la aceptación de la factura del emisor.
  if(!r||typeof r!=='object'||r.NumeroConsecutivoReceptor||!/^\d{50}$/.test(r.Clave||''))return null;
  return {clave:r.Clave,codigo:typeof r.Mensaje==='string'?r.Mensaje:'',detalle:typeof r.DetalleMensaje==='string'?r.DetalleMensaje:'',cedulaEmisor:identidad(r.NumeroCedulaEmisor),cedulaReceptor:identidad(r.NumeroCedulaReceptor)};
}
function preparar(filas,respuestas=[]){
  const porClave=new Map();
  for(const r of respuestas){if(!porClave.has(r.clave))porClave.set(r.clave,[]);porClave.get(r.clave).push(r);}
  for(const r of filas){
    const vistos=new Set();
    r.respuestasHacienda=(porClave.get(r.clave)||[]).filter(h=>{
      if(h.cedulaEmisor&&h.cedulaEmisor!==identidad(r.cedulaEmisor))return false;
      const receptor=identidad(r.cedulaReceptor)||{'GAS TOMZA':'3101349880','SUPER GAS':'3101044021'}[r.empresa];
      if(h.cedulaReceptor&&h.cedulaReceptor!==receptor)return false;
      const huella=crypto.createHash('sha256').update(h.buffer).digest('hex');
      if(vistos.has(huella))return false;vistos.add(huella);return true;
    }).sort((a,b)=>String(a.fecha).localeCompare(String(b.fecha))||a.nombre.localeCompare(b.nombre));
    const codigos=new Set(r.respuestasHacienda.map(h=>h.codigo));
    r.estadoHacienda=!codigos.size?'SIN_RESPUESTA':codigos.size!==1?'REVISAR':codigos.has('1')?'ACEPTADO':codigos.has('3')?'RECHAZADO':'REVISAR';
    r.estadoHaciendaTexto={SIN_RESPUESTA:'Sin respuesta adjunta',ACEPTADO:'Aceptado',RECHAZADO:'Rechazado',REVISAR:'Respuestas por revisar'}[r.estadoHacienda];
    if(!r.condicionTexto)Object.assign(r,condicionVenta(''));
    r.documentoId=documentoId(r);
  }
  return filas.sort((a,b)=>String(a.fecha_factura).localeCompare(String(b.fecha_factura))||String(a.proveedor_nombre).localeCompare(String(b.proveedor_nombre),'es')||String(a.numero_factura).localeCompare(String(b.numero_factura)));
}
function filtrar(filas,f){
  const q=String(f.proveedor||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  return Object.assign(filas.filter(r=>(!f.empresa||r.empresa===f.empresa)&&(!f.grupo||r.grupo===f.grupo)&&(!f.condicion||r.condicionPago===f.condicion)&&(!f.hacienda||r.estadoHacienda===f.hacienda)&&(!q||(r.proveedor_nombre+' '+(r.cedulaEmisor||'')).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().includes(q))).map(r=>({...r})),{advertencias:filas.advertencias||[],revision:filas.revision||{}});
}
module.exports={condicionVenta,documentoId,respuestaHacienda,preparar,filtrar};
