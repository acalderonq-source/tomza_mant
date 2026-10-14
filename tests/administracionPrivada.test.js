const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),path=require('node:path');
const pool=require('../src/db');
const {esPropietarioAdministracion}=require('../src/utils/administracionPrivada');
const {departamentosPermitidosPorRol}=require('../src/utils/departamentos');
const adminRoutes=require('../src/routes/administracion.routes');
const portal=require('../src/routes/portalProveedores.routes');
test('Administración se concede al propietario y no por rol o asignación general',async()=>{
  const db={query:async()=>[[{usuario_id:1}]]};
  assert.equal(await esPropietarioAdministracion({id:1,rol:'ADMIN'},db),true);
  assert.equal(await esPropietarioAdministracion({id:17,rol:'ADMIN'},db),false);
  assert.equal(await esPropietarioAdministracion({id:1,rol:'CONTABILIDAD'},db),false);
  assert.equal(await esPropietarioAdministracion({id:1,rol:'ADMIN'},{query:async()=>[[]]}),false);
  assert.equal(departamentosPermitidosPorRol('ADMIN').includes('ADMINISTRACION'),false);
  assert.equal(departamentosPermitidosPorRol('ADMIN',[],true).includes('ADMINISTRACION'),true);
  assert.deepEqual(departamentosPermitidosPorRol('CONTABILIDAD',['CONTABILIDAD','ADMINISTRACION']),['CONTABILIDAD']);
});
async function server(user,fn){
  const app=express();app.set('views',path.join(__dirname,'../src/views'));app.set('view engine','ejs');app.use(express.json());app.use((req,res,next)=>{req.session={user};next();});
  app.use('/administracion',adminRoutes);app.use('/administracion/portal-proveedores',portal.administracion);
  app.use('/proveeduria/portal-proveedores',portal.interno);app.use('/proveeduria/portal-proveedores',portal.administracion);
  const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));try{await fn(`http://127.0.0.1:${s.address().port}`);}finally{await new Promise(r=>s.close(r));}
}
test('otros administradores y departamentos no administran cuentas ni por enlaces anteriores',async()=>{
  const original=pool.query;let writes=0;
  pool.query=async sql=>{if(!sql.startsWith('SELECT'))writes++;return sql.includes('administracion_propietario')?[[{usuario_id:1}]]:[[]];};
  try{
    for(const user of [{id:17,rol:'ADMIN'},{id:24,rol:'ADMIN'},{id:3,rol:'CONTABILIDAD'},{id:4,rol:'PROVEEDURIA'}]){
      await server(user,async base=>{
        for(const url of ['/administracion','/administracion/portal-proveedores','/proveeduria/portal-proveedores'])assert.equal((await fetch(base+url)).status,403,url);
        for(const basePath of ['/administracion/portal-proveedores','/proveeduria/portal-proveedores']){
          for(const ruta of ['/cuentas','/cuentas/5','/receptores'])assert.equal((await fetch(base+basePath+ruta,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accion:'desactivar'})})).status,403,ruta);
        }
      });
    }
    assert.equal(writes,0);
  }finally{pool.query=original;}
});
test('el propietario ve su área y gestiona el portal desde Administración',async()=>{
  const original=pool.query;pool.query=async sql=>sql.includes('administracion_propietario')?[[{usuario_id:1}]]:[[]];
  try{await server({id:1,usuario:'admin',rol:'ADMIN',departamentos:['TALLER','ADMINISTRACION']},async base=>{
    const page=await fetch(base+'/administracion');assert.equal(page.status,200);assert.match(await page.text(),/Administración/);
    const cuentas=await fetch(base+'/administracion/portal-proveedores');assert.equal(cuentas.status,200);const html=await cuentas.text();assert.match(html,/data-portal-api="\/administracion\/portal-proveedores\/cuentas"/);assert.match(html,/Crear acceso de proveedor/);
    const legacy=await fetch(base+'/proveeduria/portal-proveedores',{redirect:'manual'});assert.equal(legacy.status,302);assert.equal(legacy.headers.get('location'),'/administracion/portal-proveedores');
  });}finally{pool.query=original;}
});
