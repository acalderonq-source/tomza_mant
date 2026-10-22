const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('node:path');
const pool=require('../src/db'),routes=require('../src/routes/proveeduria.routes');
const {versionOrden}=require('../src/utils/proveeduriaOrdenEdicion');
const gestor={id:7,usuario:'compras',rol:'PROVEEDURIA',departamentoActivo:'PROVEEDURIA',sede:'Cartago'};
const linea={codigo:'AZ',descripcion:'Azúcar (2kg)',cantidad:2,precio_unitario:1450,iva:1,subtotal:2900,impuesto:29};
async function servidor(user,run){
  const app=express();app.set('views',path.join(__dirname,'../src/views'));app.set('view engine','ejs');app.use(express.json());app.use(express.urlencoded({extended:true}));app.use((req,res,next)=>{req.session={user};next();});app.use('/proveeduria',routes);
  const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));try{await run(`http://127.0.0.1:${s.address().port}/proveeduria`);}finally{await new Promise(r=>s.close(r));}
}
async function almacen(run){
  const oq=pool.query,oc=pool.getConnection;
  const state={docs:new Map([[1,{id:1,tipo:'oc',usuario_id:33,sede:'Cartago',creado_en:new Date(),datos:{estado:'GENERADA',solicitud_id:2,proveedor:'Proveedor',razon_social:'GAS TOMZA DE COSTA RICA S.A.',empresa_destino:'GAS TOMZA',email:'p@example.com',entrega:'5 días',moneda:'CRC',credito:30,forma_pago:'Crédito',lineas:[structuredClone(linea)],subtotal:2900,impuesto:29,total:2929,pagos:[],portal_hash:'anterior',portal_vence:Date.now()+10000,cotizacion_archivo:{id:55,nombre:'original.pdf'},cotizacion_nombre:'original.pdf'}}],[2,{id:2,tipo:'solicitud',usuario_id:33,sede:'Cartago',datos:{oc_id:1,estado:'ORDENADA',origen:'OC_DIRECTA',lineas:[structuredClone(linea)]}}]]),linked:false,audits:[],rollback:0,mutaciones:0,fallar:false,consultas:[]};
  async function query(sql,args=[]){
    sql=sql.trim();
    state.consultas.push(sql);
    if(sql.startsWith('SELECT * FROM prov_documentos WHERE id')){const d=state.docs.get(Number(args[0]));return [d&&d.tipo===args[1]?[structuredClone(d)]:[]];}
    if(sql.includes('SELECT factura_id FROM prov_portal_factura_orden'))return [state.linked?[{factura_id:44}]:[]];
    if(sql.includes("WHERE tipo='oc'"))return [[...state.docs.values()].filter(d=>d.tipo==='oc').map(d=>structuredClone(d))];
    if(sql.startsWith('SELECT'))return [[]];
    state.mutaciones++;
    if(sql.startsWith('UPDATE prov_documentos SET datos'))state.docs.get(Number(args[1])).datos=JSON.parse(args[0]);
    if(sql.startsWith('UPDATE prov_documentos SET sede'))state.docs.get(Number(args[1])).sede=args[0];
    if(sql.includes("SET tipo='oc_eliminada'"))state.docs.get(Number(args[0])).tipo='oc_eliminada';
    if(sql.startsWith('INSERT INTO prov_auditoria')){if(state.fallar)throw Error('Fallo de auditoría');state.audits.push(args);}
    return [{affectedRows:1,insertId:77}];
  }
  pool.query=query;pool.getConnection=async()=>{let snapshot;return {query,beginTransaction:async()=>{snapshot=structuredClone({docs:state.docs,audits:state.audits,mutaciones:state.mutaciones});},commit:async()=>{},rollback:async()=>{Object.assign(state,snapshot);state.rollback++;},release(){}};};
  try{await run(state);}finally{pool.query=oq;pool.getConnection=oc;}
}
function formulario(state,extra={}){
  return new URLSearchParams({origen_formulario:'taller',version:versionOrden(state.docs.get(1)),sede:'Cartago',proveedor:'Proveedor editado',email:'nuevo@example.com',entrega:'7 días',empresa_destino:'SUPER GAS',moneda:'CRC',credito:'45',descuento:'0',transporte:'0','lineas[0][codigo_producto]':'AZ','lineas[0][descripcion]':'Azúcar (2kg)','lineas[0][cantidad]':'2','lineas[0][precio_unitario]':'1500',...extra});
}
const post=body=>({method:'POST',body,redirect:'manual'});
const borrar=version=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version})});

