require('reflect-metadata');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DOMParser}=require('@xmldom/xmldom');
const {SignedXml}=require('xml-crypto');
const {X509Crl,X509Certificate}=require('@peculiar/x509');
const {XMLParser}=require('fast-xml-parser');
const {UPLOAD_ROOT}=require('./uploadStorage');
const DS='http://www.w3.org/2000/09/xmldsig#';
const XPATH='http://www.w3.org/TR/1999/REC-xpath-19991116';
const CA=fs.readFileSync(path.join(__dirname,'../data/hacienda-certificados/sinpe-pj-2023.pem'),'utf8');
const ca=new crypto.X509Certificate(CA);
const parser=new XMLParser({removeNSPrefix:true,parseTagValue:false,processEntities:false});
let cachedCRL;
async function revocacion(cert,request=fetch){
  const now=new Date();
  if(!cachedCRL||cachedCRL.until<Date.now()){
    // URL fija de la autoridad publicada por el BCCR; la CRL se autentica con su firma.
    const r=await request('http://fdi.sinpe.fi.cr/repositorio/CA%20SINPE%20-%20PERSONA%20JURIDICA%20v2(2).crl',{redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error('No se pudo consultar revocación SINPE');
    const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>5*1024*1024)throw Error('CRL excede el límite');
    const crl=new X509Crl(bytes);
    if(!crl.nextUpdate||crl.thisUpdate>now||crl.nextUpdate<now||!await crl.verify({publicKey:new X509Certificate(CA).publicKey},crypto.webcrypto))throw Error('CRL inválida o vencida');
    cachedCRL={crl,until:Math.min(Date.now()+30*60000,crl.nextUpdate.getTime())};
  }
  if(cachedCRL.crl.findRevoked(cert.serialNumber))throw Error('Certificado de Hacienda revocado');
}
class XPathHacienda {
  getAlgorithmName(){return XPATH;}
  process(node){for(const signature of Array.from(node.getElementsByTagNameNS(DS,'Signature')))signature.parentNode.removeChild(signature);return node;}
}
async function verificarRespuesta(xml,checkRevocation=revocacion){
  if(typeof xml!=='string'||Buffer.byteLength(xml)>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('XML de respuesta inválido');
  const doc=new DOMParser({onError:()=>{throw Error('XML mal formado');}}).parseFromString(xml,'text/xml');
  if(doc.documentElement.localName!=='MensajeHacienda')throw Error('No es respuesta de Hacienda');
  const signatures=doc.getElementsByTagNameNS(DS,'Signature');if(signatures.length!==1||signatures[0].parentNode!==doc.documentElement)throw Error('Firma de Hacienda requerida');
  const signature=signatures[0];
  const refs=signature.getElementsByTagNameNS(DS,'Reference');if(!refs.length||refs[0].getAttribute('URI')!=='')throw Error('La firma no cubre el documento completo');
  for(const t of Array.from(signature.getElementsByTagNameNS(DS,'Transform'))){
    if(t.getAttribute('Algorithm')===XPATH){const expression=t.getElementsByTagNameNS(DS,'XPath')[0];if(!expression||expression.textContent.trim()!=='not(ancestor-or-self::ds:Signature)'||expression.lookupNamespaceURI('ds')!==DS)throw Error('Transformación XPath no admitida');}
  }
  const certs=signature.getElementsByTagNameNS(DS,'X509Certificate');if(certs.length!==1)throw Error('Certificado de firma ambiguo');
  const cert=new crypto.X509Certificate(Buffer.from(certs[0].textContent.replace(/\s/g,''),'base64'));
  const now=Date.now();
  if(!cert.checkIssued(ca)||!cert.verify(ca.publicKey)||now<Date.parse(cert.validFrom)||now>Date.parse(cert.validTo)||now>Date.parse(ca.validTo)||!cert.subject.split('\n').includes('serialNumber=CPJ-2-100-042005'))throw Error('Firmante no autorizado o certificado vencido');
  const verifier=new SignedXml({publicCert:cert.toString(),getCertFromKeyInfo:()=>null});
  verifier.CanonicalizationAlgorithms[XPATH]=XPathHacienda;
  verifier.loadSignature(signature);
  if(!verifier.checkSignature(xml))throw Error('Firma de Hacienda inválida');
  const signed=verifier.getSignedReferences()[0];
  const mensaje=parser.parse(signed).MensajeHacienda;
  if(!mensaje||!/^506\d{47}$/.test(mensaje.Clave)||!['1','2','3'].includes(String(mensaje.Mensaje)))throw Error('Respuesta firmada no reconocida');
  await checkRevocation(cert);
  return {mensaje,huella:cert.fingerprint256,hash:crypto.createHash('sha256').update(xml).digest('hex')};
}
let ejecutando=false;
async function conciliarHaciendaCorreo(pool,verify=verificarRespuesta){
  if(ejecutando)return {actualizadas:0};ejecutando=true;
  let actualizadas=0;
  try{
    const [rows]=await pool.query(`SELECT d.id,d.datos,a.id AS adjunto_id,a.ruta_archivo FROM prov_documentos d
      JOIN facturas_correo_adjuntos a ON a.clave_electronica=JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.factura.electronica.clave'))
      WHERE d.tipo='factura_portal' AND a.tipo_documento='XML'
      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.factura.electronica.hacienda.fuente')),'') <> 'CORREO_XML_FIRMADO'
      ORDER BY d.id,a.id LIMIT 100`);
    for(const row of rows){
      if(!/^[a-f\d-]+\.xml$/i.test(row.ruta_archivo))continue;
      const file=path.join(UPLOAD_ROOT,'facturas-correo',row.ruta_archivo);
      if(!fs.existsSync(file)||fs.statSync(file).size>2*1024*1024)continue;
      const xml=fs.readFileSync(file,'utf8');if(!xml.includes('MensajeHacienda'))continue;
      let resultado;try{resultado=await verify(xml);}catch(e){console.warn('Respuesta correo sin verificar:',row.adjunto_id,e.message);continue;}
      const d=typeof row.datos==='string'?JSON.parse(row.datos):row.datos,f=d.factura,e=f.electronica,m=resultado.mensaje,id=n=>String(n||'').replace(/^0+/,'');
      if(m.Clave!==e.clave||id(m.NumeroCedulaEmisor)!==id(e.emisor)||id(m.NumeroCedulaReceptor)!==id(e.receptor)||!Number.isFinite(Number(m.TotalFactura))||Math.abs(Number(m.TotalFactura)-e.total)>0.01)continue;
      const estado=m.Mensaje==='1'?'ACEPTADA':m.Mensaje==='3'?'RECHAZADA':'ACEPTADA_PARCIAL';
      const hacienda={estado,ambiente:'produccion',fuente:'CORREO_XML_FIRMADO',adjunto_correo_id:row.adjunto_id,huella_firmante:resultado.huella,hash_respuesta:resultado.hash,consultado_en:new Date().toISOString(),detalle:'Respuesta de Hacienda recibida por Outlook; firma, emisor, receptor y monto verificados'};
      const db=await pool.getConnection();
      try{
        await db.beginTransaction();
        const [update]=await db.query(`UPDATE prov_documentos SET datos=JSON_SET(datos,'$.factura.electronica.hacienda',CAST(? AS JSON)) WHERE id=?
          AND JSON_UNQUOTE(JSON_EXTRACT(datos,'$.factura.electronica.clave'))=?
          AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(datos,'$.factura.electronica.hacienda.fuente')),'') <> 'CORREO_XML_FIRMADO'`,[JSON.stringify(hacienda),row.id,e.clave]);
        if(update.affectedRows){await db.query('INSERT INTO prov_auditoria (documento_id,actor,accion) VALUES (?,?,?)',[row.id,'Sistema Outlook',`Hacienda ${estado}; Outlook adjunto ${row.adjunto_id}`]);actualizadas++;}
        await db.commit();
      }catch(error){await db.rollback();throw error;}finally{db.release();}
    }
    actualizadas+=await require('./portalNotasCorreo').conciliarNotasCorreo(pool,verify);
    return {actualizadas};
  }finally{ejecutando=false;}
}
module.exports={verificarRespuesta,conciliarHaciendaCorreo};
