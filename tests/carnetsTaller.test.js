const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('node:path');
const pool=require('../src/db'),router=require('../src/routes/carnets.routes');
const {puedeConsultarCarnetsTaller}=require('../src/utils/carnetsTaller');
test('consulta de carnets limitada a asistente y jefe en Taller',()=>{
 for(const perfilExcel of ['ASISTENTE TALLER','JEFE DE TALLER','ASISTENTE DE TALLER']){
  assert.ok(puedeConsultarCarnetsTaller({rol:'TALLER',departamentoActivo:'TALLER',perfilExcel}));
 }
 for(const user of [null,{rol:'MECANICO'},{rol:'TALLER',departamentoActivo:'TALLER',perfilExcel:'PROVEEDURIA_TALLER'},{rol:'TALLER',departamentoActivo:'CONTABILIDAD',perfilExcel:'JEFE DE TALLER'}])assert.equal(puedeConsultarCarnetsTaller(user),false);
});
test('lista, busqueda, carnet, foto y PDF filtran mecanicos; escrituras siguen solo ADMIN',async()=>{
 const original=pool.query;const queries=[];
 pool.query=async(sql,params)=>{queries.push({sql,params});return [[]];};
 const app=express();app.set('views',path.join(__dirname,'../src/views'));app.set('view engine','ejs');
 app.use((req,_res,next)=>{req.session={user:{rol:'TALLER',departamentoActivo:'TALLER',perfilExcel:'ASISTENTE TALLER'}};next();});app.use(router);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{
  const base='http://127.0.0.1:'+server.address().port,token='a'.repeat(64);
  const r=await fetch(base+'/taller/carnets?buscar=prueba');assert.equal(r.status,200);const html=await r.text();
  assert.match(html,/Carnets de mecánicos/);assert.doesNotMatch(html,/Editar perfiles|Crear carnet con acceso existente|Cargar foto/);
  assert.deepEqual(queries[0].params,['%prueba%','%prueba%','%prueba%']);
  for(const url of ['/taller/carnets/'+token+'.pdf','/personal/carnet/'+token,'/personal/carnet/'+token+'/foto']){
   assert.equal((await fetch(base+url)).status,404);
  }
  for(const q of queries)assert.match(q.sql,/cm.cedula=c.cedula AND um.rol='MECANICO'/);
  const count=queries.length;
  for(const url of ['/admin/carnets-trabajadores','/admin/carnets-trabajadores/'+token+'/foto']){
   assert.equal((await fetch(base+url,{method:'POST'})).status,403);
  }
  assert.equal(queries.length,count);
  assert.equal((await fetch(base+'/admin/carnets-trabajadores')).status,403);
 }finally{pool.query=original;await new Promise(resolve=>server.close(resolve));}
});
