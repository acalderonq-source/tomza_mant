const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),path=require('node:path');
const pool=require('../src/db'),router=require('../src/routes/proveeduria.routes');
const {rechazarProductos,lineasActivas,lineasCompraPendientes}=require('../src/utils/solicitudCompras');
const comprador={id:12,usuario:'compras',nombre:'Compras',rol:'PROVEEDURIA',departamentoActivo:'PROVEEDURIA'};
const solicitante={id:22,usuario:'oficina',rol:'SUPERVISOR',departamentoActivo:'OPERACIONES'};
const lineas=[{codigo:'A',descripcion:'Papel',cantidad:5,iva:13},{codigo:'B',descripcion:'Guantes',cantidad:2,iva:13}];

async function contexto(run){
  const oq=pool.query,oc=pool.getConnection;
  const estado={docs:new Map(),stock:new Map([['A',{codigo:'A',descripcion:'Papel',iva:13,cantidad:2}],['B',{codigo:'B',descripcion:'Guantes',iva:13,cantidad:20}]]),alertas:[],movimientos:[],auditoria:[],siguiente:1};
  async function query(sql,args=[]){
    sql=sql.trim();
    if(sql.startsWith('SELECT * FROM prov_inventario WHERE'))return [[estado.stock.get(args[1])].filter(Boolean).map(a=>structuredClone(a))];
    if(sql.includes('FROM prov_inventario i'))return [[...estado.stock.values()].map(a=>({...a,sede:'Cartago',stock_minimo:5,stock_maximo:10,unidad:'UND',tipo:'CONSUMIBLE',grupo:'INVENTARIO'}))];
    if(sql.startsWith('SELECT stock_minimo,stock_maximo'))return [[{stock_minimo:5,stock_maximo:10}]];
    if(sql.startsWith('SELECT id,datos FROM prov_documentos'))return [[...estado.docs.values()].filter(d=>d.datos.origen==='REPOSICION_STOCK'&&d.datos.codigo_reposicion===args[0]&&!['RECHAZADA','REPOSICION_RECIBIDA'].includes(d.datos.estado)).map(d=>structuredClone(d))];
    if(sql.startsWith('SELECT * FROM prov_documentos WHERE id')){const d=estado.docs.get(Number(args[0]));return [d&&d.tipo===args[1]?[structuredClone(d)]:[]];}
    if(sql.startsWith('SELECT * FROM prov_documentos'))return [[...estado.docs.values()].filter(d=>!sql.includes('usuario_id=?')||d.usuario_id===args[0]).map(d=>structuredClone(d))];
    if(sql.startsWith('INSERT INTO prov_documentos')){const id=estado.siguiente++,tipo=sql.match(/VALUES \('(\w+)'/)[1];estado.docs.set(id,{id,tipo,usuario_id:args[0],sede:args[1],datos:JSON.parse(args[2]),creado_en:new Date()});return [{insertId:id}];}
    if(sql.startsWith('UPDATE prov_documentos'))estado.docs.get(Number(args[1])).datos=JSON.parse(args[0]);
    if(sql.startsWith('INSERT INTO prov_inventario ('))estado.stock.get(args[1]).cantidad+=args[4];
    if(sql.startsWith('INSERT INTO prov_inventario_movimientos'))estado.movimientos.push(args);
    if(sql.startsWith('INSERT INTO prov_auditoria')){assert.ok(args[2].length<=100);estado.auditoria.push(args);}
    if(sql.startsWith('INSERT INTO prov_alertas')){assert.ok(args[2].length<=500);estado.alertas.push(args);}
    if(sql.startsWith('SELECT'))return [[]];
    return [{affectedRows:1,insertId:80}];
  }
  pool.query=query;pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}});
  async function servidor(user,fn){
    const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));app.use(express.json());app.use((req,res,next)=>{req.session={user};next();});app.use('/proveeduria',router);
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const base=`http://127.0.0.1:${server.address().port}/proveeduria`;
    const post=(url,body={})=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    try{await fn({post,get:url=>fetch(base+url)});}finally{await new Promise(r=>server.close(r));}
  }
  try{await run(estado,servidor);}finally{pool.query=oq;pool.getConnection=oc;}
}

