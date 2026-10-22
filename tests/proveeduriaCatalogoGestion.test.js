const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('node:path');
const pool=require('../src/db'),router=require('../src/routes/proveeduria.routes');
const {articulosInventariables,articulosSinInventario,codigoInventario,articuloSolicitud,catalogoParaOrden}=require('../src/utils/proveeduriaSolicitable');
const {categoriaArticulo}=require('../src/utils/proveeduriaCategorias');
const gestor={id:72,usuario:'compras',rol:'PROVEEDURIA',sede:'Cartago',departamentoActivo:'PROVEEDURIA',departamentos:['PROVEEDURIA']};
const json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function servidor(user,run){
 const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));app.use(express.json());app.use((req,res,next)=>{req.session={user};next();});app.use('/proveeduria',router);
 const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));try{await run(`http://127.0.0.1:${s.address().port}/proveeduria`);}finally{await new Promise(r=>s.close(r));}
}
test('Papelería contiene solo blocs y los 57 productos técnicos usan inventario sin duplicar códigos',()=>{
 for(const descripcion of ['Bloc de notas','Blocs de recibos','Block orden de compra','Blocks de remesas'])assert.equal(categoriaArticulo({descripcion,categoria:'Oficina'}),'Papelería');
 for(const descripcion of ['Lapicero','Carpetas plásticas','Cuaderno','Resmas de papel','TRASLADO DE TANQUE'])assert.equal(categoriaArticulo({descripcion,categoria:'Papelería'}),'Oficina');
 const tech=articulosInventariables.filter(a=>a.categoria==='Técnicos');assert.equal(tech.length,57);
 assert.equal(tech.filter(a=>codigoInventario(a.codigo)!==a.codigo).length,28);
 assert.equal(new Set(tech.map(a=>codigoInventario(a.codigo))).size,57);
 assert.ok(!articulosSinInventario.some(a=>a.categoria==='Técnicos'));
 const catalogo=catalogoParaOrden([]);for(const a of tech)assert.equal(catalogo.find(x=>x.descripcion===a.descripcion).codigo,codigoInventario(a.codigo));
 assert.equal(codigoInventario('__proto__'),'__proto__');
});
test('gestión puede eliminar de ambos catálogos sin borrar stock ni documentos; las bajas persisten y se validan en solicitudes',async()=>{
 const oq=pool.query,oc=pool.getConnection,bajas=new Map(),writes=[];
 const tech=articulosInventariables.find(a=>a.categoria==='Técnicos'&&codigoInventario(a.codigo)!==a.codigo);
 const stock={...tech,codigo:codigoInventario(tech.codigo),cantidad:8,sede:'Cartago',unidad:'UND'};
 const libre=articulosSinInventario[0];let fallar=false,rollback=0;
 async function query(sql,args=[]){
  sql=sql.trim();
  if(sql==='SELECT codigo FROM prov_inventario_bajas')return [[...bajas.keys()].map(codigo=>({codigo}))];
  if(sql.includes('FROM prov_inventario i'))return [[stock]];
  if(sql.startsWith('SELECT * FROM prov_inventario WHERE'))return [[stock].filter(a=>a.codigo===args[1])];
  if(sql.startsWith('INSERT INTO prov_inventario_bajas')){if(fallar)throw Error('fallo simulado');writes.push(args);if(!bajas.has(args[0]))bajas.set(args[0],args);return [{affectedRows:1}];}
  if(sql.startsWith('SELECT'))return [[]];
  assert.fail('Escritura inesperada: '+sql);
 }
 pool.query=query;pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rollback++;},release(){}});
 try{await servidor(gestor,async base=>{
  const antes=await (await fetch(base+'/catalogo')).text();assert.match(antes,/Administrar productos/);assert.match(antes,/catalogo\/eliminar/);assert.match(antes,new RegExp(stock.codigo));assert.match(antes,new RegExp(libre.codigo));
  const inv=await (await fetch(base+'/inventario')).text();assert.match(inv,/catalogo\/eliminar/);
  assert.equal((await fetch(base+'/catalogo/eliminar',json({codigo:tech.codigo}))).status,200);
  assert.equal((await fetch(base+'/catalogo/eliminar',json({codigo:libre.codigo}))).status,200);
  assert.equal((await fetch(base+'/catalogo/eliminar',json({codigo:stock.codigo}))).status,200);
  assert.equal(bajas.size,2);assert.equal(writes[0][0],stock.codigo);assert.equal(writes[0][2],'INVENTARIO');assert.equal(writes[0][4],gestor.id);assert.equal(JSON.parse(writes[0][3]).cantidad,8);assert.equal(writes[1][2],'CATALOGO');
  for(const url of ['/mis-solicitudes','/inventario','/catalogo','/ordenes/nueva']){const r=await fetch(base+url);assert.equal(r.status,200);const html=await r.text();assert.doesNotMatch(html,new RegExp(stock.codigo));assert.doesNotMatch(html,new RegExp(libre.codigo));}
  for(const codigo of [stock.codigo,tech.codigo,libre.codigo])assert.equal((await fetch(base+'/solicitudes',json({sede:'Cartago',lineas:[{codigo,cantidad:1}]}))).status,400);
  assert.equal(stock.cantidad,8);
  assert.equal((await fetch(base+'/catalogo/eliminar',json({codigo:'INEXISTENTE'}))).status,404);
  assert.equal((await fetch(base+'/catalogo/eliminar',json({codigo:''}))).status,400);
  fallar=true;assert.equal((await fetch(base+'/catalogo/eliminar',json({codigo:libre.codigo}))).status,500);assert.ok(rollback>0);
 });}finally{pool.query=oq;pool.getConnection=oc;}
});
test('solo el permiso de gestión permite eliminar; lectura y otros departamentos no pueden',async()=>{
 const oq=pool.query;pool.query=async()=>[[]];
 try{for(const user of [
  {...gestor,accesoPersonal:{departamento:'PROVEEDURIA',permisos:{PROVEEDURIA:'LECTURA'}}},
  {...gestor,rol:'CONTABILIDAD',departamentoActivo:'CONTABILIDAD'},
  {...gestor,rol:'SUPERVISOR',departamentoActivo:'OPERACIONES',departamentos:['OPERACIONES']}
 ])await servidor(user,async base=>{
  assert.equal((await fetch(base+'/catalogo/eliminar',json({codigo:'STOCK'}))).status,403);
  if(user.departamentoActivo!=='OPERACIONES'){const r=await fetch(base+'/catalogo');assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/data-api="\/proveeduria\/catalogo\/eliminar"/);}
 });}finally{pool.query=oq;}
});
test('los documentos antiguos con códigos SOL reciben y entregan contra el código existente de inventario',async()=>{
 const oq=pool.query,oc=pool.getConnection;
 const origen=articulosInventariables.find(a=>a.categoria==='Técnicos'&&codigoInventario(a.codigo)!==a.codigo),codigo=codigoInventario(origen.codigo);
 const linea={...articuloSolicitud(origen.codigo),cantidad:2,precio_unitario:100,inventariable:false};
 const docs=new Map([[1,{id:1,tipo:'solicitud',usuario_id:72,sede:'Cartago',datos:{estado:'ORDENADA',oc_id:2,lineas:[linea]}}],[2,{id:2,tipo:'oc',usuario_id:72,sede:'Cartago',datos:{estado:'GENERADA',solicitud_id:1,proveedor:'Proveedor',lineas:[linea]}}]]);
 let cantidad=0;const movimientos=[];
 async function query(sql,args=[]){
  sql=sql.trim();
  if(sql.startsWith('SELECT * FROM prov_documentos WHERE id')){const d=docs.get(Number(args[0]));return [d&&d.tipo===args[1]?[structuredClone(d)]:[]];}
  if(sql.startsWith('SELECT * FROM prov_inventario WHERE')){assert.equal(args[1],codigo);return [[{codigo,cantidad}]];}
  if(sql.startsWith('INSERT INTO prov_inventario (')){assert.equal(args[1],codigo);cantidad+=args[4];}
  if(sql.startsWith('INSERT INTO prov_inventario_fichas'))assert.equal(args[1],codigo);
  if(sql.startsWith('UPDATE prov_inventario SET cantidad=cantidad-')){assert.equal(args[2],codigo);cantidad-=args[0];}
  if(sql.startsWith('INSERT INTO prov_inventario_movimientos')){assert.equal(args.at(-1),codigo);movimientos.push(args);}
  if(sql.startsWith('UPDATE prov_documentos SET datos'))docs.get(Number(args[1])).datos=JSON.parse(args[0]);
  if(sql.startsWith('INSERT INTO prov_documentos')){docs.set(3,{id:3,tipo:'salida',usuario_id:args[0],sede:args[1],datos:JSON.parse(args[2])});return [{insertId:3}];}
  return sql.startsWith('SELECT')?[[]]:[{affectedRows:1}];
 }
 pool.query=query;pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}});
 try{await servidor(gestor,async base=>{
  const body={token:'c'.repeat(32),version:0,referencia:'Recepción técnica',lineas:[{codigo:origen.codigo,cantidad:2}]};
  assert.equal((await fetch(base+'/ordenes/2/recibir',json(body))).status,200);assert.equal(cantidad,2);
  assert.equal((await (await fetch(base+'/ordenes/2/recibir',json(body))).json()).repetida,true);assert.equal(cantidad,2);
  assert.equal((await fetch(base+'/salidas',json({solicitud_id:1}))).status,200);assert.equal(cantidad,2);assert.equal(movimientos.length,1);
  assert.equal((await fetch(base+'/salidas/3/enviar',{method:'POST'})).status,200);assert.equal(cantidad,0);assert.equal(movimientos.length,2);
  assert.equal(docs.get(3).datos.lineas[0].codigo,origen.codigo,'el documento conserva la referencia histórica');
 });}finally{pool.query=oq;pool.getConnection=oc;}
});
