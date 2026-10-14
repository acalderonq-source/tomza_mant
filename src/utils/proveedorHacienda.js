const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { exigir, numero } = require('./proveeduria');
const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, processEntities: false });

function leerFacturaXML(archivo, notaCredito = false) {
  exigir(archivo && typeof archivo.base64 === 'string' && archivo.base64.length <= 2800000, 'Adjunte el XML de hasta 2 MB');
  const bytes = Buffer.from(archivo.base64, 'base64');
  const xml = bytes.toString('utf8');
  exigir(bytes.length > 0 && bytes.length <= 2 * 1024 * 1024 && !/<!DOCTYPE|<!ENTITY/i.test(xml), 'XML inválido');
  exigir(XMLValidator.validate(xml) === true, 'El XML no está bien formado');
  const raiz=parser.parse(xml);
  const f = notaCredito ? raiz.NotaCreditoElectronica : raiz.FacturaElectronica;
  exigir(f && !Array.isArray(f), notaCredito?'Solo se admiten notas de crédito electrónicas':'Solo se admiten facturas electrónicas');
  const clave = String(f.Clave || '');
  const consecutivo = String(f.NumeroConsecutivo || '');
  exigir(/^506\d{47}$/.test(clave) && /^\d{20}$/.test(consecutivo) && clave.slice(21,41) === consecutivo, 'Clave o consecutivo electrónico inválido');
  exigir(typeof f.FechaEmision === 'string' && Number.isFinite(Date.parse(f.FechaEmision)), 'Fecha de emisión inválida');
  const emisor = String(f.Emisor?.Identificacion?.Numero || '');
  const receptor = String(f.Receptor?.Identificacion?.Numero || '');
  exigir(/^\d{9,12}$/.test(emisor) && /^\d{9,12}$/.test(receptor), 'Identificación de emisor y receptor requerida');
  const total = numero(f.ResumenFactura?.TotalComprobante, 'Total XML', 0.01);
  const moneda = f.ResumenFactura?.CodigoTipoMoneda?.CodigoMoneda || 'CRC';
  exigir(['CRC','USD'].includes(moneda), 'Moneda XML no admitida');
  const array=x=>x==null?[]:Array.isArray(x)?x:[x];
  const observaciones_control=[];
  if(array(f.OtrosCargos).length)observaciones_control.push('El XML incluye otros cargos que requieren revisión en la OC');
  const lineas=array(f.DetalleServicio?.LineaDetalle).map(l=>{
    const codigos=array(l.CodigoComercial).map(c=>String(c.Codigo||'')).filter(Boolean);
    const cantidad=numero(l.Cantidad,'Cantidad XML',0.00001),precio=numero(l.PrecioUnitario,'Precio XML');
    const impuestos=array(l.Impuesto),descuento=array(l.Descuento).reduce((s,x)=>s+numero(x.MontoDescuento,'Descuento XML'),0);
    if(impuestos.some(i=>i.Exoneracion||i.Codigo&&String(i.Codigo)!=='01')||l.ImpuestoAsumidoEmisorFabrica)observaciones_control.push('El XML incluye exoneraciones u otros impuestos: requiere revisión fiscal');
    return {codigo:codigos[0]||String(l.CodigoCABYS||l.Codigo||''),codigos,descripcion:String(l.Detalle||''),cantidad,precio_unitario:precio,descuento,iva:impuestos.reduce((s,x)=>s+numero(x.Tarifa||0,'IVA XML'),0),subtotal:numero(l.SubTotal??cantidad*precio-descuento,'Subtotal XML')};
  });
  const referencias=array(f.InformacionReferencia).map(r=>({tipo:String(r.TipoDoc||r.TipoDocIR||''),numero:String(r.Numero||''),razon:String(r.Razon||'')}));
  if(notaCredito)exigir(referencias.length===1&&referencias[0].tipo==='01'&&/^506\d{47}$/.test(referencias[0].numero),'La nota de crédito debe referenciar una única factura electrónica original');
  return { lineas,observaciones_control:[...new Set(observaciones_control)],referencias,tipo:notaCredito?'NOTA_CREDITO':'FACTURA',clave, consecutivo, emisor, receptor, nombre_emisor: String(f.Emisor?.Nombre || ''), nombre_comercial_emisor: String(f.Emisor?.NombreComercial || ''), nombre_receptor: String(f.Receptor?.Nombre || ''), fecha: f.FechaEmision, total, moneda,
    archivo: { nombre: String(archivo.nombre || 'factura.xml').replace(/[^\w. -]/g,'_').slice(0,120), mime:'application/xml', base64:bytes.toString('base64') } };
}