test('lugar de entrega se edita, vuelve a mostrarse y se incluye en el PDF sin alterar el plazo',async()=>{
  await almacen(state=>servidor(gestor,async base=>{
    assert.match(await (await fetch(base+'/ordenes/1/editar')).text(),/name="lugar_entrega"/);
    const r=await fetch(base+'/ordenes/1/editar',post(formulario(state,{lugar_entrega:'Bodega Proveeduría, Cartago, portón 2'})));
    assert.equal(r.status,302);assert.equal(state.docs.get(1).datos.lugar_entrega,'Bodega Proveeduría, Cartago, portón 2');
    assert.equal(state.docs.get(1).datos.entrega,'7 días');
    const html=await (await fetch(base+'/ordenes/1/editar')).text();assert.match(html,/value="Bodega Proveeduría, Cartago, portón 2"/);
    const pdf=await fetch(base+'/ordenes/1/pdf');assert.equal(pdf.status,200);assert.match(pdf.headers.get('content-type'),/pdf/);
    const {definirOrden}=require('../src/utils/pdfOrdenCompra');
    assert.match(JSON.stringify(definirOrden(state.docs.get(1).datos)),/Bodega Proveeduría, Cartago, portón 2/);
    assert.equal((await fetch(base+'/ordenes/1/editar',post(formulario(state,{lugar_entrega:'x'.repeat(501)})))).status,400);
  }));
});
test('editar usa el formulario de Taller, conserva el número, actualiza solicitud directa y revoca el portal anterior',async()=>{
  await almacen(state=>servidor(gestor,async base=>{
    const pagina=await fetch(base+'/ordenes/1/editar');assert.equal(pagina.status,200);const html=await pagina.text();assert.match(html,/Actualizar orden/);assert.match(html,/PR-1/);assert.match(html,/name="version" value="[a-f0-9]{64}"/);assert.match(html,/action="\/proveeduria\/ordenes\/1\/editar"/);assert.match(html,/precio_unitario":1450/);
    const r=await fetch(base+'/ordenes/1/editar',post(formulario(state,{sede:'Alajuela','lineas[0][cantidad]':'3',solicitud_id:'999',total:'1'})));assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/proveeduria/ordenes/1?actualizada=1');
    const o=state.docs.get(1);assert.equal(o.id,1);assert.equal(o.sede,'Alajuela');assert.equal(o.datos.total,4545);assert.equal(o.datos.impuesto,45);assert.equal(o.datos.credito,45);assert.equal(o.datos.revision,1);assert.equal(o.datos.solicitud_id,2);assert.equal(o.datos.portal_hash,undefined);assert.equal(o.datos.cotizacion_archivo.id,55);assert.equal(o.datos.pagos.length,0);
    assert.equal(state.docs.get(2).datos.lineas[0].cantidad,3);assert.equal(state.docs.get(2).sede,'Alajuela');assert.equal(state.docs.size,2);assert.ok(state.consultas.some(sql=>sql.includes('FOR UPDATE')));
  }));
});
test('formularios desactualizados y cambios a artículos de otro departamento se rechazan',async()=>{
  await almacen(state=>servidor(gestor,async base=>{
    const vieja=formulario(state);state.docs.get(1).datos.observaciones='Cambio de otro usuario';assert.equal((await fetch(base+'/ordenes/1/editar',post(vieja))).status,400);assert.equal(state.mutaciones,0);
    state.docs.get(2).datos.departamento='OPERACIONES';assert.equal((await fetch(base+'/ordenes/1/editar',post(formulario(state,{'lineas[0][cantidad]':'3'})))).status,400);assert.equal(state.mutaciones,0);
    assert.equal((await fetch(base+'/ordenes/1/editar',post(formulario(state)))).status,302);assert.equal(state.docs.get(1).datos.total,3030);assert.equal(state.docs.get(2).datos.lineas[0].cantidad,2);
  }));
});
test('eliminar retira la OC, conserva auditoría y libera la solicitud para generar otra',async()=>{
  await almacen(state=>servidor(gestor,async base=>{
    state.docs.get(2).datos.cotizacion={lineas:[linea]};
    const lista=await fetch(base+'/ordenes');assert.equal(lista.status,200);const html=await lista.text();assert.match(html,/Editar orden/);assert.match(html,/Eliminar orden/);assert.match(html,/data-confirm=/);
    const r=await fetch(base+'/ordenes/1/eliminar',borrar(versionOrden(state.docs.get(1))));assert.equal(r.status,200);assert.equal((await r.json()).redirect,'/proveeduria/ordenes');assert.equal(state.docs.get(1).tipo,'oc_eliminada');assert.equal(state.docs.get(1).datos.eliminada_por,7);assert.equal(state.docs.get(1).datos.portal_hash,undefined);assert.equal(state.docs.get(2).datos.oc_id,undefined);assert.equal(state.docs.get(2).datos.estado,'COTIZADA');assert.ok(state.audits.some(a=>a[2]==='Orden de compra eliminada'));
    assert.equal((await fetch(base+'/ordenes/1')).status,404);assert.equal((await fetch(base+'/ordenes/1/eliminar',borrar('vieja'))).status,404);assert.doesNotMatch(await (await fetch(base+'/ordenes')).text(),/PR-1/);
  }));
});
test('recibidas, parcialmente recibidas, facturadas y pagadas no se editan ni eliminan',async()=>{
  for(const cambio of [{estado:'RECIBIDA'},{estado:'PARCIAL'},{recepciones:[{id:'R1'}]},{factura:{numero:'F1'}},{pagos:[{referencia:'P1'}]}])await almacen(state=>servidor(gestor,async base=>{
    Object.assign(state.docs.get(1).datos,cambio);
    assert.equal((await fetch(base+'/ordenes/1/editar')).status,400);assert.equal((await fetch(base+'/ordenes/1/editar',post(formulario(state)))).status,400);assert.equal((await fetch(base+'/ordenes/1/eliminar',borrar(versionOrden(state.docs.get(1))))).status,400);assert.equal(state.mutaciones,0);
  }));
  await almacen(state=>servidor(gestor,async base=>{state.linked=true;assert.equal((await fetch(base+'/ordenes/1/editar')).status,400);assert.equal((await fetch(base+'/ordenes/1/eliminar',borrar(versionOrden(state.docs.get(1))))).status,400);assert.equal(state.mutaciones,0);}));
});
test('permisos, sedes y rollback evitan cambios no autorizados o incompletos',async()=>{
  for(const user of [{...gestor,rol:'CONTABILIDAD',departamentoActivo:'CONTABILIDAD'},{...gestor,rol:'BODEGA',sede:'Guapiles'}])await almacen(state=>servidor(user,async base=>{
    assert.equal((await fetch(base+'/ordenes/1/editar')).status,403);assert.equal((await fetch(base+'/ordenes/1/editar',post(formulario(state)))).status,403);assert.equal((await fetch(base+'/ordenes/1/eliminar',borrar(versionOrden(state.docs.get(1))))).status,403);assert.equal(state.mutaciones,0);
  }));
  await almacen(state=>servidor(gestor,async base=>{state.fallar=true;const anterior=structuredClone(state.docs);assert.equal((await fetch(base+'/ordenes/1/editar',post(formulario(state)))).status,500);assert.deepEqual(state.docs,anterior);assert.equal((await fetch(base+'/ordenes/1/eliminar',borrar(versionOrden(state.docs.get(1))))).status,500);assert.deepEqual(state.docs,anterior);}));
});
