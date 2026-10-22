const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),path=require('node:path');
const pool=require('../src/db'),router=require('../src/routes/proveeduria.routes');
const {sinAgrupar,pendienteRevision,agruparSeleccion,estadoAgrupado}=require('../src/utils/proveeduriaAgrupacion');
const {versionOrden}=require('../src/utils/proveeduriaOrdenEdicion');
const comprador={id:12,usuario:'compras',nombre:'Proveeduría',rol:'PROVEEDURIA',departamentoActivo:'PROVEEDURIA'};
const bodeguero={id:13,usuario:'bodeguero',nombre:'Bodeguero',rol:'BODEGUERO',departamentoActivo:'TALLER',departamentos:['TALLER']};
const operaciones={id:21,usuario:'operaciones',nombre:'Ana Operaciones',rol:'SUPERVISOR',departamentoActivo:'OPERACIONES',sede:'Cartago'};
const cajas={id:22,usuario:'cajas',nombre:'Luis Cajas',rol:'CONTABILIDAD',departamentoActivo:'CONTABILIDAD',sede:'La Cruz',accesoPersonal:{unidad:'CAJAS'}};

test('compra solo 6 de 10 si hay 4 en Bodega; rechaza una OC desactualizada y entrega las 10 unidades',async()=>escenario(async({st,server,solicitar,ordenar,recibir})=>{
  st.stock.set('PAPEL',4);
  await solicitar(operaciones,[{codigo:'PAPEL',cantidad:10}]);
  await server(comprador,async({post,get})=>{
    assert.equal((await post('/solicitudes/1/aceptar')).status,200);
    const html=await (await get('/inventario?q=GUANTES')).text();
    assert.match(html,/Hay en Bodega/);assert.match(html,/Se atiende de Bodega/);
    const r=await post('/inventario/agrupar',{seleccion:[{solicitud_id:1,codigo:'PAPEL'}]});
    assert.equal(r.status,200);const id=(await r.json()).id;
    assert.equal(st.docs.get(id).datos.lineas[0].cantidad,6);
    assert.equal(st.docs.get(id).datos.desglose[0].bodega,4);
    const oc=await ordenar(post,id);
    assert.equal(st.docs.get(oc).datos.lineas[0].cantidad,6);
    assert.equal((await recibir(post,oc)).status,200);assert.equal(st.stock.get('PAPEL'),10);
    const salida=await post('/salidas',{solicitud_id:1});assert.equal(salida.status,200);
    const sid=(await salida.json()).id;
    assert.equal((await post(`/salidas/${sid}/enviar`)).status,200);assert.equal(st.stock.get('PAPEL'),0);
  });
}));

test('reparte una sola existencia entre departamentos y actualiza el faltante al agrupar',async()=>escenario(async({st,server,solicitar,ordenar})=>{
  await solicitar(operaciones,[{codigo:'PAPEL',cantidad:5}]);await solicitar(cajas,[{codigo:'PAPEL',cantidad:5}]);
  await server(comprador,async({post})=>{
    await post('/solicitudes/1/aceptar');await post('/solicitudes/2/aceptar');
    st.stock.set('PAPEL',6);
    const r=await post('/inventario/agrupar',{seleccion:[{solicitud_id:1,codigo:'PAPEL'},{solicitud_id:2,codigo:'PAPEL'}]});
    assert.equal(r.status,200);const id=(await r.json()).id;
    assert.equal(st.docs.get(id).datos.lineas[0].cantidad,4);
    assert.deepEqual(st.docs.get(id).datos.desglose.map(l=>[l.cantidad,l.bodega]),[[0,5],[4,1]]);
    assert.equal(sinAgrupar(st.docs.get(1).datos).length,0);assert.equal(sinAgrupar(st.docs.get(2).datos).length,0);
    st.stock.set('PAPEL',10);
    assert.equal((await post(`/solicitudes/${id}/cotizacion`,{})).status,400);
    assert.equal((await post(`/agrupaciones/${id}/cancelar`)).status,200);
    assert.equal((await post('/inventario/agrupar',{seleccion:[{solicitud_id:1,codigo:'PAPEL'},{solicitud_id:2,codigo:'PAPEL'}]})).status,400);
    assert.equal((await post('/salidas',{solicitud_id:1})).status,200);
  });
}));