test('rechazo parcial conserva originales, invalida la cotización y mantiene solo productos aceptados',()=>{
  const pedido={lineas:structuredClone(lineas),compra:{lineas:structuredClone(lineas)},cotizacion:{total:100}};
  rechazarProductos(pedido,['A'],'No se requiere esta compra',comprador);
  assert.equal(pedido.lineas.length,2);assert.deepEqual(lineasActivas(pedido).map(l=>l.codigo),['B']);
  assert.deepEqual(lineasCompraPendientes(pedido).map(l=>l.codigo),['B']);assert.equal(pedido.cotizacion,undefined);
  assert.equal(pedido.cotizaciones_anteriores[0].total,100);assert.equal(pedido.rechazos[0].usuario_id,12);
  assert.throws(()=>rechazarProductos(pedido,['B'],' ',comprador));assert.throws(()=>rechazarProductos(pedido,['Z'],'Motivo',comprador));
  rechazarProductos(pedido,undefined,'Pedido cancelado',comprador);assert.equal(pedido.estado,'RECHAZADA');
  assert.throws(()=>rechazarProductos({lineas,oc_id:10},undefined,'Motivo',comprador));
});

test('el stock disponible queda entregable si se rechazan todos los faltantes de compra',()=>{
  const pedido={lineas:structuredClone(lineas),compra:{lineas:[lineas[0]]}};
  rechazarProductos(pedido,['A'],'No se autoriza la compra de papel',comprador);
  assert.equal(pedido.estado,'LISTA_PARA_ENTREGA');assert.equal(lineasCompraPendientes(pedido).length,0);
});

test('reposiciones solo por stock bajo; no se duplica un pedido pendiente y no modifica existencias',async()=>contexto(async(s,servidor)=>{
  await servidor(solicitante,async({post})=>assert.equal((await post('/inventario/reposicion',{codigo:'A',cantidad:8})).status,403));
  await servidor({...comprador,rol:'BODEGUERO'},async({post})=>assert.equal((await post('/inventario/reposicion',{codigo:'A',cantidad:8})).status,403));
  await servidor(comprador,async({post,get})=>{
    const inventario=await (await get('/inventario')).text();assert.match(inventario,/Solicitar reposición/);assert.match(inventario,/name="cantidad"[^>]*value="8"/);
    assert.equal((await post('/inventario/reposicion',{codigo:'B',cantidad:8})).status,400);
    assert.equal((await post('/inventario/reposicion',{codigo:'A',cantidad:0})).status,400);
    assert.equal((await post('/inventario/reposicion',{codigo:'A',cantidad:8})).status,200);
    assert.equal(s.docs.get(1).datos.origen,'REPOSICION_STOCK');assert.equal(s.docs.get(1).datos.compra.lineas[0].cantidad,8);
    assert.equal((await (await post('/inventario/reposicion',{codigo:'A',cantidad:8})).json()).repetida,true);
    assert.equal(s.docs.size,1);assert.equal(s.stock.get('A').cantidad,2);assert.equal(s.movimientos.length,0);
    const html=await (await get('/solicitudes')).text();assert.match(html,/Reposición de inventario/);assert.match(html,/Se va a comprar/);
  });
}));

test('recepción de reposición suma stock y cierra sin generar boleta de salida',async()=>contexto(async(s,servidor)=>{
  await servidor(comprador,async({post})=>{
    await post('/inventario/reposicion',{codigo:'A',cantidad:8});
    s.docs.get(1).datos.oc_id=2;s.docs.get(1).datos.estado='ORDENADA';
    s.docs.set(2,{id:2,tipo:'oc',usuario_id:12,sede:'Cartago',datos:{solicitud_id:1,estado:'GENERADA',proveedor:'Proveedor',lineas:[{...lineas[0],cantidad:8}]}});
    const recibo={token:'a'.repeat(32),version:0,referencia:'Reposición recibida',lineas:[{codigo:'A',cantidad:8}]};
    assert.equal((await post('/ordenes/2/recibir',recibo)).status,200);
    assert.equal(s.stock.get('A').cantidad,10);assert.equal(s.docs.get(1).datos.estado,'REPOSICION_RECIBIDA');
    assert.equal((await post('/salidas',{solicitud_id:1})).status,400);assert.equal(s.docs.size,2);
    assert.equal(s.alertas.at(-1)[2],'Reposición recibida e ingresada al inventario de Bodega');
  });
}));

