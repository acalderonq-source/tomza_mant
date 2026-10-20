const {test}=require('node:test');
const assert=require('node:assert/strict');
const servicio=require('../src/utils/pasivosPdfOutlook');
const xml=Buffer.from('<FacturaElectronica><Clave>506123</Clave><NumeroConsecutivo>00100001010000012345</NumeroConsecutivo><Emisor><Nombre>DELOITTE</Nombre></Emisor><Receptor><Nombre>GAS TOMZA</Nombre></Receptor></FacturaElectronica>');
test('identifica emisor y receptor y excluye notas de crédito',()=>{
  assert.equal(servicio.facturaXml(xml).empresa,'GAS TOMZA');
  assert.equal(servicio.facturaXml(Buffer.from('<NotaCreditoElectronica/>')),null);
});
test('no asocia PDFs ambiguos con varias facturas',()=>{
  const f=[{numero_factura:'123',xmlNombre:'a.xml'},{numero_factura:'456',xmlNombre:'b.xml'}];
  assert.equal(servicio.asociar({name:'documento.pdf'},f,[{},{}]),null);
  assert.equal(servicio.asociar({name:'b.pdf'},f,[{},{}]),f[1]);
});
test('consulta Outlook con fechas Costa Rica, pagina, descarga PDF y elimina duplicados',async()=>{
  const llamadas=[],descargas=[];
  const cliente={configReady:()=>true,getConnection:async()=>({}),getAccessToken:async()=> 'token',
    graphGet:async(url)=>{
      llamadas.push(url);
      if(url.includes('/attachments?'))return {value:[{id:'x',name:'factura.xml'},{id:'p',name:'factura.pdf'}]};
      if(url.endsWith('/siguiente'))return {value:[{id:'m2',receivedDateTime:'2026-10-20T12:00:00Z'}]};
      return {value:[{id:'m1',receivedDateTime:'2026-10-20T12:00:00Z'}],'@odata.nextLink':'https://graph.microsoft.com/v1.0/siguiente'};
    },graphGetBytes:async(url)=>{descargas.push(url);return url.includes('/x/')?xml:Buffer.from('%PDF-1.7 prueba');}};
  const filas=await servicio.cargar(null,{desde:'2026-10-20',hasta:'2026-10-20'},cliente);
  assert.equal(filas.length,1);assert.equal(filas[0].proveedor_nombre,'DELOITTE');
  assert.equal(descargas.filter(u=>u.includes('/p/')).length,0,'Consultar no descarga ningún PDF');
  assert.equal((await servicio.contenido(null,filas[0])).toString(),'%PDF-1.7 prueba');
  assert.equal(descargas.filter(u=>u.includes('/p/')).length,1);
  assert.equal((await servicio.xml(null,filas[0])).equals(xml),true,'Conserva el XML original sin regenerarlo');
  await servicio.contenido(null,filas[0]);
  assert.equal(descargas.filter(u=>u.includes('/p/')).length,1,'No vuelve a descargar un PDF ya leído');
  const filtro=new URL(llamadas[0]).searchParams.get('$filter');
  assert.match(filtro,/2026-10-20T06:00:00Z/);assert.match(filtro,/2026-10-21T06:00:00.000Z/);
  assert.ok(llamadas.some(u=>u.endsWith('/siguiente')));
});
test('procesa hasta cuatro operaciones a la vez y conserva el orden',async()=>{
  let activos=0,maximo=0;
  const resultado=await servicio.paralelo([1,2,3,4,5,6,7,8],async n=>{
    activos++;maximo=Math.max(maximo,activos);
    await new Promise(resolve=>setImmediate(resolve));activos--;return n*2;
  });
  assert.equal(maximo,4);assert.deepEqual(resultado,[2,4,6,8,10,12,14,16]);
});
test('falta de conexión se informa sin devolver un ZIP vacío',async()=>{
  await assert.rejects(servicio.cargar(null,{}, {configReady:()=>true,getConnection:async()=>null}),/Conectá Outlook/);
});
test('reutiliza adjuntos incluidos por Outlook sin consultar cada mensaje',async()=>{
  let consultas=0;
  const cliente={configReady:()=>true,getConnection:async()=>({}),getAccessToken:async()=> 'token',
    graphGet:async url=>{
      consultas++;assert.ok(!url.includes('/attachments?'));
      assert.match(new URL(url).searchParams.get('$expand'),/^attachments/);
      return {value:[{id:'m1',receivedDateTime:'2026-10-20T12:00:00Z',attachments:[{id:'x',name:'factura.xml'},{id:'p',name:'factura.pdf'}]}]};
    },graphGetBytes:async()=>xml};
  const filas=await servicio.cargar(null,{desde:'2026-10-17',hasta:'2026-10-20'},cliente);
  assert.equal(consultas,1);assert.equal(filas.length,1);
});
test('incluye el XML aunque el correo no tenga PDF',async()=>{
  const cliente={configReady:()=>true,getConnection:async()=>({cuenta_id:'xml-solo'}),getAccessToken:async()=> 'token',
    graphGet:async()=>({value:[{id:'xml-solo',receivedDateTime:'2026-10-20T12:00:00Z',attachments:[{id:'x',name:'factura.xml'}]}]}),graphGetBytes:async()=>xml};
  const filas=await servicio.cargar(null,{desde:'2026-10-17',hasta:'2026-10-20'},cliente);
  assert.equal(filas.length,1);assert.equal(filas[0].disponible,false);
  assert.ok((await servicio.xml(null,filas[0])).equals(xml));
});
