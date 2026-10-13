const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const path=require('node:path');
const pool=require('../src/db');
const routes=require('../src/routes/proveeduria.routes');
const {resumenRecepcion,leerRecepcion,validarPendientes}=require('../src/utils/proveeduriaRecepciones');
const gestor={id:10,usuario:'compras',nombre:'Compras',rol:'PROVEEDURIA',departamentoActivo:'PROVEEDURIA',sede:'Cartago'};
const lineas=[{codigo:'A',descripcion:'Papel',cantidad:3,iva:13},{codigo:'B',descripcion:'Guantes',cantidad:2.5,iva:13}];
const solicitud=()=>({id:2,tipo:'solicitud',usuario_id:30,sede:'Cartago',datos:{estado:'ORDENADA',oc_id:1}});
const orden=()=>({id:1,tipo:'oc',usuario_id:30,sede:'Cartago',creado_en:new Date(),datos:{estado:'GENERADA',proveedor:'Proveedor prueba',solicitud_id:2,lineas:structuredClone(lineas)}});
const entrega=(extra={})=>({token:'a'.repeat(32),version:0,referencia:'Remisión 12',observaciones:'Revisado',lineas:[{codigo:'A',cantidad:1},{codigo:'B',cantidad:0}],...extra});
const post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function servidor(user,run){
  const app=express();app.set('views',path.join(__dirname,'../src/views'));app.set('view engine','ejs');app.use(express.json());app.use((req,res,next)=>{req.session={user};next();});app.use('/proveeduria',routes);
  const listener=app.listen(0,'127.0.0.1');await new Promise(r=>listener.once('listening',r));
  try{await run(`http://127.0.0.1:${listener.address().port}/proveeduria`);}finally{await new Promise(r=>listener.close(r));}
}
async function almacen(run){
  const originalQuery=pool.query,originalConnection=pool.getConnection;
  const state={docs:new Map([[1,orden()],[2,solicitud()]]),stock:new Map(),movimientos:[],alertas:[],fallar:false,rollback:0};
  async function query(sql,args=[]){
    if(sql.includes('FROM usuarios_sedes'))return [[]];
    if(sql.startsWith('SELECT * FROM prov_documentos WHERE id')){const d=state.docs.get(Number(args[0]));return [d&&d.tipo===args[1]?[structuredClone(d)]:[]];}
    if(sql.startsWith('SELECT * FROM prov_documentos'))return [[...state.docs.values()].filter(d=>d.tipo==='oc'&&args.includes(d.sede)).map(d=>structuredClone(d))];
    if(sql.startsWith('INSERT INTO prov_inventario ('))state.stock.set(args[1],(state.stock.get(args[1])||0)+args[4]);
    if(sql.startsWith('INSERT INTO prov_inventario_movimientos')){if(state.fallar)throw Error('Fallo del registro de movimientos');state.movimientos.push(args);}
    if(sql.startsWith('UPDATE prov_documentos'))state.docs.get(Number(args[1])).datos=JSON.parse(args[0]);
    if(sql.startsWith('INSERT INTO prov_alertas'))state.alertas.push(args);
    return [{affectedRows:1}];
  }
  pool.query=query;
  pool.getConnection=async()=>{let snapshot;return {query,beginTransaction:async()=>{snapshot=structuredClone(state);},commit:async()=>{},rollback:async()=>{const n=state.rollback+1;Object.assign(state,snapshot,{rollback:n});},release(){}};};
  try{await run(state);}finally{pool.query=originalQuery;pool.getConnection=originalConnection;}
}
test('recepción valida referencia, decimales, artículos, sobreentregas y formularios desactualizados',()=>{
  const resumen=resumenRecepcion(orden().datos);
  for(const change of [{token:''},{referencia:''},{version:undefined},{lineas:[]},{lineas:[{codigo:'A',cantidad:0}]},{lineas:[{codigo:'A',cantidad:-1}]},{lineas:[{codigo:'A',cantidad:0.0001}]},{lineas:[{codigo:'A',cantidad:1},{codigo:'A',cantidad:1}]}])assert.throws(()=>leerRecepcion(entrega(change)));
  for(const change of [{version:1},{lineas:[{codigo:'A',cantidad:4}]},{lineas:[{codigo:'AJENO',cantidad:1}]}])assert.throws(()=>validarPendientes(resumen,leerRecepcion(entrega(change))));
  validarPendientes(resumen,leerRecepcion(entrega()));
});
test('OC antigua recibida se conserva completa sin añadir nuevas existencias',async()=>{
  await almacen(async state=>{
    state.docs.get(1).datos.estado='RECIBIDA';const resumen=resumenRecepcion(state.docs.get(1).datos);assert.equal(resumen.anterior,true);assert.equal(resumen.lineas[0].pendiente,0);
    await servidor(gestor,async base=>{assert.equal((await fetch(base+'/ordenes/1/recibir',post(entrega()))).status,400);const r=await fetch(base+'/ordenes/1/recepcion');assert.equal(r.status,200);assert.match(await r.text(),/Se conserva su ingreso original/);});
    assert.equal(state.stock.size,0);
  });
});
test('entregas parciales actualizan solo lo recibido, protegen reintentos y completan la solicitud al final',async()=>{
  await almacen(async state=>servidor(gestor,async base=>{
    const parcial=await fetch(base+'/ordenes/1/recibir',post(entrega()));assert.equal(parcial.status,200);assert.equal((await parcial.json()).estado,'PARCIAL');
    assert.equal(state.stock.get('A'),1);assert.equal(state.stock.has('B'),false);assert.equal(state.movimientos.length,1);assert.equal(state.docs.get(2).datos.estado,'ORDENADA');
    const recibo=state.docs.get(1).datos.recepciones[0];assert.equal(recibo.recibido_por,'Compras');assert.equal(recibo.referencia,'Remisión 12');assert.ok(Date.parse(recibo.fecha));
    const repetida=await fetch(base+'/ordenes/1/recibir',post(entrega()));assert.equal((await repetida.json()).repetida,true);assert.equal(state.stock.get('A'),1);
    for(const change of [{referencia:'Otra'},{token:'b'.repeat(32)},{token:'b'.repeat(32),version:1,lineas:[{codigo:'A',cantidad:3}]}])assert.equal((await fetch(base+'/ordenes/1/recibir',post(entrega(change)))).status,400);
    assert.equal(state.stock.get('A'),1);assert.equal(state.movimientos.length,1);
    const pagina=await fetch(base+'/ordenes/1/recepcion');assert.equal(pagina.status,200);const html=await pagina.text();assert.match(html,/Recepción parcial/);assert.match(html,/Remisión 12/);assert.match(html,/max="2"/);assert.match(html,/Historial de recepciones/);
    const completa=await fetch(base+'/ordenes/1/recibir',post(entrega({token:'c'.repeat(32),version:1,referencia:'Remisión 13',lineas:[{codigo:'A',cantidad:2},{codigo:'B',cantidad:2.5}]})));
    assert.equal(completa.status,200);assert.equal((await completa.json()).estado,'RECIBIDA');assert.equal(state.stock.get('A'),3);assert.equal(state.stock.get('B'),2.5);assert.equal(state.movimientos.length,3);
    assert.equal(state.docs.get(2).datos.estado,'LISTA_PARA_ENTREGA');assert.equal(state.alertas.length,1);assert.equal(state.docs.get(1).datos.recepciones.length,2);
  }));
});
test('fallo de movimiento revierte el inventario y no registra recepción',async()=>{
  await almacen(async state=>{
    state.fallar=true;await servidor(gestor,async base=>assert.equal((await fetch(base+'/ordenes/1/recibir',post(entrega()))).status,500));
    assert.equal(state.stock.size,0);assert.equal(state.docs.get(1).datos.estado,'GENERADA');assert.equal(state.docs.get(1).datos.recepciones,undefined);assert.equal(state.rollback,1);
  });
});
test('recepciones filtran las sedes autorizadas y Contabilidad solo consulta',async()=>{
  await almacen(async state=>{
    state.docs.set(3,{...orden(),id:3,sede:'AJENA'});
    await servidor(gestor,async base=>{
      const r=await fetch(base+'/recepciones');assert.equal(r.status,200);const html=await r.text();assert.match(html,/PR-1/);assert.doesNotMatch(html,/PR-3/);assert.match(html,/Recepción de órdenes de compra/);
      assert.equal((await fetch(base+'/recepciones?sede=AJENA')).status,403);assert.equal((await fetch(base+'/ordenes/3/recepcion')).status,403);assert.equal((await fetch(base+'/ordenes/3/recibir',post(entrega()))).status,403);
      assert.equal((await fetch(base+'/ordenes/1/recibir',post({}))).status,400);
    });
    await servidor({...gestor,rol:'CONTABILIDAD',departamentoActivo:'CONTABILIDAD'},async base=>{
      const r=await fetch(base+'/ordenes/1/recepcion');assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/id="guardar-recepcion"/);assert.equal((await fetch(base+'/ordenes/1/recibir',post(entrega()))).status,403);
    });
    assert.equal(state.stock.size,0);
  });
});
