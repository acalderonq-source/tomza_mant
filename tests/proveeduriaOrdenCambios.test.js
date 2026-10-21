const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('node:path');
const pool=require('../src/db'),router=require('../src/routes/proveeduria.routes');
const {articuloExcel,articulosExcel,ivaArticulo,condicionesOrden}=require('../src/utils/proveeduriaCatalogo');
const {definirOrden}=require('../src/utils/pdfOrdenCompra');
const {saldo,hash}=require('../src/utils/proveeduria');
const {vincularOrden}=require('../src/utils/portalFacturaOrden');
test('precios e IVA se conservan como en Excel, incluidos vacíos, exentos y primera coincidencia',()=>{
  assert.equal(articulosExcel.length,411);assert.equal(articuloExcel('Adaptador Tipo C a USB').precio_unitario,885);assert.equal(articuloExcel('Azúcar (2kg)').iva,1);assert.equal(ivaArticulo('Envio Impresora'),0);assert.equal(ivaArticulo('Artículo nuevo'),13);
  assert.equal(articuloExcel('Calca TOMZA para tanque estacionario.').precio_unitario,null);
  const fuente=require('../src/data/proveeduriaArticulosExcel.json');assert.equal(articuloExcel('Cloro').precio_unitario,fuente.articulos.find(a=>a.descripcion==='Cloro').precio_unitario);
  for(const n of [0,15,30,60,90])assert.equal(condicionesOrden({credito:String(n)}).credito,n);
  for(const n of ['',null,undefined,-1,1.5,3651])assert.throws(()=>condicionesOrden({credito:n}));
});
test('Super Gas usa rojo en PDF y muestra el plazo sin duplicar los días',()=>{
  const o={empresa_destino:'SUPER GAS',forma_pago:'Crédito',credito:45,subtotal:100,total:113,iva:13};
  const sg=definirOrden(o,{},[]),gt=definirOrden({...o,empresa_destino:'GAS TOMZA'}, {},[]);
  assert.equal(sg.styles.tableHeader.fillColor,'#b91c1c');assert.equal(gt.styles.tableHeader.fillColor,'#1f4e79');assert.doesNotMatch(JSON.stringify(sg),/#1f4e79/);assert.match(JSON.stringify(sg),/45 días/);
  const ya=JSON.stringify(definirOrden({...o,forma_pago:'Crédito 45 días'}));assert.doesNotMatch(ya,/45 días · 45 días/);
});
async function servidor(user,run){
  const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));app.use(express.json());app.use(express.urlencoded({extended:true}));app.use((req,res,next)=>{req.session={user};next();});app.use('/proveeduria',router);
  const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));try{await run(`http://127.0.0.1:${s.address().port}/proveeduria`);}finally{await new Promise(r=>s.close(r));}
}
test('OC directa recalcula IVA del catálogo y respeta el precio editado y días de crédito',async()=>{
  const q=pool.query,c=pool.getConnection;let oc;
  pool.query=async()=>[[]];pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql,args)=>{if(sql.startsWith('SELECT codigo FROM prov_inventario_bajas'))return [[]];if(sql.includes("VALUES ('oc'"))oc=JSON.parse(args[2]);return [{insertId:9}];}});
  try{await servidor({id:1,usuario:'compras',rol:'PROVEEDURIA',sede:'Cartago',departamentoActivo:'PROVEEDURIA'},async base=>{
    const body=new URLSearchParams({origen_formulario:'taller',cotizacion_data:'data:application/pdf;base64,JVBERi0xLjQK',cotizacion_nombre:'cotizacion.pdf',sede:'Cartago',proveedor:'Proveedor',email:'p@example.com',entrega:'5 días',empresa_destino:'SUPER GAS',moneda:'CRC',credito:'45',forma_pago:'Crédito',iva:'99','lineas[0][descripcion]':'Azúcar (2kg)','lineas[0][cantidad]':'2','lineas[0][precio_unitario]':'1500','lineas[1][descripcion]':'Envio Impresora','lineas[1][cantidad]':'1','lineas[1][precio_unitario]':'100'});
    assert.equal((await fetch(base+'/ordenes',{method:'POST',body,redirect:'manual'})).status,302);assert.equal(oc.impuesto,30);assert.equal(oc.total,3130);assert.equal(oc.lineas[0].precio_unitario,1500);assert.equal(oc.lineas[0].iva,1);assert.equal(oc.lineas[1].iva,0);assert.equal(oc.credito,45);assert.equal(oc.iva_global,false);
    body.set('empresa_destino','GRANEL');assert.equal((await fetch(base+'/ordenes',{method:'POST',body,redirect:'manual'})).status,400);
  });}finally{pool.query=q;pool.getConnection=c;}
});
test('se pueden sumar facturas al flujo anterior sin exceder el monto total',async()=>{
  const row={id:5,datos:{proveedor:'Proveedor',moneda:'CRC',pagos:[],factura:{total:50,estado:'PENDIENTE',electronica:{nombre_emisor:'Proveedor',fecha:'2026-10-16'}}}};
  let importe=0;
  const db={query:async(sql)=>{
    if(sql.includes("tipo='oc'"))return [[{id:7,datos:{proveedor:'Proveedor',moneda:'CRC',total:100,credito:30,factura:{total:40,estado:'CONCILIADA'}}}]];
    if(sql.includes('SUM'))return [[{total:importe}]];return [{affectedRows:1}];
  }};
  await vincularOrden(db,row,{origen:'PROVEEDURIA',referencia:'PR-7'},1);assert.equal(row.datos.factura.fecha_vencimiento,'2026-11-15');
  row.datos.orden_compra=undefined;importe=11;await assert.rejects(vincularOrden(db,row,{origen:'PROVEEDURIA',referencia:'PR-7'},1),/supera/);
  const resultado=saldo({factura:{total:40},pagos:[{monto:10}],facturas_vinculadas:[{factura:{total:50,estado:'CONCILIADA'},pagos:[{monto:20}]}]});assert.equal(resultado.facturado,90);assert.equal(resultado.pagos,30);assert.equal(resultado.saldo,60);
  assert.equal(saldo({factura:{total:40,estado:'DEVUELTA'},pagos:[],facturas_vinculadas:[{factura:{total:50,estado:'PENDIENTE'},pagos:[]}]}).facturado,50);
});
test('enlace privado admite dos facturas parciales, rechaza duplicados y revierte un exceso',async()=>{
  const q=pool.query,c=pool.getConnection,token='b'.repeat(64);
  let docs=new Map([[7,{id:7,tipo:'oc',sede:'Cartago',datos:{portal_hash:hash(token),portal_vence:Date.now()+60000,proveedor:'Proveedor',razon_social:'Tomza',moneda:'CRC',credito:30,total:113,lineas:[{codigo:'P1',descripcion:'Papel',cantidad:1,precio_unitario:100,iva:13}],pagos:[]}}]]),claves=new Map(),links=new Map(),files=new Map(),id=10,file=100;
  async function query(sql,args=[]){
    if(sql.includes('portal_hash'))return [[structuredClone(docs.get(7))]];
    if(sql.startsWith('SELECT * FROM prov_documentos WHERE id')){const d=docs.get(Number(args[0]));return [d?[structuredClone(d)]:[]];}
    if(sql.includes('SUM'))return [[{total:[...links.entries()].filter(([i])=>i!==args[2]).reduce((s,[i,m])=>s+m,0)}]];
    if(sql.includes('SELECT d.* FROM prov_portal_factura_orden'))return [[...links.keys()].map(i=>structuredClone(docs.get(i)))];
    if(sql.includes('SELECT documento_id'))return [claves.has(args[0])?[{documento_id:claves.get(args[0])}]:[]];
    if(sql.startsWith('INSERT INTO prov_adjuntos')){const fid=file++;files.set(fid,args[2]);return [{insertId:fid}];}
    if(sql.startsWith('INSERT INTO prov_documentos')){const fid=id++;docs.set(fid,{id:fid,tipo:'factura_portal',sede:args[0],datos:JSON.parse(args[1])});return [{insertId:fid}];}
    if(sql.startsWith('UPDATE prov_documentos'))docs.get(Number(args[1])).datos=JSON.parse(args[0]);
    if(sql.startsWith('INSERT INTO prov_facturas_claves'))claves.set(args[0],args[1]);
    if(sql.startsWith('INSERT INTO prov_portal_factura_orden'))links.set(args[0],args[3]);
    if(sql.includes('SELECT contenido'))return [[{contenido:files.get(Number(args[0]))}]];
    return [{affectedRows:1}];
  }
  pool.query=query;pool.getConnection=async()=>{let snapshot;return {query,beginTransaction:async()=>{snapshot=structuredClone([docs,claves,links,files]);},commit:async()=>{},rollback:async()=>{[docs,claves,links,files]=snapshot;},release(){}};};
  const body=n=>{const consecutivo='0010000101000000000'+n,clave='506161026003101123456'+consecutivo+'112345678',xml=`<FacturaElectronica><Clave>${clave}</Clave><NumeroConsecutivo>${consecutivo}</NumeroConsecutivo><FechaEmision>2026-10-16T10:00:00-06:00</FechaEmision><Emisor><Nombre>Proveedor</Nombre><Identificacion><Numero>3101123456</Numero></Identificacion></Emisor><Receptor><Nombre>Tomza</Nombre><Identificacion><Numero>3101654321</Numero></Identificacion></Receptor><ResumenFactura><TotalComprobante>56.5</TotalComprobante></ResumenFactura></FacturaElectronica>`;return {numero:consecutivo,proveedor:'Proveedor',moneda:'CRC',total:56.5,lineas:[{codigo:'P1',descripcion:'Papel',cantidad:0.5,precio_unitario:100,iva:13}],archivo:{nombre:'factura.pdf',base64:Buffer.from('%PDF-1.7 ejemplo').toString('base64')},xml:{nombre:'factura.xml',base64:Buffer.from(xml).toString('base64')}};};
  const post=b=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  try{await servidor(null,async base=>{
    for(const n of [1,2]){const r=await fetch(base+'/portal/'+token+'/factura',post(body(n)));assert.equal(r.status,200,await r.text());}
    assert.equal(links.size,2);assert.equal(docs.get(7).datos.factura,undefined);assert.equal(docs.get(10).datos.factura.fecha_vencimiento,'2026-11-15');
    assert.equal((await fetch(base+'/portal/'+token+'/factura',post(body(1)))).status,400);
    assert.equal((await fetch(base+'/portal/'+token+'/factura',post(body(3)))).status,400);assert.equal(links.size,2);assert.equal(docs.size,3);
    const page=await fetch(base+'/portal/'+token);assert.equal(page.status,200);const html=await page.text();assert.match(html,/00100001010000000001/);assert.match(html,/00100001010000000002/);assert.match(html,/113.00/);
    const download=await fetch(base+'/portal/'+token+'/facturas/10/adjunto/factura');assert.equal(download.status,200);
    docs.set(99,{id:99,tipo:'factura_portal',datos:{orden_compra:{origen:'PROVEEDURIA',id:88}}});assert.equal((await fetch(base+'/portal/'+token+'/facturas/99/adjunto/factura')).status,403);
  });}finally{pool.query=q;pool.getConnection=c;}
});
