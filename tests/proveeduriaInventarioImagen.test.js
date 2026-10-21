const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('node:path');
const pool=require('../src/db'),router=require('../src/routes/proveeduria.routes');
const {articulosInventariables,articulosSinInventario,articuloSolicitudDescripcion,esNoInventariable}=require('../src/utils/proveeduriaSolicitable');
const {lineasCompra}=require('../src/utils/proveeduria');
const anclaje=articuloSolicitudDescripcion('Anclaje 90 cm');
const gestor={id:72,usuario:'compras',rol:'PROVEEDURIA',sede:'Cartago',departamentoActivo:'PROVEEDURIA',departamentos:['PROVEEDURIA']};
test('solo los quince artículos visibles pasan a control de inventario con los códigos originales',()=>{
  assert.equal(articulosInventariables.length,15);assert.equal(articulosSinInventario.length,214);
  assert.ok(articulosInventariables.every(a=>a.categoria==='Salud ocupacional'&&a.codigo.startsWith('SOL-')));
  assert.ok(articulosInventariables.some(a=>a.descripcion==='Capa larga (capote)'));
  assert.ok(!articulosInventariables.some(a=>a.descripcion==='Algodon'));
  assert.equal(esNoInventariable({codigo:anclaje.codigo,inventariable:false}),false);
  assert.equal(esNoInventariable({codigo:articulosSinInventario[0].codigo,inventariable:true}),true);
  assert.equal(lineasCompra([{...anclaje,cantidad:1,inventariable:false}])[0].inventariable,undefined);
  assert.equal(lineasCompra([{...anclaje,cantidad:1,iva:0}])[0].iva,0,'el IVA de la ficha de inventario puede actualizarse');
});

test('aparecen una vez en solicitudes y en inventario; recepción y entrega registran existencias y movimientos',async()=>{
 const oq=pool.query,oc=pool.getConnection,docs=new Map(),movimientos=[];
 let cantidad=0,nextId=0,existe=true;
 async function query(sql,args=[]){
  sql=sql.trim();
  if(sql.includes('FROM usuarios_sedes')||sql.includes('FROM prov_proveedores'))return [[]];
  if(sql.startsWith('SELECT * FROM prov_documentos WHERE id')){const d=docs.get(Number(args[0]));return [d&&d.tipo===args[1]?[structuredClone(d)]:[]];}
  if(sql.startsWith('SELECT * FROM prov_documentos'))return [[...docs.values()].map(d=>structuredClone(d))];
  if(sql.startsWith('SELECT datos FROM prov_documentos'))return [[]];
  if(sql.includes('FROM prov_inventario i'))return [articulosInventariables.map(a=>({...a,sede:'Cartago',cantidad,grupo:'INVENTARIO',tipo:'CONSUMIBLE',stock_minimo:0,stock_maximo:0}))];
  if(sql.startsWith('SELECT codigo,descripcion,iva FROM prov_inventario')){assert.deepEqual(args,['Cartago',anclaje.codigo]);return [existe?[anclaje]:[]];}
  if(sql.startsWith('SELECT codigo,categoria FROM prov_inventario_fichas'))return [[anclaje]];
  if(sql.startsWith('SELECT * FROM prov_inventario WHERE'))return [[{...anclaje,cantidad}]];
  if(sql.startsWith('INSERT INTO prov_documentos')){const id=++nextId,tipo=sql.match(/VALUES \('(\w+)'/)[1];docs.set(id,{id,tipo,usuario_id:args[0],sede:args[1],datos:JSON.parse(args[2]),creado_en:new Date()});return [{insertId:id}];}
  if(sql.startsWith('UPDATE prov_documentos SET datos'))docs.get(Number(args[1])).datos=JSON.parse(args[0]);
  if(sql.startsWith('INSERT INTO prov_inventario (')){assert.equal(args[1],anclaje.codigo);cantidad+=args[4];}
  if(sql.startsWith('UPDATE prov_inventario SET cantidad=cantidad-'))cantidad-=args[0];
  if(sql.startsWith('INSERT INTO prov_inventario_movimientos'))movimientos.push(args);
  return sql.startsWith('SELECT')?[[]]:[{affectedRows:1}];
 }
 pool.query=query;pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}});
 const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));app.use(express.json());app.use(express.urlencoded({extended:true}));app.use((req,res,next)=>{req.session={user:gestor};next();});app.use('/proveeduria',router);
 const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));const base=`http://127.0.0.1:${s.address().port}/proveeduria`;
 const json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const pedido={sede:'Cartago',lineas:[{codigo:anclaje.codigo,categoria:'Salud ocupacional',cantidad:2,inventariable:false}]};
 const form=()=>new URLSearchParams({origen_formulario:'taller',solicitud_id:'1',proveedor:'Proveedor',email:'proveedor@example.com',empresa_destino:'GAS TOMZA',credito:'30',forma_pago:'Crédito',entrega:'5 días',moneda:'CRC',iva:'13','lineas[0][codigo_producto]':anclaje.codigo,'lineas[0][descripcion]':anclaje.descripcion,'lineas[0][cantidad]':'2','lineas[0][precio_unitario]':'100'});
 try{
  const pagina=await fetch(base+'/mis-solicitudes');assert.equal(pagina.status,200);const html=await pagina.text();
  const catalogo=JSON.parse(html.match(/<script id="prov-datos"[^>]*>([\s\S]*?)<\/script>/)[1]).articulos;
  for(const a of articulosInventariables){const filas=catalogo.filter(x=>x.codigo===a.codigo);assert.equal(filas.length,1);assert.notEqual(filas[0].inventariable,false);}
  const inv=await fetch(base+'/inventario');assert.equal(inv.status,200);assert.match(await inv.text(),/Anclaje 90 cm/);
  existe=false;assert.equal((await fetch(base+'/solicitudes',json(pedido))).status,400);assert.equal(docs.size,0);existe=true;
  assert.equal((await fetch(base+'/solicitudes',json(pedido))).status,200);assert.equal(docs.get(1).datos.lineas[0].inventariable,undefined);
  assert.equal((await fetch(base+'/solicitudes/1/cotizacion',{method:'POST',body:form(),redirect:'manual'})).status,302);
  assert.equal((await fetch(base+'/ordenes',{method:'POST',body:form(),redirect:'manual'})).status,302);
  assert.equal(esNoInventariable(docs.get(2).datos.lineas[0]),false);
  assert.equal((await fetch(base+'/salidas',json({solicitud_id:1}))).status,400);assert.equal(cantidad,0);
  const recibo={token:'a'.repeat(32),version:0,referencia:'Entrega física de anclajes',lineas:[{codigo:anclaje.codigo,cantidad:2}]};
  assert.equal((await fetch(base+'/ordenes/2/recibir',json(recibo))).status,200);assert.equal(cantidad,2);assert.equal(movimientos.length,1);assert.equal(movimientos[0][0],'ENTRADA_OC');
  assert.equal((await (await fetch(base+'/ordenes/2/recibir',json(recibo))).json()).repetida,true);assert.equal(cantidad,2);
  assert.equal((await fetch(base+'/salidas',json({solicitud_id:1}))).status,200);assert.equal(cantidad,0);assert.equal(movimientos.length,2);assert.equal(movimientos[1][0],'SALIDA_PEDIDO');
 }finally{pool.query=oq;pool.getConnection=oc;await new Promise(r=>s.close(r));}
});