async function escenario(run){
  const oq=pool.query,oc=pool.getConnection;
  const st={docs:new Map(),stock:new Map([['PAPEL',0],['GUANTES',0]]),alertas:[],movimientos:[],next:1};
  const articulo=c=>({codigo:c,descripcion:c==='PAPEL'?'Hojas':'Guantes',iva:13,cantidad:st.stock.get(c),unidad:'UND'});
  async function query(sql,args=[]){
    sql=sql.trim();
    if(sql.startsWith('SELECT * FROM prov_documentos WHERE id')){const d=st.docs.get(Number(args[0]));return [d&&d.tipo===args[1]?[structuredClone(d)]:[]];}
    if(sql.startsWith('SELECT * FROM prov_documentos'))return [[...st.docs.values()].filter(d=>!sql.includes('usuario_id=?')||d.usuario_id===args[0]).map(d=>structuredClone(d))];
    if(sql.startsWith('SELECT codigo,descripcion,iva,cantidad FROM prov_inventario'))return [args.slice(1).filter(c=>st.stock.has(c)).map(articulo)];
    if(sql.includes('FROM prov_inventario i'))return [[...st.stock.keys()].map(c=>({...articulo(c),sede:'Cartago',stock_minimo:1,stock_maximo:10,grupo:'INVENTARIO',tipo:'CONSUMIBLE'}))];
    if(sql.startsWith('SELECT * FROM prov_inventario WHERE'))return [st.stock.has(args[1])?[articulo(args[1])]:[]];
    if(sql.startsWith('INSERT INTO prov_documentos')){const id=st.next++,tipo=sql.match(/VALUES \('(\w+)'/)[1];st.docs.set(id,{id,tipo,usuario_id:args[0],sede:args[1],datos:JSON.parse(args[2]),creado_en:new Date()});return [{insertId:id}];}
    if(sql.startsWith("UPDATE prov_documentos SET tipo='oc_eliminada'"))st.docs.get(Number(args[0])).tipo='oc_eliminada';
    if(sql.startsWith('UPDATE prov_documentos SET datos'))st.docs.get(Number(args[1])).datos=JSON.parse(args[0]);
    if(sql.startsWith('INSERT INTO prov_inventario ('))st.stock.set(args[1],st.stock.get(args[1])+args[4]);
    if(sql.startsWith('UPDATE prov_inventario SET cantidad=cantidad-'))st.stock.set(args[2],st.stock.get(args[2])-args[0]);
    if(sql.startsWith('INSERT INTO prov_inventario_movimientos'))st.movimientos.push(args);
    if(sql.startsWith('INSERT INTO prov_alertas')){assert.ok(args[2].length<=500);st.alertas.push(args);}
    if(sql.startsWith('INSERT INTO prov_auditoria'))assert.ok(args[2].length<=100);
    if(sql.startsWith('SELECT'))return [[]];
    return [{affectedRows:1,insertId:900}];
  }
  pool.query=query;pool.getConnection=async()=>{let anterior;return{query,beginTransaction:async()=>{anterior=structuredClone(st);},commit:async()=>{},rollback:async()=>Object.assign(st,anterior),release(){}};};
  async function server(user,fn){
    const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));app.use(express.json());app.use((req,res,next)=>{req.session={user};next();});app.use('/proveeduria',router);
    const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));const base=`http://127.0.0.1:${s.address().port}/proveeduria`;
    try{await fn({post:(url,body={})=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),get:url=>fetch(base+url)});}finally{await new Promise(r=>s.close(r));}
  }
  async function solicitar(user,lineas){await server(user,async({post})=>assert.equal((await post('/solicitudes',{sede:user.sede,lineas})).status,200));}
  async function ordenar(post,id){
    const precios=Object.fromEntries(st.docs.get(id).datos.lineas.map(l=>[l.codigo,100]));
    const body={solicitud_id:id,modo:'manual',precios,proveedor:'Proveedor',email:'p@example.com',razon_social:'Gas Tomza',entrega:'5 días',condicion:'CREDITO',credito:30,moneda:'CRC',empresa_destino:'GAS TOMZA',cotizacion_data:'data:application/pdf;base64,JVBERi0xLjQK',cotizacion_nombre:'cotizacion.pdf'};
    assert.equal((await post(`/solicitudes/${id}/cotizacion`,body)).status,200);
    const r=await post('/ordenes',body);assert.equal(r.status,200);return (await r.json()).id;
  }
  async function recibir(post,oc){const d=st.docs.get(oc);return post(`/ordenes/${oc}/recibir`,{token:String(oc).padStart(32,'a'),version:0,referencia:'Recepción '+oc,lineas:d.datos.lineas.map(l=>({codigo:l.codigo,cantidad:l.cantidad}))});}
  try{await run({st,server,solicitar,ordenar,recibir});}finally{pool.query=oq;pool.getConnection=oc;}
}

