const {test}=require('node:test');
const assert=require('node:assert/strict');
const ejs=require('ejs');
const path=require('node:path');
const express=require('express');
const {departamentosInicio,destinoIngreso}=require('../src/utils/inicioEmpresa');
const db=require('../src/db');
const router=require('../src/routes/auth.routes');
test('Inicio refleja solo permisos asignados sin otorgar accesos nuevos',async()=>{
  const user={nombre:'Mecanico <script>',rol:'MECANICO',departamentos:['TALLER']};
  const areas=departamentosInicio(user);
  assert.deepEqual(areas.filter(a=>a.permitido).map(a=>a.key),['TALLER']);
  const html=await ejs.renderFile(path.join(__dirname,'../src/views/inicio_empresa.ejs'),{user,departamentos:areas,next:''});
  assert.ok(html.includes('name="departamento" value="TALLER"'));
  assert.ok(!html.includes('name="departamento" value="ADMINISTRACION"'));
  assert.ok(html.includes('disabled title="Sin acceso asignado"'));
  assert.ok(html.includes('Mecanico &lt;script&gt;'));
  assert.equal(destinoIngreso('',{rol:'MECANICO'}),'/inicio');
  assert.equal(destinoIngreso('/dashboard',{rol:'TALLER'}),'/inicio');
  assert.equal(destinoIngreso('/mantenimientos',{rol:'TALLER'}),'/mantenimientos');
  assert.equal(destinoIngreso('',{rol:'PANTALLA_MECANICOS'}),'/taller/dashboard');
  assert.equal(destinoIngreso('',{rol:'ADMIN',requiere_cambio_password:1}),'/cambiar-clave');
});
test('Cambio de departamento rechaza POST manipulado, permiso revocado y fallos de base',async()=>{
  let user={id:7,rol:'TALLER',departamentos:['TALLER'],departamentoActivo:'TALLER'};
  let areas=['TALLER'],fallar=false;
  const original=db.query;
  db.query=async()=>{if(fallar)throw Error('offline');return [areas.map(departamento=>({departamento}))];};
  const app=express();app.use(express.urlencoded({extended:true}));
  app.use((req,res,next)=>{req.session={user};next();});app.use(router);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base='http://127.0.0.1:'+server.address().port;
  const post=departamento=>fetch(base+'/departamento/activo',{method:'POST',redirect:'manual',body:new URLSearchParams({departamento})});
  try {
    assert.equal((await post('ADMINISTRACION')).status,403);
    assert.equal(user.departamentoActivo,'TALLER');
    user.departamentos.push('CONTABILIDAD');
    assert.equal((await post('CONTABILIDAD')).status,403);
    areas.push('CONTABILIDAD');
    assert.equal((await post('CONTABILIDAD')).headers.get('location'),'/dashboard');
    assert.equal(user.departamentoActivo,'CONTABILIDAD');
    fallar=true;
    assert.equal((await post('TALLER')).status,503);
    assert.equal(user.departamentoActivo,'CONTABILIDAD');
  } finally {db.query=original;await new Promise(resolve=>server.close(resolve));}
});
