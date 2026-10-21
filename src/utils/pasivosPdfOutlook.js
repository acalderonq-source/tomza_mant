const path=require('node:path');
const {XMLParser}=require('fast-xml-parser');
const pdf=require('./pasivosPdf');
const documentos=require('./pasivosDocumentosCorreo');
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
const filtrar=documentos.filtrar;
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
  return {...documentos.condicionVenta(f.CondicionVenta),plazoCredito:typeof f.PlazoCredito==='string'?f.PlazoCredito:'',fechaEmision:typeof f.FechaEmision==='string'?f.FechaEmision:'',cedulaEmisor:String(f.Emisor?.Identificacion?.Numero||''),cedulaReceptor:String(f.Receptor?.Identificacion?.Numero||''),tipoDocumento:credito?'nota_credito':'factura',monto,moneda:f.ResumenFactura?.CodigoTipoMoneda?.CodigoMoneda||null,referenciaFactura:referencias[0]?.Numero||'',proveedor_nombre:String(f.Emisor.Nombre),numero_factura:String(f.NumeroConsecutivo),clave:String(f.Clave||''),empresa:pdf.empresaReceptora(String(f.Receptor?.Nombre||''),f.Receptor?.Identificacion?.Numero)};
}
const stem=v=>path.parse(String(v||'').toLowerCase()).name;
function asociar(archivo,facturas,pdfs){
  const directas=facturas.filter(f=>String(archivo.name).includes(f.numero_factura)||(f.clave&&String(archivo.name).includes(f.clave))||stem(archivo.name)===stem(f.xmlNombre));
  if(directas.length===1)return directas[0];
  if(!directas.length&&facturas.length===1&&pdfs.length===1&&!/\d{20}/.test(archivo.name||''))return facturas[0];
  return null;
}
async function cargar(_db,f,cliente){
  const c=cliente||require('../routes/facturasCorreo.routes').outlook;
  if(!c.configReady())throw error('Falta configurar la conexión Outlook del sistema.');
  const conexion=await c.getConnection();
  if(!conexion)throw error('Conectá Outlook desde la configuración de correo de facturas.');
  if(cliente)return filtrar(await buscar(f,c,conexion),f);
  const key=JSON.stringify([process.env.MS_CLIENT_ID,conexion.cuenta_id,conexion.correo,conexion.id,f.desde,f.hasta]);
  if(f.actualizar)consultas.delete(key);
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
  const params=new URLSearchParams({'$select':'id,receivedDateTime,subject,lastModifiedDateTime,webLink','$expand':'attachments($select=id,name,size,isInline,contentType)', '$filter':`receivedDateTime ge ${f.desde}T06:00:00Z and receivedDateTime lt ${hasta.toISOString()} and hasAttachments eq true`,'$top':'100'});
  let url=ROOT+'/me/messages?'+params,total=0,bytesTotal=0;
  const filas=[],indice=new Map(),respuestas=[],advertencias=[],revision={pdfSinXml:0,pdfSinIdentificar:0,fueraLista:0};
  function advertir(m,a,motivo){if(advertencias.length<200)advertencias.push({archivo:a.name,fecha:m.receivedDateTime,motivo,urlCorreo:/^https:\/\//i.test(m.webLink||'')?m.webLink:''});}
  function agregar(row){
    const id=row.empresa+'|'+(clasificacion(row)?.nombre||row.proveedor_nombre)+'|'+row.numero_factura;
    const anterior=indice.get(id);
    if(anterior){
      const xml=row.xmlBuffer?row:anterior.xmlBuffer?anterior:null;
      if(xml)for(const k of ['proveedor_nombre','monto','moneda','cedulaEmisor','cedulaReceptor','clave','referenciaFactura','condicionVenta','condicionPago','condicionTexto','plazoCredito','fechaEmision'])anterior[k]=xml[k];
      if(row.xmlBuffer)anterior.xmlBuffer=row.xmlBuffer;
      if(row.disponible&&!anterior.disponible){anterior.disponible=true;anterior.obtenerContenido=row.obtenerContenido;}
      anterior.fuenteIdentificacion=anterior.xmlBuffer?'XML':'PDF';
      if(anterior.disponible)delete anterior.motivo;
      return;
    }
    indice.set(id,row);filas.push(row);
  }
  function clasificacion(factura){if(factura.fuenteIdentificacion==='PDF'&&!factura.identificado)return null;return pdf.clasificar(factura.proveedor_nombre,factura.empresa,factura.cedulaEmisor,factura.cedulaReceptor);}
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
    if(bytesTotal>100*1024*1024)throw Object.assign(error('Los adjuntos superan el límite de descarga. Seleccioná un período menor.'),{code:'LIMITE_DESCARGA'});
    if(b.length>8*1024*1024)throw error('Un adjunto supera 8 MB y requiere revisión individual.');
    guardarCache(cacheKey,b);return b;
  }
  while(url){
    if(!url.startsWith(ROOT+'/'))throw error('Paginación Outlook inválida.');
    const data=await c.graphGet(url,token);
    await paralelo(data.value||[],async m=>{
      if(++total>5000)throw error('Hay más de 5000 correos en el período. Seleccioná un rango menor.');
      const adjuntos=(Array.isArray(m.attachments)?[...m.attachments,...(m['attachments@odata.nextLink']?await paginas(m['attachments@odata.nextLink']):[])]:await paginas(`${ROOT}/me/messages/${encodeURIComponent(m.id)}/attachments?$select=id,name,size,isInline,contentType`));
      const pdfs=adjuntos.filter(a=>/\.pdf$/i.test(a.name)||a.contentType==='application/pdf'),facturas=[];
      for(const a of adjuntos.filter(a=>/\.xml$/i.test(a.name)||/^(?:application|text)\/xml$/i.test(a.contentType||''))){
        const xml=await leer(m,a);let factura;
        try{factura=facturaXml(xml);}catch(e){advertir(m,a,'XML no legible; se intentará identificar el PDF.');continue;}
        if(factura)facturas.push({...factura,xmlNombre:a.name,xmlBuffer:xml,fuenteIdentificacion:'XML'});
        else if(!/<!DOCTYPE|<!ENTITY/i.test(xml.toString('utf8'))){
          const respuesta=documentos.respuestaHacienda(parser.parse(xml.toString('utf8')));
          if(respuesta)respuestas.push({...respuesta,buffer:xml,nombre:a.name,fecha:m.receivedDateTime});
        }
      }
      const vinculadas=new Set();
      for(const a of pdfs){
        let factura=asociar(a,facturas,pdfs),buffer;
        if(!factura){
          try{
            buffer=await leer(m,a);
            const leida=await require('./facturaPdfCorreo').leerPdf(buffer,a.name);
            if(!leida){revision.pdfSinIdentificar++;advertir(m,a,'PDF sin datos de factura legibles; requiere revisión manual.');continue;}
            const xml=facturas.find(f=>f.numero_factura===leida.numero_factura&&(!f.clave||!leida.clave||f.clave===leida.clave));
            factura=xml||leida;
          }catch(e){if(e.code==='LIMITE_DESCARGA'||e.status===429||e.status>=500||e.name==='TimeoutError')throw e;revision.pdfSinIdentificar++;advertir(m,a,'No se pudo leer el PDF: '+(e.status?'Outlook '+e.status:e.message));continue;}
        }
        const p=clasificacion(factura);
        if(!p){revision.fueraLista++;advertir(m,a,'Proveedor o empresa no identificados en la lista de pasivos: '+factura.proveedor_nombre);continue;}
        if(factura.xmlBuffer)vinculadas.add(factura);else revision.pdfSinXml++;
        agregar({...factura,empresa:p.empresa,grupo:p.grupo,fecha_factura:m.receivedDateTime,urlCorreo:m.webLink,disponible:true,obtenerContenido:async()=>{
          const b=buffer||await leer(m,a,false);
          if(!b.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error('El adjunto no contiene un PDF válido');
          return b;
        }});
      }
      for(const factura of facturas){
        if(vinculadas.has(factura))continue;
        const p=clasificacion(factura);
        if(!p)continue;
        agregar({...factura,empresa:p.empresa,grupo:p.grupo,fecha_factura:m.receivedDateTime,urlCorreo:m.webLink,disponible:false,motivo:'Sin PDF asociado con certeza en este correo'});
      }
    },2);
    url=data['@odata.nextLink'];
  }
  return Object.assign(documentos.preparar(filas,respuestas),{advertencias,revision});
}
module.exports={cargar,facturaXml,asociar,paralelo,mensajeError,contenido:async(_db,r)=>r.obtenerContenido(),xml:async(_db,r)=>r.xmlBuffer};
