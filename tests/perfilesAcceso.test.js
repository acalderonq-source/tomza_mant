const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('node:path');
const {crearRouter,version}=require('../src/routes/perfilesAcceso.routes');
const {controlarAccesosPersonales}=require('../src/utils/accesosTrabajador');
async function servidor(user,db,fn){
  const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));app.use(express.urlencoded({extended:true}));app.use((req,res,next)=>{req.session={user};next();});app.use('/admin/perfiles',crearRouter(db,async()=>true));
  const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));try{await fn('http://127.0.0.1:'+s.address().port+'/admin/perfiles');}finally{await new Promise(r=>s.close(r));}
}
const owner={id:1,rol:'ADMIN',departamentoActivo:'ADMINISTRACION'};
function base(){
  const perfil={id:8,usuario:'tecnico',nombre:'Tecnico',rol:'MECANICO',sede:'Cartago',config_json:null};const eventos=[];
  const query=async(sql,args)=>{
    if(sql.startsWith('SELECT u.id'))return [[perfil]];
    if(sql.startsWith('INSERT INTO usuario_perfiles_historial'))eventos.push(['auditoria',args]);
    if(sql.startsWith('UPDATE usuarios'))eventos.push(['usuario',args]);
    if(sql.startsWith('INSERT INTO usuario_accesos_personales'))eventos.push(['config',args]);
    return [[]];
  };
  const db={query,getConnection:async()=>({query,beginTransaction:async()=>{},commit:async()=>eventos.push('commit'),rollback:async()=>eventos.push('rollback'),release(){}})};
  return {db,perfil,eventos};
}
test('solo propietario desde Administracion puede abrir o guardar perfiles',async()=>{
  for(const user of [null,{rol:'TALLER'},{rol:'ADMIN',departamentoActivo:'TALLER'}])await servidor(user,{query:async()=>assert.fail()},async base=>assert.equal((await fetch(base)).status,user?403:401));
});
test('edita legacy sin cambiar rol, PIN ni password y audita; configura permisos explicitamente',async()=>{
  const {db,perfil,eventos}=base();
  await servidor(owner,db,async base=>{
    assert.equal((await fetch(base)).status,200);assert.match(await (await fetch(base+'/8')).text(),/Conservar rol y departamentos actuales/);
    let body={nombre:'Nombre actualizado',modo:'conservar',sede_asignada:'Cartago',version:version(perfil)};
    const post=async b=>fetch(base+'/8',{method:'POST',redirect:'manual',body:new URLSearchParams(b)});
    assert.equal((await post(body)).status,303);assert.deepEqual(eventos.find(e=>e[0]==='usuario')[1],['Nombre actualizado','Cartago','MECANICO',8]);assert.ok(eventos.some(e=>e[0]==='auditoria'));
    assert.equal((await post({...body,version:'incorrecta'})).status,409);
    assert.equal((await post({...body,modo:'personal',departamento:'ADMINISTRACION',permiso_INICIO:'GESTION'})).status,400);
    assert.equal((await post({...body,modo:'personal',departamento:'TALLER',permiso_MANTENIMIENTOS:'LECTURA'})).status,303);
    assert.equal(JSON.parse(eventos.find(e=>e[0]==='config')[1][1]).permisos.MANTENIMIENTOS,'LECTURA');
    perfil.rol='ADMIN';assert.equal((await post(body)).status,403);assert.equal((await fetch(base+'/8')).status,403);
  });
});
test('un perfil legacy configurado respeta inmediatamente sus permisos de lectura',async()=>{
  const config={departamento:'TALLER',sede:'Cartago',permisos:{MANTENIMIENTOS:'LECTURA'}};
  const guard=controlarAccesosPersonales({query:async()=>[[{config_json:JSON.stringify(config)}]]});
  const req={session:{user:{id:8,usuario:'tecnico',rol:'TALLER',departamentoActivo:'TALLER'}},path:'/mantenimientos',method:'GET'};
  let next=false;const res={status(n){this.code=n;return this;},send(){}};
  await guard(req,res,()=>{next=true;});assert.equal(next,true);
  req.method='POST';await guard(req,res,()=>assert.fail());assert.equal(res.code,403);
});
test('Proveeduria puede configurar su modulo propio sin conceder Administracion',()=>{
  const {validarAcceso,puedeAcceder}=require('../src/utils/accesosTrabajador');
  const config=validarAcceso({departamento:'PROVEEDURIA',sede_asignada:'Cartago',permiso_PROVEEDURIA:'LECTURA'});
  assert.equal(puedeAcceder(config,'/proveeduria/inventario','GET'),true);
  assert.equal(puedeAcceder(config,'/proveeduria/inventario/articulos','POST'),false);
  assert.equal(puedeAcceder(config,'/admin/perfiles','GET'),false);
});

test('edición de permisos separa el control anterior y guarda cada opción sin volver a agruparla',async()=>{
 const {db,perfil,eventos}=base();
 perfil.rol='SUPERVISOR';perfil.config_json=JSON.stringify({departamento:'OPERACIONES',sede:'Cartago',permisos:{OPERACIONES:'GESTION'}});
 await servidor(owner,db,async base=>{
  const html=await (await fetch(base+'/8')).text();
  for(const id of ['OPERACIONES','REPORTES_TALLER','SUMINISTROS'])assert.match(html,new RegExp('name="permiso_'+id+'"[^>]*>[\\s\\S]*?<option value="GESTION" selected'));
  assert.doesNotMatch(html,/Operaciones, reportes a Taller y suministros/);
  const body={nombre:perfil.nombre,modo:'personal',sede_asignada:'Cartago',version:version(perfil),departamento:'OPERACIONES',permiso_OPERACIONES:'GESTION',permiso_REPORTES_TALLER:'LECTURA',permiso_SUMINISTROS:'NINGUNO'};
  assert.equal((await fetch(base+'/8',{method:'POST',redirect:'manual',body:new URLSearchParams(body)})).status,303);
  const guardado=JSON.parse(eventos.find(e=>e[0]==='config')[1][1]);
  assert.deepEqual(guardado.permisos,{OPERACIONES:'GESTION',REPORTES_TALLER:'LECTURA'});
  assert.equal(guardado.permisosOperacionesSeparados,true);
  perfil.config_json=JSON.stringify(guardado);
  const recargado=await (await fetch(base+'/8')).text();
  assert.match(recargado,/name="permiso_SUMINISTROS"[^>]*>\s*<option value="NINGUNO" selected/);
 });
});