test('Cajas 5 y Operaciones 5 se revisan, salen de pendientes y generan una OC de 10 con desglose y entregas separadas',async()=>escenario(async({st,server,solicitar,ordenar,recibir})=>{
  await solicitar(operaciones,[{codigo:'PAPEL',cantidad:5}]);await solicitar(cajas,[{codigo:'PAPEL',cantidad:5}]);
  await server(bodeguero,async({get,post})=>{
    const html=await (await get('/inventario')).text();assert.match(html,/Bodega Proveeduría/);assert.match(html,/Solicitudes pendientes \(2\)/);
    assert.match(html,/<details[^>]+id="solicitud-1"/);assert.match(html,/Ana Operaciones/);assert.match(html,/Luis Cajas/);
    assert.equal((await post('/solicitudes/1/aceptar')).status,200);assert.equal((await post('/solicitudes/2/aceptar')).status,200);
    const revisada=await (await get('/inventario')).text();assert.match(revisada,/Solicitudes pendientes \(0\)/);assert.match(revisada,/Historial de solicitudes atendidas \(2\)/);
    assert.match(revisada,/Total a comprar/);assert.equal(st.stock.get('PAPEL'),0);
  });
  const seleccion=[{solicitud_id:1,codigo:'PAPEL'},{solicitud_id:2,codigo:'PAPEL'}];
  await server(comprador,async({post,get})=>{
    const r=await post('/inventario/agrupar',{seleccion});assert.equal(r.status,200);assert.equal((await r.json()).id,3);
    assert.equal(st.docs.get(3).datos.lineas.length,1);assert.equal(st.docs.get(3).datos.lineas[0].cantidad,10);
    assert.deepEqual(st.docs.get(3).datos.desglose.map(l=>[l.solicitud_id,l.cantidad]),[[1,5],[2,5]]);
    assert.equal((await post('/inventario/agrupar',{seleccion})).status,400);assert.equal(st.docs.size,3);
    assert.equal((await post('/solicitudes/1/rechazar',{codigo:'PAPEL',motivo:'Cambio'})).status,400);
    assert.equal((await post('/solicitudes/1/cotizacion',{})).status,400);
    const oc=await ordenar(post,3);assert.equal(oc,4);assert.equal(st.docs.get(4).datos.lineas[0].cantidad,10);
    assert.equal(st.docs.get(1).datos.agrupaciones_compra[0].orden_id,4);
    const html=await (await get('/inventario')).text();assert.match(html,/Orden de compra PR-4/);assert.match(html,/Ana Operaciones/);assert.match(html,/Luis Cajas/);assert.match(html,/Cajas/);
    assert.equal((await recibir(post,4)).status,200);assert.equal(st.stock.get('PAPEL'),10);
    assert.equal(st.docs.get(3).datos.estado,'COMPRA_RECIBIDA');assert.equal(st.docs.get(1).datos.estado,'LISTA_PARA_ENTREGA');assert.equal(st.docs.get(2).datos.estado,'LISTA_PARA_ENTREGA');
  });
  await server(bodeguero,async({post})=>{
    const b1=await post('/salidas',{solicitud_id:1});assert.equal(b1.status,200);const id1=(await b1.json()).id;assert.equal(st.stock.get('PAPEL'),10);
    assert.equal((await post(`/salidas/${id1}/enviar`)).status,200);assert.equal(st.stock.get('PAPEL'),5);
    const b2=await post('/salidas',{solicitud_id:2});assert.equal(b2.status,200);const id2=(await b2.json()).id;
    assert.equal((await post(`/salidas/${id2}/enviar`)).status,200);assert.equal(st.stock.get('PAPEL'),0);
  });
}));

