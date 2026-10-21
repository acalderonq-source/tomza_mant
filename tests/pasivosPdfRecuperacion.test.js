const {test}=require('node:test'),assert=require('node:assert/strict');
const s=require('../src/utils/pasivosPdfOutlook');
const {pdfPrueba,lineas,clave}=require('./helpers/facturaPdfPrueba');
const bytes=pdfPrueba(lineas.map(l=>l.replace('CRC 100.00','100.00')));
const xml=Buffer.from(`<NotaCreditoElectronica><Clave>${clave}</Clave><NumeroConsecutivo>00100001030000000118</NumeroConsecutivo><Emisor><Nombre>PABLO CESAR HIDALGO QUIROS</Nombre><Identificacion><Numero>304010806</Numero></Identificacion></Emisor><Receptor><Nombre>Gas Tomza De Costa Rica</Nombre><Identificacion><Numero>3101349880</Numero></Identificacion></Receptor><ResumenFactura><CodigoTipoMoneda><CodigoMoneda>CRC</CodigoMoneda></CodigoTipoMoneda><TotalComprobante>100.00</TotalComprobante></ResumenFactura></NotaCreditoElectronica>`);
const f={desde:'2026-10-17',hasta:'2026-10-21'};
function cliente(id,mensajes){return {configReady:()=>true,getConnection:async()=>({cuenta_id:id}),getAccessToken:async()=> 'token',graphGet:async()=>({value:mensajes}),graphGetBytes:async url=>url.includes('/xml/')?xml:bytes};}
test('recupera PDF sin XML, incluso inline y con nombre genérico, y muestra notas de crédito por defecto',async()=>{
  const rows=await s.cargar(null,f,cliente('pdf-sin-xml',[{id:'solo-pdf',receivedDateTime:'2026-10-20T12:00:00Z',attachments:[{id:'pdf',name:'FacturaElectronica (1).pdf',isInline:true}]}]));
  assert.equal(rows.length,1);assert.equal(rows[0].tipoDocumento,'nota_credito');assert.ok(rows[0].disponible);assert.equal(rows[0].xmlBuffer,undefined);assert.equal(rows[0].fuenteIdentificacion,'PDF');assert.ok((await s.contenido(null,rows[0])).equals(bytes));
});
test('une PDF y XML de correos distintos sin duplicar ni perder adjuntos',async()=>{
  const rows=await s.cargar(null,f,cliente('separados',[
    {id:'solo-pdf',receivedDateTime:'2026-10-20T12:00:00Z',attachments:[{id:'pdf',name:'factura.pdf'}]},
    {id:'solo-xml',receivedDateTime:'2026-10-20T12:01:00Z',attachments:[{id:'xml',name:'nota.xml'}]}
  ]));
  assert.equal(rows.length,1);assert.ok(rows[0].disponible);assert.ok(rows[0].xmlBuffer.equals(xml));assert.equal(rows[0].monto,-100);assert.equal(rows[0].moneda,'CRC');assert.ok((await s.contenido(null,rows[0])).equals(bytes));
});
test('un PDF no identificado genera un aviso visible en lugar de desaparecer',async()=>{
  const c=cliente('no-fiscal',[{id:'no-fiscal',receivedDateTime:'2026-10-20T12:00:00Z',webLink:'https://outlook.office.com/mail/id/1',attachments:[{id:'pdf',name:'desconocido.pdf'}]}]);c.graphGetBytes=async()=>pdfPrueba(['Documento escaneado sin identificacion']);
  const pendientes=await s.cargar(null,f,c);assert.equal(pendientes.length,0);assert.equal(pendientes.revision.pdfSinIdentificar,1);assert.equal(pendientes.advertencias[0].archivo,'desconocido.pdf');assert.match(pendientes.advertencias[0].motivo,/revisión manual/);
});
