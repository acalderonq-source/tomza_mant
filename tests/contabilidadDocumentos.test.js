const test=require('node:test');
const assert=require('node:assert/strict');
const ejs=require('ejs');
const path=require('node:path');
const servicio=require('../src/utils/contabilidadDocumentos');
const factura=(id,extra={})=>({origen:'TALLER',id,tipo:'factura',numero:`F-${id}`,fecha:'2026-10-01',empresa:'GAS TOMZA',moneda:'CRC',proveedor:'Proveedor',total:10000,pagado:2500,clave:'',estadoOrigen:'',...extra});
test('las facturas registradas no requieren una segunda aceptación y conservan pagos parciales',()=>{
  const d=factura(1);servicio.preparar([d]);assert.equal(d.incluido,true);assert.equal(d.saldo,7500);assert.equal(d.estado,'REGISTRADA');assert.equal(d.estadoPago,'PARCIAL');
  servicio.preparar([d],[{documento:d.key,estado:'DEVUELTA'}]);assert.equal(d.incluido,true);
});
test('solo el portal depende de su aprobación canónica y Hacienda producción',()=>{
  const d=factura(2,{portal:true,estadoOrigen:'PENDIENTE',clave:'123',hacienda:'ACEPTADA',ambienteHacienda:'produccion'});
  servicio.preparar([d]);assert.equal(d.incluido,false);assert.equal(d.estado,'PENDIENTE');
  d.aprobadaPortal=true;d.estadoOrigen='CONCILIADA';servicio.preparar([d]);assert.equal(d.incluido,true);assert.equal(d.estado,'ACEPTADA');
  d.ambienteHacienda='sandbox';servicio.preparar([d]);assert.equal(d.incluido,false);
});
test('duplicados entre fuentes quedan visibles pero excluidos, incluso aceptados',()=>{
  const a=factura(1,{clave:'123',hacienda:'ACEPTADA'}),b=factura(9,{origen:'PROVEEDURIA',clave:'123',hacienda:'ACEPTADA'});
  servicio.preparar([a,b]);servicio.preparar([a,b],[{documento:a.key,huella:a.huella,estado:'ACEPTADA'}]);
  assert.equal(a.incluido,false);assert.match(a.motivos.join(),/duplicado/);assert.equal(b.incluido,false);
});
test('órdenes y caja chica pagada no se suman al pasivo',()=>{
  const a=factura(1,{tipo:'orden'}),b=factura(2,{caja:true,pagado:10000});
  servicio.preparar([a,b]);servicio.preparar([a,b],[a,b].map(d=>({documento:d.key,huella:d.huella,estado:'ACEPTADA'})));
  assert.equal(a.incluido,false);assert.equal(b.incluido,false);assert.equal(b.saldo,0);
});
test('Hacienda rechazada, portal sin conciliar y electrónico sin enlace bloquean inclusión',()=>{
  for(const extra of [{clave:'123',hacienda:'RECHAZADA'},{portal:true,aprobadaPortal:false},{pendienteVinculo:true},{estadoOrigen:'ANULADA'}]){
    const d=factura(1,extra);servicio.preparar([d]);servicio.preparar([d],[{documento:d.key,huella:d.huella,estado:'ACEPTADA'}]);assert.equal(d.incluido,false);assert.ok(d.motivos.length);
  }
});
test('consulta todas las fuentes sin truncar y enlazados electrónicos no se duplican',async()=>{
  const db={async query(sql){
    if(sql.includes('FROM ordenes_compra o'))return [[{id:1,po_numero:'OC-1',fecha:'2026-10-01',empresa_destino:'GAS TOMZA',moneda:'CRC',total:100,factura:'F-1',factura_fecha:'2026-10-01',factura_clave_electronica:'abc'}]];
    if(sql.includes('FROM carburacion_ordenes'))return [[{id:2,po_numero:'CAR-2',lineas_json:'[]',total:300,moneda:'USD'}]];
    if(sql.includes('FROM carburacion_facturas'))return [[{id:3,orden_id:2,numero:'CAR-F',fecha:'2026-10-02',total:300,pagado:100,moneda:'USD'}]];
    if(sql.includes('FROM facturas_electronicas_cruce'))return [[{id:4,clave:'abc',orden_compra_id:1},{id:5,clave:'xyz',monto_total:50,numero_factura:'FE'}]];
    return [[]];
  }};
  const {docs,advertencias}=await servicio.cargar(db);assert.equal(advertencias.length,0);assert.equal(docs.length,5);
  assert.equal(docs.filter(d=>d.origen==='ELECTRONICA').length,1);assert.equal(docs.find(d=>d.numero==='CAR-F').saldo,20000);
  assert.equal(servicio.filtrar(docs,{tipo:'orden'}).length,2);
});
test('vistas de bandeja y revisión escapan contenido y muestran filtros y alcance',async()=>{
  const d=factura(1,{proveedor:'<script>alert(1)</script>'});servicio.preparar([d]);
  const user={rol:'CONTABILIDAD'};
  const html=await ejs.renderFile(path.join(__dirname,'../src/views/contabilidad/documentos.ejs'),{user,docs:[d],total:1,pagina:1,paginas:1,filtros:{},advertencias:[],empresas:['GAS TOMZA'],resumen:[{moneda:'CRC',saldo:0}],proveedores:[],pendientesPortal:[]});
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('/contabilidad/documentos/exportar?'));
  const detalle=await ejs.renderFile(path.join(__dirname,'../src/views/contabilidad/documento.ejs'),{user,d,historial:[],empresas:['GAS TOMZA']});
  assert.ok(!detalle.includes('Aceptar para pasivos'));assert.ok(!detalle.includes('name="huella"'));
  const portal=await ejs.renderFile(path.join(__dirname,'../src/views/contabilidad/documento.ejs'),{user,d:{...d,portal:true},historial:[],empresas:['GAS TOMZA']});assert.ok(portal.includes('Revisar en el portal'));assert.ok(!portal.includes('/revision"'));
});
test('ruta consolidada restringe consulta y revisión a ADMIN y CONTABILIDAD',()=>{
  const router=require('../src/routes/contabilidadDocumentos.routes'),middleware=router.stack[0].handle;
  for(const rol of ['ADMIN','CONTABILIDAD']){let allowed=false;middleware({session:{user:{rol}}},{set(){},locals:{}},()=>{allowed=true;});assert.equal(allowed,true);}
  let status;middleware({session:{user:{rol:'TALLER'}}},{status(v){status=v;return this;},send(){}},()=>assert.fail());assert.equal(status,403);
});
test('formularios anteriores no escriben revisiones y el portal usa su flujo original',async()=>{
  const express=require('express'),router=require('../src/routes/contabilidadDocumentos.routes');
  const originalCargar=servicio.cargar;
  servicio.cargar=async()=>{const docs=[factura(33),factura(34,{portal:true,origen:'PROVEEDURIA'})];servicio.preparar(docs);return {docs,advertencias:[]};};
  const app=express();app.use(express.urlencoded({extended:false}));app.use((req,res,next)=>{req.session={user:{id:17,rol:'CONTABILIDAD'}};next();});app.use('/documentos',router);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}/documentos/`;
    let r=await fetch(base+'TALLER:factura:33/revision',{method:'POST',redirect:'manual'});assert.equal(r.status,403);
    r=await fetch(base+'PROVEEDURIA:factura:34/revision',{method:'POST',redirect:'manual'});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/proveeduria/portal-proveedores/facturas#portal-factura-34');
  }finally{await new Promise(resolve=>server.close(resolve));servicio.cargar=originalCargar;}
});
test('vencimientos y resumen mantienen saldos confirmados, excluidos y monedas separadas',()=>{
  const docs=[factura(1,{vencimiento:'2026-09-01'}),factura(2,{moneda:'USD',pagado:10000}),factura(3,{empresa:''}),factura(4,{portal:true,moneda:'USD'})];
  servicio.preparar(docs,[],'2026-10-16');assert.equal(docs[0].diasVencidos,45);assert.equal(docs[0].tramoVencimiento,'31–60 días');assert.equal(docs[0].estadoPago,'VENCIDA');assert.equal(docs[1].estadoPago,'PAGADA');
  const r=servicio.resumen(docs);assert.equal(r[0].saldo,7500);assert.equal(r[0].vencido,7500);assert.equal(r[0].excluido,7500);assert.equal(r[1].saldo,0);assert.equal(r[1].pendientesPortal,1);
  assert.equal(servicio.filtrar(docs,{pago:'VENCIDA'}).length,1);
});

test('cuentas por proveedor separan empresa y moneda y cuadran con los totales',()=>{
 const docs=[factura(1,{proveedor:'Proveedor A',vencimiento:'2026-09-01'}),factura(2,{proveedor:' proveedor   a ',pagado:0,vencimiento:'2026-11-01'}),factura(3,{proveedor:'Proveedor A',empresa:'SUPER GAS'}),factura(4,{proveedor:'Proveedor A',moneda:'USD'}),factura(5,{proveedor:'Proveedor B',pagado:10000}),factura(6,{proveedor:'Proveedor A',portal:true})];
 servicio.preparar(docs,[],'2026-10-16');const grupos=servicio.porProveedor(docs);assert.equal(grupos.length,3);
 const crc=grupos.find(g=>g.empresa==='GAS TOMZA'&&g.moneda==='CRC');assert.equal(crc.facturas,2);assert.equal(crc.saldo,17500);assert.equal(crc.vencido,7500);assert.equal(crc.porVencer,10000);assert.equal(crc.sinVencimiento,0);
 for(const r of servicio.resumen(docs))assert.equal(grupos.filter(g=>g.moneda===r.moneda).reduce((s,g)=>s+g.saldo,0),r.saldo);
 assert.equal(servicio.filtrar(docs,{proveedor:'PROVEEDOR A'}).length,5);
});
