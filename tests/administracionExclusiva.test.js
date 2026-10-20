const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const fs=require('node:fs');
const path=require('node:path');
const {requireAdministracion}=require('../src/middleware/requireAdministracion');
test('exige propietario y departamento activo, sin aceptar solo ADMIN o asignaciones',async()=>{
  const response=()=>({statusCode:200,set(){},status(n){this.statusCode=n;return this;},send(){}});
  const guard=requireAdministracion({},async user=>user.id===1);
  for(const user of [null,{id:1,rol:'ADMIN',departamentoActivo:'TALLER'},{id:2,rol:'ADMIN',departamentoActivo:'ADMINISTRACION'},{id:1,rol:'TALLER',departamentoActivo:'ADMINISTRACION'}]){
    const res=response();let permitio=false;
    await guard({session:{user}},res,()=>{permitio=true;});
    assert.equal(permitio,false);assert.ok([401,403].includes(res.statusCode));
  }
  let permitio=false;await guard({session:{user:{id:1,rol:'ADMIN',departamentoActivo:'ADMINISTRACION'}}},response(),()=>{permitio=true;});assert.equal(permitio,true);
});
test('rutas y acciones privadas se bloquean desde otros departamentos antes de consultar datos',async()=>{
  let consultas=0;
  const db={query:async()=>{consultas++;throw Error('No consultar datos');}};
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{req.session={user:{id:1,rol:'ADMIN',departamentoActivo:req.get('x-area')||'TALLER'}};next();});
  app.use('/control-empresa',require('../src/routes/controlEmpresa.routes').crearRouter(db));
  app.use('/admin/ingresos',require('../src/routes/ingresosSesion.routes').crearRouter(db));
  app.use('/admin/solicitudes-trabajadores',require('../src/routes/trabajadorSolicitudes.routes').createRouters(db).privado);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  try{
    const rutas=['/control-empresa','/control-empresa/unidades','/control-empresa/auditoria/excel','/admin/ingresos','/admin/ingresos/correos','/admin/solicitudes-trabajadores'];
    for(const area of ['TALLER','OPERACIONES','CONTABILIDAD','PROVEEDURIA'])for(const ruta of rutas)assert.equal((await fetch(base+ruta,{headers:{'x-area':area}})).status,403,area+ruta);
    for(const ruta of ['/admin/ingresos/correos','/admin/ingresos/1/reintentar','/admin/solicitudes-trabajadores/1'])assert.equal((await fetch(base+ruta,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal(consultas,0);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('los cuatro accesos no estan en Taller y aparecen en la vista de Administracion',()=>{
  const dashboard=fs.readFileSync(path.resolve(__dirname,'../src/views/dashboard.ejs'),'utf8');
  const administracion=fs.readFileSync(path.resolve(__dirname,'../src/views/administracion.ejs'),'utf8');
  for(const ruta of ['/admin/ingresos','/admin/solicitudes-trabajadores','/control-empresa','/control-empresa/unidades']){
    assert.equal(dashboard.includes('href="'+ruta+'"'),false);assert.ok(administracion.includes('href="'+ruta+'"'));
  }
  assert.ok(administracion.includes("user.departamentoActivo === 'ADMINISTRACION'"));
  const ejs=require('ejs');
  for(const departamentoActivo of ['ADMINISTRACION','TALLER','OPERACIONES']){
    const html=ejs.render(administracion,{user:{usuario:'admin',departamentoActivo,departamentos:[]},departamentos:[]},{filename:path.resolve(__dirname,'../src/views/administracion.ejs')});
    for(const ruta of ['/admin/ingresos','/admin/solicitudes-trabajadores','/control-empresa','/control-empresa/unidades'])assert.equal(html.includes('href="'+ruta+'"'),departamentoActivo==='ADMINISTRACION');
  }
});
