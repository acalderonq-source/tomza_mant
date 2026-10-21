const path=require('node:path');
const {XMLParser}=require('fast-xml-parser');
const pdf=require('./pasivosPdf');
const parser=new XMLParser({ignoreAttributes:true,removeNSPrefix:true,parseTagValue:false});
const ROOT='https://graph.microsoft.com/v1.0';
const consultas=new Map();
const adjuntosCache=new Map();let bytesCache=0;
function guardarCache(key,buffer){
  const anterior=adjuntosCache.get(key);if(anterior)bytesCache-=anterior.buffer.length;
  adjuntosCache.delete(key);
  while(bytesCache+buffer.length>100*1024*1024&&adjuntosCache.size){const k=adjuntosCache.keys().next().value;bytesCache-=adjuntosCache.get(k).buffer.length;adjuntosCache.delete(k);}
  adjuntosCache.set(key,{buffer,hasta:Date.now()+15*60000});bytesCache+=buffer.length;
}
function obtenerCache(key){
  const entrada=adjuntosCache.get(key);if(!entrada)return null;
  if(entrada.hasta<Date.now()){bytesCache-=entrada.buffer.length;adjuntosCache.delete(key);return null;}
  return entrada.buffer;
}
function filtrar(filas,f){return filas.filter(r=>(!f.empresa||r.empresa===f.empresa)&&(!f.grupo||r.grupo===f.grupo)&&(f.incluirNotas||r.tipoDocumento!=='nota_credito')).map(r=>({...r}));}
async function paralelo(items,fn,limite=4){
  const resultados=new Array(items.length);let indice=0;
  await Promise.all(Array.from({length:Math.min(limite,items.length)},async()=>{while(indice<items.length){const i=indice++;resultados[i]=await fn(items[i],i);}}));
  return resultados;
}
const error=mensaje=>Object.assign(new Error(mensaje),{status:400});
function mensajeError(e){
  if(e.status===400 && !e.detail)return e.message;
  if([401,403].includes(e.status)||/interaction_required|invalid_grant|no_tokens_found/.test(e.errorCode||''))return 'La autorización de Outlook venció o no permite leer correos. El administrador debe volver a conectar Outlook.';
  if(e.status===429)return 'Outlook limitó temporalmente las consultas. Esperá un minuto y volvé a intentar.';
  if(['TimeoutError','AbortError'].includes(e.name))return 'Outlook tardó demasiado en responder. Volvé a intentar con un período menor.';
  let codigo;try{codigo=JSON.parse(e.detail||'{}').error?.code;}catch{}
  return 'No se pudo completar la consulta de Outlook'+(codigo?' ('+String(codigo).replace(/[^\w.-]/g,'').slice(0,80)+')':'')+'. Volvé a intentar. Si persiste, indicá las fechas consultadas.';
}
function facturaXml(bytes){
  const xml=bytes.toString('utf8');
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))return null;
  const doc=parser.parse(xml),f=doc.FacturaElectronica||doc.FacturaElectronicaCompra||doc.NotaCreditoElectronica;
  if(!f||!f.Emisor?.Nombre||!/^\d{20}$/.test(String(f.NumeroConsecutivo||'')))return null;
  const credito=!!doc.NotaCreditoElectronica;
  const total=f.ResumenFactura?.TotalComprobante;
  const monto=typeof total==='string'&&/^\d+(?:\.\d{1,5})?$/.test(total)?Number(total)*(credito?-1:1):null;
  const referencias=Array.isArray(f.InformacionReferencia)?f.InformacionReferencia:[f.InformacionReferencia].filter(Boolean);
  return {tipoDocumento:credito?'nota_credito':'factura',monto,moneda:f.ResumenFactura?.CodigoTipoMoneda?.CodigoMoneda||null,referenciaFactura:referencias[0]?.Numero||'',proveedor_nombre:String(f.Emisor.Nombre),numero_factura:String(f.NumeroConsecutivo),clave:String(f.Clave||''),empresa:String(f.Receptor?.Nombre||'')};
}
const stem=v=>path.parse(String(v||'').toLowerCase()).name;
function asociar(archivo,facturas,pdfs){
  const directas=facturas.filter(f=>String(archivo.name).includes(f.numero_factura)||(f.clave&&String(archivo.name).includes(f.clave))||stem(archivo.name)===stem(f.xmlNombre));
  if(directas.length===1)return directas[0];
  if(!directas.length&&facturas.length===1&&pdfs.length===1)return facturas[0];
  return null;
}
async function cargar(_db,f,cliente){
  const c=cliente||require('../routes/facturasCorreo.routes').outlook;
  if(!c.configReady())throw error('Falta configurar la conexión Outlook del sistema.');
  const conexion=await c.getConnection();
  if(!conexion)throw error('Conectá Outlook desde la configuración de correo de facturas.');
  if(cliente)return filtrar(await buscar(f,c,conexion),f);
  const key=JSON.stringify([process.env.MS_CLIENT_ID,conexion.cuenta_id,conexion.correo,conexion.id,f.desde,f.hasta]);
  const ahora=Date.now();
  for(const [k,v] of consultas)if(v.hasta<ahora)consultas.delete(k);
  if(consultas.has(key))return filtrar(await consultas.get(key).promesa,f);
  while(consultas.size>=5)consultas.delete(consultas.keys().next().value);
  const entrada={hasta:ahora+5*60000,promesa:buscar(f,c,conexion)};consultas.set(key,entrada);
  try{const filas=await entrada.promesa;entrada.hasta=Date.now()+5*60000;return filtrar(filas,f);}catch(e){if(consultas.get(key)===entrada)consultas.delete(key);throw e;}
}
async function buscar(f,c,conexion){
  const token=await c.getAccessToken(conexion);
  const hasta=new Date(f.hasta+'T00:00:00-06:00');hasta.setUTCDate(hasta.getUTCDate()+1);
  const params=new URLSearchParams({'$select':'id,receivedDateTime,subject,lastModifiedDateTime','$expand':'attachments($select=id,name,size,isInline,contentType)', '$filter':`receivedDateTime ge ${f.desde}T06:00:00Z and receivedDateTime lt ${hasta.toISOString()} and hasAttachments eq true`,'$top':'100'});
  let url=ROOT+'/me/messages?'+params,total=0,bytesTotal=0;
  const filas=[],vistos=new Set();
  async function paginas(next){
    const result=[];
    while(next){
      if(!next.startsWith(ROOT+'/'))throw error('Microsoft devolvió una dirección de paginación inválida.');
      const data=await c.graphGet(next,token);result.push(...(data.value||[]));next=data['@odata.nextLink'];
      if(result.length>5000)throw error('El período contiene demasiados elementos. Seleccioná un rango menor.');
    }
    return result;
  }
  async function leer(message,a,contar=true){
    if(Number(a.size)>8*1024*1024)throw error('Un adjunto supera 8 MB. Seleccioná un período menor o revisá ese correo.');
    const cacheKey=JSON.stringify([conexion.cuenta_id,conexion.correo,process.env.MS_CLIENT_ID,message.id,message.lastModifiedDateTime,a.id]);
    const almacenado=obtenerCache(cacheKey);if(almacenado)return almacenado;
    const b=await c.graphGetBytes(`${ROOT}/me/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(a.id)}/$value`,token);
    if(contar)bytesTotal+=b.length;
    if(b.length>8*1024*1024||bytesTotal>100*1024*1024)throw error('Los adjuntos superan el límite de descarga. Seleccioná un período menor.');
    guardarCache(cacheKey,b);return b;
  }
  while(url){
    if(!url.startsWith(ROOT+'/'))throw error('Paginación Outlook inválida.');
    const data=await c.graphGet(url,token);
    const grupos=await paralelo(data.value||[],async m=>{
      const filas=[];
      if(++total>5000)throw error('Hay más de 5000 correos en el período. Seleccioná un rango menor.');
      const adjuntos=(Array.isArray(m.attachments)?[...m.attachments,...(m['attachments@odata.nextLink']?await paginas(m['attachments@odata.nextLink']):[])]:await paginas(`${ROOT}/me/messages/${encodeURIComponent(m.id)}/attachments?$select=id,name,size,isInline,contentType`)).filter(a=>!a.isInline);
      const pdfs=adjuntos.filter(a=>/\.pdf$/i.test(a.name)),facturas=[];
      if(!adjuntos.some(a=>/\.xml$/i.test(a.name)))return filas;
      for(const a of adjuntos.filter(a=>/\.xml$/i.test(a.name))){
        const xml=await leer(m,a);let factura;try{factura=facturaXml(xml);}catch(e){continue;}
        if(factura)facturas.push({...factura,xmlNombre:a.name,xmlBuffer:xml});
      }
      for(const a of pdfs){
        const factura=asociar(a,facturas,pdfs);if(!factura)continue;
        const p=pdf.clasificar(factura.proveedor_nombre,factura.empresa);
        if(!p)continue;
        const identidad=p.empresa+'|'+factura.proveedor_nombre+'|'+(factura.clave||factura.numero_factura);
        if(vistos.has(identidad))continue;
        vistos.add(identidad);
        filas.push({...factura,empresa:p.empresa,grupo:p.grupo,fecha_factura:m.receivedDateTime,disponible:true,obtenerContenido:async()=>{
          const buffer=await leer(m,a,false);
          if(!buffer.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error('El adjunto no contiene un PDF válido');
          return buffer;
        }});
      }
      for(const factura of facturas){
        const p=pdf.clasificar(factura.proveedor_nombre,factura.empresa);
        if(!p)continue;
        if(!pdfs.some(a=>asociar(a,facturas,pdfs)===factura))filas.push({...factura,empresa:p.empresa,grupo:p.grupo,fecha_factura:m.receivedDateTime,disponible:false,motivo:'Sin PDF asociado con certeza en este correo'});
      }
      return filas;
    },2);
    filas.push(...grupos.flat());
    url=data['@odata.nextLink'];
  }
  return filas;
}
module.exports={cargar,facturaXml,asociar,paralelo,mensajeError,contenido:async(_db,r)=>r.obtenerContenido(),xml:async(_db,r)=>r.xmlBuffer};
