const {test}=require('node:test'),assert=require('node:assert/strict');
const s=require('../src/utils/pasivosPdfOutlook'),d=require('../src/utils/pasivosDocumentosCorreo');
const clave='50621102600310244964800100001010000389672143446449';
const factura=Buffer.from(`<FacturaElectronica><Clave>${clave}</Clave><NumeroConsecutivo>00100001010000389672</NumeroConsecutivo><Emisor><Nombre>MAXI REPUESTOS</Nombre><Identificacion><Numero>3102449648</Numero></Identificacion></Emisor><Receptor><Nombre>GAS TOMZA</Nombre><Identificacion><Numero>3101349880</Numero></Identificacion></Receptor><CondicionVenta>02</CondicionVenta><PlazoCredito>30</PlazoCredito></FacturaElectronica>`);
const respuesta=(codigo='1',extra='')=>Buffer.from(`<MensajeHacienda><Clave>${clave}</Clave><NumeroCedulaEmisor>3102449648</NumeroCedulaEmisor><NumeroCedulaReceptor>3101349880</NumeroCedulaReceptor><Mensaje>${codigo}</Mensaje><DetalleMensaje>Detalle original</DetalleMensaje>${extra}</MensajeHacienda>`);
const parser=new (require('fast-xml-parser').XMLParser)({removeNSPrefix:true,parseTagValue:false});
test('condición de venta conserva códigos especiales sin inventar contado o crédito',()=>{
  assert.equal(s.facturaXml(factura).condicionTexto,'Crédito');assert.equal(s.facturaXml(factura).plazoCredito,'30');
  assert.equal(d.condicionVenta('01').condicionPago,'CONTADO');assert.equal(d.condicionVenta('10').condicionPago,'CREDITO');
  assert.equal(d.condicionVenta('99').condicionPago,'OTRA');assert.equal(d.condicionVenta('').condicionPago,'SIN_DATO');
});
test('asocia Hacienda por clave e identidades, conserva originales y descarta respuestas al receptor',async()=>{
  const buffers={f:factura,h:respuesta(),receptor:respuesta('3','<NumeroConsecutivoReceptor>00100001050000000001</NumeroConsecutivoReceptor>')};
  const c={configReady:()=>true,getConnection:async()=>({cuenta_id:'hacienda-estado'}),getAccessToken:async()=> 't',graphGet:async()=>({value:[
    {id:'factura',receivedDateTime:'2026-10-21T12:00:00Z',attachments:[{id:'f',name:'factura.xml'}]},
    {id:'respuesta',receivedDateTime:'2026-10-21T13:00:00Z',attachments:[{id:'h',name:'hacienda.xml'},{id:'receptor',name:'receptor.xml'}]}
  ]}),graphGetBytes:async url=>buffers[decodeURIComponent(url.split('/').at(-2))]};
  const r=await s.cargar(null,{desde:'2026-10-21',hasta:'2026-10-21'},c);
  assert.equal(r.length,1);assert.equal(r[0].estadoHacienda,'ACEPTADO');assert.equal(r[0].respuestasHacienda.length,1);assert.ok(r[0].respuestasHacienda[0].buffer.equals(buffers.h));assert.equal(r[0].condicionPago,'CREDITO');assert.match(r[0].documentoId,/^[a-f0-9]{64}$/);
  assert.equal(d.filtrar(r,{condicion:'CONTADO'}).length,0);assert.equal(d.filtrar(r,{hacienda:'ACEPTADO',proveedor:'maxi'}).length,1);
});
test('respuestas distintas requieren revisión; sin respuesta no significa aceptado ni rechazado',()=>{
  const base={...s.facturaXml(factura),empresa:'GAS TOMZA',fecha_factura:'2026-10-21'};
  const h=c=>({...d.respuestaHacienda(parser.parse(respuesta(c).toString())),buffer:respuesta(c),fecha:'2026-10-21',nombre:'h.xml'});
  assert.equal(d.preparar([{...base}],[])[0].estadoHacienda,'SIN_RESPUESTA');
  assert.equal(d.preparar([{...base}],[h('1'),h('1')])[0].respuestasHacienda.length,1);
  assert.equal(d.preparar([{...base}],[h('1'),h('3')])[0].estadoHacienda,'REVISAR');
  assert.equal(d.preparar([{...base}],[{...h('1'),cedulaReceptor:'3101044021'}])[0].estadoHacienda,'SIN_RESPUESTA');
  assert.equal(d.preparar([{...base}],[{...h('1'),clave:'0'.repeat(50)}])[0].estadoHacienda,'SIN_RESPUESTA');
  assert.equal(d.respuestaHacienda({MensajeReceptor:{Clave:clave,Mensaje:'1'}}),null);
});
