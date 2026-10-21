const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('node:path');
const pool=require('../src/db'),router=require('../src/routes/proveeduria.routes');
const retirados=require('../src/data/proveeduriaArticulosRetiradosSolicitud.json');
const {articulosSinInventario,articulosInventariables,articuloSolicitud}=require('../src/utils/proveeduriaSolicitable');
test('se retiran las opciones indicadas en las imágenes y se conservan los quince artículos inventariables',()=>{
 assert.equal(retirados.length,16);assert.equal(new Set(retirados).size,16);
 assert.equal(articulosSinInventario.length,207);assert.equal(articulosInventariables.length,15);
 assert.ok(retirados.every(c=>!articulosSinInventario.some(a=>a.codigo===c)));
 assert.ok(retirados.every(c=>articuloSolicitud(c)),'se conserva la lectura de documentos anteriores');
 assert.ok(retirados.every(c=>!articulosInventariables.some(a=>a.codigo===c)));
});
test('solicitudes conservan cloro, jabón, sellos y orings una vez desde inventario y clasifican los envases en Carburación',async()=>{
 const oq=pool.query,oc=pool.getConnection,guardadas=[];
 const stock=[{sede:'Cartago',codigo:'CLOR-GT',descripcion:'Cloro',categoria:'Limpieza',unidad:'UND',iva:13,cantidad:2},{sede:'Cartago',codigo:'JAB-bacterial-GT',descripcion:'Jabón antibacterial',categoria:'Limpieza',unidad:'UND',iva:13,cantidad:0}];
 const sellos=['PV-FFC87516','PV-9194F15F','PV-367D4E37','PV-40139625','PV-2BEFD371','PV-81D5EA6F','PV-6E68CFBC'].map((codigo,i)=>({sede:'Cartago',codigo,descripcion:articuloSolicitud(retirados[9+i]).descripcion,categoria:'Operaciones',unidad:'UND',iva:13,cantidad:0}));
 stock.push(...sellos);
 async function query(sql,args=[]){
  if(sql.includes('FROM prov_inventario i'))return [stock];
  if(sql.startsWith('SELECT codigo,descripcion,iva FROM prov_inventario'))return [stock.filter(a=>args.includes(a.codigo))];
  if(sql.startsWith('SELECT codigo,categoria FROM prov_inventario_fichas'))return [stock.filter(a=>args.includes(a.codigo))];
  if(sql.startsWith('INSERT INTO prov_documentos')){guardadas.push(JSON.parse(args[2]));return [{insertId:guardadas.length}];}
  assert.doesNotMatch(sql,/^(?:DELETE|UPDATE|INSERT INTO prov_inventario)/,'no borrar ni ajustar inventario');
  return [[]];
 }
 pool.query=query;pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}});
 const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));app.use(express.json());app.use((req,res,next)=>{req.session={user:{id:81,usuario:'operaciones',rol:'SUPERVISOR',sede:'Cartago',departamentoActivo:'OPERACIONES',departamentos:['OPERACIONES']}};next();});app.use('/proveeduria',router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/proveeduria`;
 const post=lineas=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sede:'Cartago',lineas})});
 try{
  const pagina=await fetch(base+'/mis-solicitudes');assert.equal(pagina.status,200);
  const html=await pagina.text(),catalogo=JSON.parse(html.match(/<script id="prov-datos"[^>]*>([\s\S]*?)<\/script>/)[1]).articulos;
  for(const codigo of retirados)assert.ok(!catalogo.some(a=>a.codigo===codigo));
  for(const descripcion of ['Cloro','Jabón antibacterial'])assert.equal(catalogo.filter(a=>a.descripcion===descripcion).length,1);
  for(const sello of sellos){const opciones=catalogo.filter(a=>a.descripcion===sello.descripcion);assert.equal(opciones.length,1);assert.equal(opciones[0].codigo,sello.codigo);assert.notEqual(opciones[0].inventariable,false);}
  const envases=catalogo.filter(a=>/^(CILINDRO|TANQUE)/.test(a.descripcion));assert.equal(envases.length,19);assert.ok(envases.every(a=>a.categoria==='Carburación'));
  for(const codigo of retirados)assert.equal((await fetch(base+'/solicitudes',post([{codigo,cantidad:1}]))).status,400);
  assert.equal(guardadas.length,0);
  assert.equal((await fetch(base+'/solicitudes',post(stock.map(a=>({codigo:a.codigo,categoria:a.categoria,cantidad:1}))))).status,200);
  assert.deepEqual(guardadas[0].lineas.map(l=>l.codigo),stock.map(a=>a.codigo));
  assert.equal((await fetch(base+'/solicitudes',post([{codigo:envases[0].codigo,categoria:'Operaciones',cantidad:1}]))).status,400);
  assert.equal((await fetch(base+'/solicitudes',post([{codigo:envases[0].codigo,categoria:'Carburación',cantidad:1}]))).status,200);
  assert.equal(guardadas[1].lineas[0].categoria,'Carburación');
  assert.equal(stock[0].cantidad,2);assert.equal(stock[1].cantidad,0);
 }finally{pool.query=oq;pool.getConnection=oc;await new Promise(r=>server.close(r));}
});
