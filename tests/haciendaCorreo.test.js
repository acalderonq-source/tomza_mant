const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {verificarRespuesta,conciliarHaciendaCorreo}=require('../src/utils/haciendaCorreo');
const {UPLOAD_ROOT,ensureUploadDirectory}=require('../src/utils/uploadStorage');
test('rechaza XML sin firma, entidades y respuesta que no cubre todo el documento',async()=>{
  await assert.rejects(verificarRespuesta('<MensajeHacienda><Mensaje>1</Mensaje></MensajeHacienda>'),/Firma/);
  await assert.rejects(verificarRespuesta('<!DOCTYPE x><MensajeHacienda/>'),/inválido/);
  await assert.rejects(verificarRespuesta('<FacturaElectronica/>'),/No es respuesta/);
  await assert.rejects(verificarRespuesta('<MensajeHacienda><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><Reference URI="#otro"/></SignedInfo></Signature></MensajeHacienda>'),/documento completo/);
});
test('solo actualiza claves, cédulas y montos coincidentes y conserva aprobación interna',async()=>{
  const dir=ensureUploadDirectory('facturas-correo'),name='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.xml';
  const file=path.join(dir,name);fs.writeFileSync(file,'<MensajeHacienda/>');
  const clave='50613102600030440087500100001010000006424192192472';
  const row={id:5,adjunto_id:6,ruta_archivo:name,datos:{factura:{estado:'PENDIENTE',electronica:{clave,emisor:'304400875',receptor:'3101349880',total:2649.99999}}}};
  let updates=[],commits=0;
  const pool={query:async()=>[[row]],getConnection:async()=>({beginTransaction:async()=>{},commit:async()=>{commits++;},rollback:async()=>{},release(){},query:async(sql,args)=>{if(sql.startsWith('UPDATE'))updates.push({sql,args});return [{affectedRows:1}];}})};
  let total='2649.99999',emisor='304400875';
  const verify=async()=>({mensaje:{Clave:clave,NumeroCedulaEmisor:emisor,NumeroCedulaReceptor:'3101349880',TotalFactura:total,Mensaje:'1'},hash:'prueba',huella:'prueba'});
  try{
    total='9900';assert.equal((await conciliarHaciendaCorreo(pool,verify)).actualizadas,0);
    total='2649.99999';emisor='otra';assert.equal((await conciliarHaciendaCorreo(pool,verify)).actualizadas,0);
    emisor='304400875';assert.equal((await conciliarHaciendaCorreo(pool,verify)).actualizadas,1);assert.equal(commits,1);
    const update=updates[0];assert.match(update.sql,/JSON_SET/);assert.doesNotMatch(update.sql,/cuenta_por_pagar|CONCILIADA/);const h=JSON.parse(update.args[0]);assert.equal(h.estado,'ACEPTADA');assert.equal(h.fuente,'CORREO_XML_FIRMADO');assert.equal(h.adjunto_correo_id,6);
    assert.equal((await conciliarHaciendaCorreo(pool,async()=>{throw Error('Firma falsa');})).actualizadas,0);
  }finally{fs.unlinkSync(file);}
});
