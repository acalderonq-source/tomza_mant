const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),ejs=require('ejs');
const s=require('../src/utils/pasivosPdfOutlook'),d=require('../src/utils/pasivosDocumentosCorreo');
test('visor y descarga conservan XML, escapan contenido y validan documento, tipo y permisos',async()=>{
  const original=s.cargar,xml=Buffer.from('<FacturaElectronica><Texto>&lt;script&gt;alert(1)&lt;/script&gt;</Texto></FacturaElectronica>'),h=Buffer.from('<MensajeHacienda>Original</MensajeHacienda>');
  const row={empresa:'GAS TOMZA',proveedor_nombre:'MAXI REPUESTOS',numero_factura:'00100001010000389672',xmlBuffer:xml,respuestasHacienda:[{buffer:h}]};row.documentoId=d.documentoId(row);
  s.cargar=async()=>[row];
  try{
    const router=require('../src/routes/contabilidadDocumentos.routes'),handler=router.stack.find(l=>l.route?.path==='/descargas-pdf/archivo').route.stack[0].handle;
    const q={desde:'2026-10-17',hasta:'2026-10-21',documento:row.documentoId,tipo:'xml'};
    function respuesta(){return {codigo:200,status(n){this.codigo=n;return this;},sendStatus(n){this.codigo=n;return this;},type(t){this.tipo=t;return this;},attachment(n){this.archivo=n;return this;},send(b){this.buffer=b;return this;},render(v,datos){this.vista=v;this.datos=datos;}};}
    const r=respuesta();await handler({query:q},r,e=>{throw e;});
    assert.equal(r.vista,'contabilidad/xml_correo');assert.equal(r.datos.texto,xml.toString());
    const html=await ejs.renderFile(path.join(__dirname,'../src/views/contabilidad/xml_correo.ejs'),r.datos);assert.ok(html.includes('&lt;FacturaElectronica&gt;'));assert.ok(!html.includes('<script>'));
    for(const [tipo,buffer] of [['xml',xml],['hacienda',h]]){const r=respuesta();await handler({query:{...q,tipo,descargar:'1'}},r,e=>{throw e;});assert.ok(r.buffer.equals(buffer));assert.equal(r.tipo,'application/xml');}
    for(const [query,codigo] of [[{...q,documento:'0'.repeat(64)},404],[{...q,tipo:'otro'},400],[{...q,tipo:'hacienda',respuesta:'9999'},404],[{...q,tipo:'hacienda',respuesta:'-1'},400]]){const r=respuesta();await handler({query},r,e=>{throw e;});assert.equal(r.codigo,codigo);}
    const denegada=respuesta();router.stack[0].handle({session:{user:{rol:'TALLER'}}},denegada,()=>assert.fail('Taller no puede abrir XML'));assert.equal(denegada.codigo,403);
  }finally{s.cargar=original;}
});