async function consultarHacienda(clave, campos, request = fetch) {
  exigir(/^506\d{47}$/.test(clave), 'Clave inválida');
  const sandbox = process.env.HACIENDA_AMBIENTE === 'sandbox';
  const ambiente = sandbox ? 'sandbox' : 'produccion';
  const pendiente = detalle => ({ estado:'PENDIENTE', ambiente, detalle, consultado_en:new Date().toISOString() });
  if (!process.env.HACIENDA_USUARIO || !process.env.HACIENDA_PASSWORD) {
    if(campos?.hacienda?.fuente==='CORREO_XML_FIRMADO')return campos.hacienda;
    return pendiente('Esperando respuesta de Hacienda por Outlook o conexión API');
  }
  try {
    const auth = await request(`https://idp.comprobanteselectronicos.go.cr/auth/realms/${sandbox?'rut-stag':'rut'}/protocol/openid-connect/token`, {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(12000), headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:sandbox?'api-stag':'api-prod',grant_type:'password',username:process.env.HACIENDA_USUARIO,password:process.env.HACIENDA_PASSWORD})
    });
    if (!auth.ok) return pendiente('No se pudo autenticar con Hacienda');
    const token = (await auth.json()).access_token;
    if (!token) return pendiente('Hacienda no entregó un token de acceso');
    const r = await request(`https://api.comprobanteselectronicos.go.cr/${sandbox?'recepcion-sandbox':'recepcion'}/v1/recepcion/${clave}`, {
      redirect:'error', signal:AbortSignal.timeout(12000), headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}
    });
    if (!r.ok) return pendiente(r.status===404?'Comprobante no encontrado en Hacienda':'No se pudo consultar Hacienda; reintente después');
    const j = await r.json();
    if (j.clave !== clave) return pendiente('La respuesta no corresponde a la clave consultada');
    const estado = ({aceptado:'ACEPTADA',rechazado:'RECHAZADA',recibido:'RECIBIDA',procesando:'PROCESANDO',error:'ERROR'})[j['ind-estado']];
    if (!estado) return pendiente('Respuesta de Hacienda no reconocida');
    if (estado === 'ACEPTADA') {
      const xml = Buffer.from(String(j['respuesta-xml'] || ''),'base64').toString('utf8');
      if (xml.length > 2*1024*1024 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml)!==true) return pendiente('Respuesta XML de Hacienda inválida');
      const mensaje = parser.parse(xml).MensajeHacienda;
      const id = n => String(n || '').replace(/^0+/, '');
      if (!campos || !mensaje || mensaje.Clave!==clave || String(mensaje.Mensaje)!=='1' ||
          !Number.isFinite(Number(mensaje.TotalFactura)) || Math.abs(Number(mensaje.TotalFactura)-campos.total)>0.01 ||
          id(mensaje.NumeroCedulaEmisor)!==id(campos.emisor) || id(mensaje.NumeroCedulaReceptor)!==id(campos.receptor)) {
        return pendiente('Los datos del XML no coinciden con la respuesta oficial de Hacienda');
      }
    }
    return { estado, ambiente, consultado_en:new Date().toISOString(), detalle:`Estado consultado directamente en Hacienda: ${j['ind-estado']}` };
  } catch (_) { return pendiente('Hacienda no disponible; reintente la consulta'); }
}

function aprobable(f) {
  exigir(f.electronica?.hacienda?.estado === 'ACEPTADA' && f.electronica.hacienda.ambiente === 'produccion', 'Consulte Hacienda: la factura debe estar aceptada en producción');
}
function vencimiento(fecha, dias) {
  const d = new Date(`${fecha.slice(0,10)}T00:00:00Z`);
  const plazo = Number(dias || 0);
  exigir(Number.isInteger(plazo) && plazo >= 0 && plazo <= 3650, 'Plazo de crédito inválido');
  d.setUTCDate(d.getUTCDate()+plazo);
  return d.toISOString().slice(0,10);
}
module.exports = { leerFacturaXML, consultarHacienda, aprobable, vencimiento };