test('permite una OC por producto o varios, impide entregar hasta recibir todo y libera las cantidades al cancelar una agrupación',async()=>escenario(async({st,server,solicitar,ordenar,recibir})=>{
  await solicitar(operaciones,[{codigo:'PAPEL',cantidad:5},{codigo:'GUANTES',cantidad:3}]);
  await server(comprador,async({post})=>{
    assert.equal((await post('/inventario/agrupar',{seleccion:[{solicitud_id:1,codigo:'PAPEL'}]})).status,400);
    await post('/solicitudes/1/aceptar');
    assert.equal((await post('/inventario/agrupar',{seleccion:[{solicitud_id:1,codigo:'PAPEL'}]})).status,200);
    assert.deepEqual(sinAgrupar(st.docs.get(1).datos).map(l=>l.codigo),['GUANTES']);
    assert.equal((await post('/agrupaciones/2/cancelar')).status,200);assert.equal(sinAgrupar(st.docs.get(1).datos).length,2);
    const p=await post('/inventario/agrupar',{seleccion:[{solicitud_id:1,codigo:'PAPEL'}]});const gp=(await p.json()).id;
    const g=await post('/inventario/agrupar',{seleccion:[{solicitud_id:1,codigo:'GUANTES'}]});const gg=(await g.json()).id;
    const op=await ordenar(post,gp),og=await ordenar(post,gg);
    assert.equal((await recibir(post,op)).status,200);assert.equal(st.docs.get(1).datos.estado,'ORDENADA');
    assert.equal((await post('/salidas',{solicitud_id:1})).status,400);
    assert.equal((await recibir(post,og)).status,200);assert.equal(st.docs.get(1).datos.estado,'LISTA_PARA_ENTREGA');
    assert.equal((await post('/salidas',{solicitud_id:1})).status,200);
  });
}));

test('rechazar en Bodega quita la solicitud de pendientes y bloquea agrupar sus productos',async()=>escenario(async({st,server,solicitar})=>{
  await solicitar(operaciones,[{codigo:'PAPEL',cantidad:5}]);
  await server(bodeguero,async({post,get})=>{
    assert.equal((await post('/solicitudes/1/rechazar',{motivo:'No corresponde a este departamento'})).status,200);
    const html=await (await get('/inventario')).text();assert.match(html,/Solicitudes pendientes \(0\)/);assert.match(html,/No corresponde a este departamento/);
    assert.equal((await post('/inventario/agrupar',{seleccion:[{solicitud_id:1,codigo:'PAPEL'}]})).status,400);assert.equal(st.docs.size,1);
  });
}));

test('eliminar una OC sin recepción conserva la agrupación para regenerarla sin duplicar cantidades',async()=>escenario(async({st,server,solicitar,ordenar})=>{
  await solicitar(operaciones,[{codigo:'PAPEL',cantidad:5}]);
  await server(comprador,async({post})=>{
    await post('/solicitudes/1/aceptar');
    const g=await post('/inventario/agrupar',{seleccion:[{solicitud_id:1,codigo:'PAPEL'}]});const grupo=(await g.json()).id;
    const oc=await ordenar(post,grupo);
    const eliminar=await post(`/ordenes/${oc}/eliminar`,{version:versionOrden(st.docs.get(oc))});assert.equal(eliminar.status,200);
    assert.equal(st.docs.get(1).datos.agrupaciones_compra[0].orden_id,null);assert.equal(sinAgrupar(st.docs.get(1).datos).length,0);
    const nueva=await ordenar(post,grupo);assert.notEqual(nueva,oc);assert.equal(st.docs.get(nueva).datos.lineas[0].cantidad,5);
    assert.equal(st.docs.get(1).datos.agrupaciones_compra.length,1);assert.equal(st.docs.get(1).datos.agrupaciones_compra[0].orden_id,nueva);
  });
}));
