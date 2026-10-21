const test=require('node:test'),assert=require('node:assert/strict'),ejs=require('ejs'),path=require('node:path');
const {restringirModulosMecanicos}=require('../src/middleware/modulosMecanicos');
test('mecanicos no abren modulos retirados ni subrutas; otros accesos no cambian',()=>{
 for(const user of [{rol:'MECANICO',usuario:'raul'}]){
  for(const ruta of ['/dashboard/resumen-ejecutivo','/taller/dashboard','/lavado-unidades']){
   for(const suffix of ['','/datos']){
    let status,next=false;restringirModulosMecanicos({session:{user},path:ruta+suffix},{status(n){status=n;return this;},send(){}},()=>{next=true;});
    assert.equal(status,403);assert.equal(next,false);
   }
  }
 }
 for(const user of [{rol:'ADMIN'},{rol:'TALLER'},{rol:'PANTALLA_MECANICOS',usuario:'mecanicos'},{rol:'MECANICO'},{rol:'SUPERVISOR',usuario:'mecanico_alajuela'}]){
  const ruta=user.rol==='MECANICO'?'/mantenimientos':'/taller/dashboard';
  let next=false;restringirModulosMecanicos({session:{user},path:ruta},{},()=>{next=true;});assert.ok(next);
 }
});
test('dashboard de mecanicos oculta los tres accesos pero mantiene mantenimientos',async()=>{
 for(const user of [{rol:'MECANICO',usuario:'mecanico'},{rol:'MECANICO',usuario:'raul'}]){
  const html=await ejs.renderFile(path.join(__dirname,'../src/views/dashboard.ejs'),{
   user:{...user,sede:'Cartago',departamentoActivo:'TALLER'},hoy:[],stats:{},ejecutivo:{},sedeSeleccionada:'Cartago',
   sedesMultiples:[],usuarioPesados:false,sedesDashboard:[],alertasEjecutivas:[],prioridadesTaller:[],puedeVerOficinaDiaDia:false
  });
  for(const url of ['/dashboard/resumen-ejecutivo','/taller/dashboard','/lavado-unidades'])assert.ok(!html.includes('href="'+url+'"'),url);
  assert.match(html,/href="\/mantenimientos"/);
 }
});