test('rechazo exige motivo y permisos, avisa al solicitante y bloquea el pedido rechazado',async()=>contexto(async(s,servidor)=>{
  s.docs.set(1,{id:1,tipo:'solicitud',usuario_id:22,sede:'Cartago',datos:{lineas:structuredClone(lineas),estado:'SOLICITUD_COMPRA',departamento:'OPERACIONES',compra:{lineas:structuredClone(lineas)}}});
  await servidor(solicitante,async({post})=>assert.equal((await post('/solicitudes/1/rechazar',{motivo:'Motivo'})).status,403));
  await servidor(comprador,async({post})=>{
    assert.equal((await post('/solicitudes/1/rechazar',{codigo:'A',motivo:''})).status,400);
    assert.equal((await post('/solicitudes/1/rechazar',{codigo:'A',motivo:'Ya se dispone de otra alternativa'})).status,200);
    assert.equal(s.docs.get(1).datos.rechazos[0].codigo,'A');assert.equal(s.alertas[0][0],22);
    const cotizar={modo:'manual',precios:{A:100,B:20},proveedor:'Proveedor',email:'p@example.com',razon_social:'Gas Tomza',entrega:'5 días',condicion:'CREDITO',credito:30,moneda:'CRC',cotizacion_data:'data:application/pdf;base64,JVBERi0xLjQK',cotizacion_nombre:'cotizacion.pdf'};
    assert.equal((await post('/solicitudes/1/cotizacion',cotizar)).status,200);
    assert.deepEqual(s.docs.get(1).datos.cotizacion.lineas.map(l=>l.codigo),['B']);
    assert.equal((await post('/solicitudes/1/rechazar',{motivo:'Cancelado por el departamento'})).status,200);
    assert.equal(s.docs.get(1).datos.estado,'RECHAZADA');
    assert.equal((await post('/salidas',{solicitud_id:1})).status,400);
    assert.equal((await post('/solicitudes/1/solicitar-compra')).status,403);
    assert.equal((await post('/solicitudes/1/cotizacion',{})).status,400);
  });
  await servidor(solicitante,async({get})=>{
    const html=await (await get('/mis-solicitudes')).text();assert.match(html,/Pedido rechazado/);assert.match(html,/Cancelado por el departamento/);
  });
}));

test('conserva motivos largos sin exceder los límites de auditoría y avisos',async()=>contexto(async(s,servidor)=>{
  s.docs.set(1,{id:1,tipo:'solicitud',usuario_id:22,sede:'Cartago',datos:{lineas:structuredClone(lineas),estado:'SOLICITUD_COMPRA',compra:{lineas:structuredClone(lineas)}}});
  await servidor(comprador,async({post})=>{
    assert.equal((await post('/solicitudes/1/rechazar',{codigo:'A',motivo:'x'.repeat(2000)})).status,200);
    assert.equal(s.docs.get(1).datos.rechazos[0].motivo.length,2000);
  });
}));

test('desmarcar exige justificación y guarda el rechazo junto con la aceptación del resto',async()=>contexto(async(s,servidor)=>{
  s.siguiente=2;
  s.docs.set(1,{id:1,tipo:'solicitud',usuario_id:22,sede:'Cartago',datos:{lineas:structuredClone(lineas),estado:'PENDIENTE_BODEGA',requiere_revision_bodega:true,departamento:'OPERACIONES'}});
  await servidor(comprador,async({post})=>{
    const revision=[{codigo:'A',comprar:false,motivo:''},{codigo:'B',comprar:true,motivo:''}];
    assert.equal((await post('/solicitudes/1/aceptar',{revision})).status,400);
    assert.equal(s.docs.size,1);assert.equal(s.docs.get(1).datos.rechazos,undefined);assert.equal(s.alertas.length,0);
    assert.equal((await post('/solicitudes/1/aceptar',{revision:revision.slice(0,1)})).status,400);
    revision[0].motivo='Se sustituirá por otro material';
    assert.equal((await post('/solicitudes/1/aceptar',{revision})).status,200);
    assert.equal(s.docs.get(1).datos.rechazos[0].motivo,'Se sustituirá por otro material');
    assert.equal(s.docs.get(1).datos.rechazos[0].codigo,'A');assert.equal(s.docs.get(1).datos.salida_id,2);
    assert.deepEqual(s.docs.get(2).datos.lineas.map(l=>l.codigo),['B']);
    assert.equal(s.stock.get('A').cantidad,2);assert.equal(s.stock.get('B').cantidad,20);assert.equal(s.movimientos.length,0);
  });
}));

test('desmarcar todos conserva una justificación distinta por producto y rechaza el pedido sin generar compras ni entregas',async()=>contexto(async(s,servidor)=>{
  s.siguiente=2;
  s.docs.set(1,{id:1,tipo:'solicitud',usuario_id:22,sede:'Cartago',datos:{lineas:structuredClone(lineas),estado:'PENDIENTE_BODEGA',requiere_revision_bodega:true}});
  await servidor(comprador,async({post})=>{
    const revision=[{codigo:'A',comprar:false,motivo:'No se requiere papel'},{codigo:'B',comprar:false,motivo:'Los guantes no son los adecuados'}];
    const r=await post('/solicitudes/1/aceptar',{revision});assert.equal(r.status,200);assert.equal((await r.json()).rechazada,true);
    assert.equal(s.docs.get(1).datos.estado,'RECHAZADA');assert.equal(s.docs.size,1);
    assert.deepEqual(s.docs.get(1).datos.rechazos.map(r=>r.motivo),revision.map(r=>r.motivo));
    assert.equal(s.docs.get(1).datos.lineas.length,2);assert.equal(s.movimientos.length,0);
  });
}));
