const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('node:path'),ExcelJS=require('exceljs');
const pool=require('../src/db'),routes=require('../src/routes/proveeduria.routes');
const {fichaInventario,estadoStock}=require('../src/utils/proveeduriaInventario');
const user={id:10,usuario:'compras',rol:'PROVEEDURIA',sede:'Cartago',departamentoActivo:'PROVEEDURIA',departamentos:['PROVEEDURIA']};
async function server(run){const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));app.use(express.json());app.use((req,res,next)=>{req.session={user};next();});app.use('/proveeduria',routes);const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));try{await run(`http://127.0.0.1:${s.address().port}/proveeduria`);}finally{await new Promise(r=>s.close(r));}}
const post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('mínimos y máximos determinan el estado y rechazan cantidades inválidas',()=>{
  assert.equal(estadoStock({cantidad:0,stock_minimo:2}),'AGOTADO');assert.equal(estadoStock({cantidad:2,stock_minimo:2}),'BAJO');assert.equal(estadoStock({cantidad:3,stock_minimo:2}),'DISPONIBLE');
  assert.throws(()=>fichaInventario({descripcion:'Papel',stock_minimo:4,stock_maximo:3}));assert.throws(()=>fichaInventario({descripcion:'Papel',stock_minimo:-1}));assert.throws(()=>fichaInventario({descripcion:'Papel',stock_minimo:0.0001}));
});
test('inventario usa las existencias propias, filtra grupos, limita sedes y exporta cantidades numéricas',async()=>{
  const original=pool.query;const rows=[{sede:'Cartago',codigo:'P1',descripcion:'Papel',cantidad:'2.500',iva:'13',grupo:'SUMINISTRO',tipo:'CONSUMIBLE',categoria:'Oficina',unidad:'UND',ubicacion:'A-01',stock_minimo:'3',stock_maximo:'10',proveedor:'Proveedor'},{sede:'Cartago',codigo:'H1',descripcion:'Herramienta',cantidad:'1',iva:'13',grupo:'INVENTARIO',tipo:'HERRAMIENTA',categoria:'',unidad:'UND',ubicacion:'B-02',stock_minimo:0,stock_maximo:0,proveedor:''}];
  pool.query=async(sql,args)=>{assert.doesNotMatch(sql,/\bbodega_articulos\b|\bbodega_movimientos\b/);if(sql.includes('FROM prov_inventario i')){assert.deepEqual(args,['Cartago']);return [structuredClone(rows)];}return [[]];};
  try{await server(async base=>{
    const r=await fetch(base+'/inventario?grupo=SUMINISTRO');assert.equal(r.status,200);const html=await r.text();assert.match(html,/Centro de control de inventario/);assert.match(html,/Papel/);assert.doesNotMatch(html,/<strong>Herramienta<\/strong>/);assert.match(html,/Stock bajo/);assert.match(html,/A-01/);
    assert.equal((await fetch(base+'/inventario?sede=NoAutorizada')).status,403);
    const x=await fetch(base+'/inventario/exportar.xlsx?grupo=SUMINISTRO');assert.equal(x.status,200);const w=new ExcelJS.Workbook();await w.xlsx.load(Buffer.from(await x.arrayBuffer()));assert.equal(w.worksheets[0].getCell('G2').value,2.5);assert.equal(w.worksheets[0].rowCount,2);
  });}finally{pool.query=original;}
});
test('ajuste físico conserva saldos y motivo, evita duplicados y revierte el stock si falla el historial',async()=>{
  const originalQuery=pool.query,originalConnection=pool.getConnection;let cantidad=5,logs=[],fallar=false;
  pool.query=async()=>[[]];pool.getConnection=async()=>{let snapshot;return {beginTransaction:async()=>{snapshot={cantidad,logs:structuredClone(logs)};},commit:async()=>{},rollback:async()=>{cantidad=snapshot.cantidad;logs=snapshot.logs;},release(){},query:async(sql,args)=>{
    assert.match(sql,/prov_inventario/);if(sql.startsWith('SELECT')){assert.match(sql,/FOR UPDATE/);return [[{cantidad}]];}
    if(sql.startsWith('UPDATE prov_inventario SET cantidad='))cantidad=args[0];
    if(sql.startsWith('INSERT INTO prov_inventario_movimientos')){if(fallar)throw Error('Fallo simulado');logs.push({tipo:args[0],cantidad:args[1],anterior:cantidad-args[2],nuevo:cantidad,motivo:args[5],usuario:args[4]});}
    return [{affectedRows:1}];
  }};};
  try{await server(async base=>{
    const body={sede:'Cartago',codigo:'P1',cantidad:2,motivo:'Conteo físico'};
    assert.equal((await fetch(base+'/inventario/ajuste',post(body))).status,200);assert.deepEqual(logs,[{tipo:'AJUSTE',cantidad:-3,anterior:5,nuevo:2,motivo:'Conteo físico',usuario:10}]);
    assert.equal((await fetch(base+'/inventario/ajuste',post(body))).status,400);assert.equal(logs.length,1);
    fallar=true;assert.equal((await fetch(base+'/inventario/ajuste',post({...body,cantidad:1}))).status,500);assert.equal(cantidad,2);assert.equal(logs.length,1);
    assert.equal((await fetch(base+'/inventario/ajuste',post({...body,cantidad:-1}))).status,400);
    assert.equal((await fetch(base+'/inventario/ajuste',post({...body,motivo:''}))).status,400);
    assert.equal((await fetch(base+'/inventario/ajuste',post({...body,sede:'NoAutorizada'}))).status,403);
  });}finally{pool.query=originalQuery;pool.getConnection=originalConnection;}
});
