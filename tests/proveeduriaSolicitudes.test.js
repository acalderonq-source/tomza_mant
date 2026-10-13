const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const path=require('node:path');
const pool=require('../src/db');
const routes=require('../src/routes/proveeduria.routes');
const requester={id:71,usuario:'operaciones',nombre:'Solicitante Operaciones',rol:'SUPERVISOR',sede:'Cartago',departamentoActivo:'OPERACIONES',departamentos:['OPERACIONES']};
const manager={id:72,usuario:'compras',rol:'PROVEEDURIA',sede:'Cartago',departamentoActivo:'PROVEEDURIA',departamentos:['PROVEEDURIA']};
async function server(user,fn){
  const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));app.use(express.json());app.use(express.urlencoded({extended:true}));app.use((req,res,next)=>{req.session={user};next();});app.use('/proveeduria',routes);
  const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));
  try{await fn(`http://127.0.0.1:${s.address().port}/proveeduria`);}finally{await new Promise(r=>s.close(r));}
}
test('departamento solicitante solo puede consultar sus pedidos y no gestionar compras',async()=>{
  const original=pool.query;pool.query=async(sql,args)=>{
    if(sql.includes('FROM prov_documentos')){assert.match(sql,/usuario_id=\?/);assert.deepEqual(args,[71]);return [[{id:1,tipo:'solicitud',sede:'Cartago',datos:{departamento:'OPERACIONES',estado:'PENDIENTE',lineas:[{descripcion:'Papel',cantidad:2}]}}]];}
    if(sql.includes('FROM prov_alertas'))assert.deepEqual(args,[71]);return [[]];
  };
  try{await server(requester,async base=>{
    const r=await fetch(base+'/mis-solicitudes');assert.equal(r.status,200);const html=await r.text();assert.match(html,/Nueva solicitud · OPERACIONES/);assert.match(html,/Papel/);assert.doesNotMatch(html,/precio_unitario|factura\/conciliar/);
    for(const p of ['/gestion','/solicitudes','/ordenes/nueva'])assert.equal((await fetch(base+p)).status,403);
    assert.equal((await fetch(base+'/ordenes',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  });
  for(const departamento of ['TALLER','CONTABILIDAD','SEGURIDAD_OCUPACIONAL','LOGISTICA','RECURSOS_HUMANOS','CARBURACION'])await server({...requester,departamentoActivo:departamento,departamentos:[departamento]},async base=>assert.equal((await fetch(base+'/mis-solicitudes')).status,200,departamento));
  }finally{pool.query=original;}
});
test('flujo completo: solicitud de otro departamento, cotización, OC, recepción y entrega confirmada',async()=>{
  const originalQuery=pool.query,originalConnection=pool.getConnection;
  const docs=new Map(),stock=new Map(),alerts=[];let nextId=1;
  async function query(sql,args=[]){
    if(sql.includes('FROM prov_proveedores'))return [[]];
    if(sql.startsWith('SELECT * FROM prov_documentos WHERE id')){const d=docs.get(Number(args[0]));return [d&&d.tipo===args[1]?[structuredClone(d)]:[]];}
    if(sql.startsWith('SELECT datos FROM prov_documentos'))return [[...docs.values()].filter(d=>d.tipo==='oc').map(d=>({datos:d.datos}))];
    if(sql.startsWith('SELECT * FROM prov_documentos')){let rows=[...docs.values()];if(sql.includes("tipo='solicitud'"))rows=rows.filter(r=>r.tipo==='solicitud');if(sql.includes('usuario_id=?'))rows=rows.filter(r=>r.usuario_id===args[0]&&['solicitud','salida'].includes(r.tipo));return [structuredClone(rows)];}
    if(sql.includes('FROM usuarios_sedes'))return [[]];
    if(sql.startsWith('SELECT')&&sql.includes('FROM prov_inventario'))return [stock.has(args[1])?[{cantidad:stock.get(args[1])}]:[]];
    if(sql.startsWith('SELECT')&&sql.includes('FROM prov_alertas'))return [alerts.filter(a=>a.usuario_id===args[0])];
    if(sql.startsWith('INSERT INTO prov_documentos')){const tipo=sql.match(/VALUES \('(\w+)'/)[1],id=nextId++;docs.set(id,{id,tipo,usuario_id:args[0],sede:args[1],datos:JSON.parse(args[2]),creado_en:new Date()});return [{insertId:id}];}
    if(sql.startsWith('UPDATE prov_documentos')){docs.get(Number(args[1])).datos=JSON.parse(args[0]);return [{affectedRows:1}];}
    if(sql.startsWith('INSERT INTO prov_inventario ('))stock.set(args[1],(stock.get(args[1])||0)+args[4]);
    if(sql.startsWith('UPDATE prov_inventario'))stock.set(args[2],stock.get(args[2])-args[0]);
    if(sql.startsWith('INSERT INTO prov_alertas'))alerts.push({id:alerts.length+1,usuario_id:args[0],grupo:args[1],mensaje:args[2],documento_id:args[3]});
    return [{affectedRows:1}];
  }
  pool.query=query;pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}});
  const json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const form=()=>new URLSearchParams({origen_formulario:'taller',solicitud_id:'1',proveedor:'Proveedor',email:'proveedor@example.com',empresa_destino:'GAS TOMZA',credito:'30',forma_pago:'Crédito',entrega:'5 días',moneda:'CRC',iva:'13','lineas[0][codigo_producto]':'PAPEL','lineas[0][descripcion]':'Papel','lineas[0][cantidad]':'2','lineas[0][precio_unitario]':'100'});
  try{
    await server(requester,async base=>{
      const r=await fetch(base+'/solicitudes',json({departamento:'PROVEEDURIA',lineas:[{codigo:'PAPEL',descripcion:'Papel',cantidad:2,iva:99}],motivo:'Para la oficina'}));assert.equal(r.status,200);assert.equal(docs.get(1).datos.departamento,'OPERACIONES');assert.equal(docs.get(1).datos.solicitante,requester.nombre);assert.equal(docs.get(1).datos.lineas[0].iva,13);assert.equal(alerts[0].grupo,'PROVEEDURIA');
    });
    await server(manager,async base=>{
      const bandeja=await fetch(base+'/solicitudes');assert.equal(bandeja.status,200);const html=await bandeja.text();assert.match(html,/Solicitante Operaciones/);assert.match(html,/Preparar cotización/);
      const antes=await fetch(base+'/ordenes/nueva?solicitud_id=1',{redirect:'manual'});assert.equal(antes.status,302);assert.equal(antes.headers.get('location'),'/proveeduria/solicitudes/1/cotizacion');
      assert.equal((await fetch(base+'/ordenes',{method:'POST',body:form(),redirect:'manual'})).status,400);
      const cotizacion=await fetch(base+'/solicitudes/1/cotizacion');assert.equal(cotizacion.status,200);assert.match(await cotizacion.text(),/Guardar cotización/);
      assert.equal((await fetch(base+'/solicitudes/1/cotizacion',{method:'POST',body:form(),redirect:'manual'})).status,302);assert.equal(docs.get(1).datos.estado,'COTIZADA');assert.equal(docs.size,1);
      const nueva=await fetch(base+'/ordenes/nueva?solicitud_id=1');assert.equal(nueva.status,200);assert.match(await nueva.text(),/proveedor@example.com/);
      assert.equal((await fetch(base+'/ordenes',{method:'POST',body:form(),redirect:'manual'})).status,302);assert.equal(docs.get(1).datos.estado,'ORDENADA');assert.equal(docs.get(2).usuario_id,71);
      assert.equal((await fetch(base+'/salidas',json({solicitud_id:1}))).status,400);
      assert.equal((await fetch(base+'/ordenes/2/recibir',json({token:'a'.repeat(32),version:0,referencia:'Factura 123',lineas:[{codigo:'PAPEL',cantidad:2}]}))).status,200);assert.equal(docs.get(1).datos.estado,'LISTA_PARA_ENTREGA');
      assert.equal((await fetch(base+'/salidas',json({solicitud_id:1}))).status,200);assert.equal(docs.get(1).datos.estado,'ALISTANDO');assert.equal(stock.get('PAPEL'),0);
      assert.equal((await fetch(base+'/salidas/3/enviar',{method:'POST'})).status,200);assert.equal(docs.get(1).datos.estado,'EN_CAMINO');
    });
    await server(requester,async base=>{
      const pedidos=await fetch(base+'/mis-solicitudes');assert.equal(pedidos.status,200);assert.match(await pedidos.text(),/Confirmar que recibí los productos/);
      assert.equal((await fetch(base+'/salidas/3/aceptar',{method:'POST'})).status,200);assert.equal(docs.get(1).datos.estado,'ENTREGADA');assert.equal(docs.get(3).datos.estado,'RECIBIDA');
    });
  }finally{pool.query=originalQuery;pool.getConnection=originalConnection;}
});
