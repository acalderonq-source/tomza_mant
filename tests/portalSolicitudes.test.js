const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),session=require('express-session'),bcrypt=require('bcryptjs'),path=require('node:path');
const {createRouters,validarSolicitud}=require('../src/routes/portalSolicitudes.routes');
const {ensureCsrfToken}=require('../src/middleware/security');
const datos={cedula:'3-101-602523',razon_social:'Proveedor de prueba S.A.',email:'PRUEBA@example.com',contacto:'Ana Prueba',telefono:'8888-8888',direccion:'Cartago, Costa Rica'};
test('validación normaliza identificación y correo sin aceptar datos incompletos',()=>{
  assert.equal(validarSolicitud(datos).cedula,'3101602523');
  assert.equal(validarSolicitud(datos).email,'prueba@example.com');
  for(const cambio of [{cedula:'abc'},{email:'otro'},{telefono:'hola'},{razon_social:''},{direccion:'a'.repeat(501)}])assert.throws(()=>validarSolicitud({...datos,...cambio}));
});
test('solicitud pública no crea accesos; solo propietario aprueba y queda auditado una vez',async()=>{
  let solicitud,cuenta,commits=0,rollbacks=0;
  const query=async(sql,args=[])=>{
    if(sql.startsWith('INSERT IGNORE INTO prov_portal_solicitudes')){solicitud||={id:1,cedula:args[0],razon_social:args[1],email:args[2],contacto:args[3],telefono:args[4],direccion:args[5],estado:'PENDIENTE',creado_en:new Date()};return [{insertId:1}];}
    if(sql.includes('SELECT * FROM prov_portal_solicitudes'))return [[solicitud].filter(Boolean)];
    if(sql.startsWith('SELECT id,nombre FROM prov_proveedores'))return [[{id:5,nombre:'Proveedor de prueba S.A.'}]];
    if(sql.startsWith('SELECT id FROM prov_portal_cuentas'))return [cuenta?[{id:cuenta.id}]:[]];
    if(sql.startsWith('SELECT id FROM prov_proveedores'))return [[{id:5}]];
    if(sql.startsWith('INSERT IGNORE INTO prov_proveedores'))return [{insertId:5}];
    if(sql.startsWith('INSERT INTO prov_portal_cuentas')){cuenta={id:11,proveedor_id:args[0],email:args[1],cedula:args[2],hash:args[3]};return [{insertId:11}];}
    if(sql.startsWith('UPDATE prov_portal_solicitudes')){Object.assign(solicitud,{estado:args[0],cuenta_id:args[1],revisado_por:args[2]});return [{affectedRows:1}];}
    throw Error('SQL inesperado: '+sql);
  };
  const db={query,getConnection:async()=>({query,beginTransaction:async()=>{},commit:async()=>{commits++;},rollback:async()=>{rollbacks++;},release:()=>{}})};
  const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));app.use(express.urlencoded({extended:false}));app.use(express.json());app.use(session({secret:'test-only-solicitudes',resave:false,saveUninitialized:false}));
  app.get('/test-login/:id',(req,res)=>{req.session.user={id:Number(req.params.id),rol:'ADMIN'};res.sendStatus(204);});
  app.use(ensureCsrfToken);app.get('/token',(_req,res)=>res.json({token:res.locals.csrfToken}));
  const routers=createRouters(db,async user=>user.id===1);
  app.use('/portal-proveedores/solicitar-acceso',routers.publico);app.use('/administracion/portal-proveedores/solicitudes',routers.privado);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;let cookie='',token;
  const req=async(url,body)=>{const r=await fetch(base+url,{redirect:'manual',method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json','x-csrf-token':token||''},...(body?{body:JSON.stringify(body)}:{})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;};
  const publico='/portal-proveedores/solicitar-acceso',privado='/administracion/portal-proveedores/solicitudes';
  try{
    token=(await(await req('/token')).json()).token;
    assert.equal((await req(publico)).status,200);
    assert.equal((await req(publico,{...datos,email:'invalido'})).status,400);
    assert.equal((await req(publico,datos)).status,202);assert.equal(cuenta,undefined);assert.equal(solicitud.estado,'PENDIENTE');
    assert.equal((await req(publico,{...datos,razon_social:'Intento de reemplazo'})).status,202);assert.equal(solicitud.razon_social,datos.razon_social);
    assert.equal((await req(privado)).status,401);
    await req('/test-login/2');assert.equal((await req(privado)).status,403);
    assert.equal((await req(privado+'/1',{accion:'aprobar',password:'PasswordDePrueba123',plazo_dias:30,proveedor_id:'nuevo'})).status,403);
    await req('/test-login/1');assert.equal((await req(privado)).status,200);
    assert.equal((await req(privado+'/1',{accion:'aprobar',password:'corta',plazo_dias:30,proveedor_id:'nuevo'})).status,400);
    const aprobar={accion:'aprobar',password:'PasswordDePrueba123',plazo_dias:30,proveedor_id:'nuevo'};
    assert.equal((await req(privado+'/1',aprobar)).status,200);
    assert.equal(solicitud.estado,'APROBADA');assert.equal(solicitud.revisado_por,1);assert.equal(solicitud.cuenta_id,11);assert.equal(cuenta.cedula,'3101602523');assert.equal(await bcrypt.compare(aprobar.password,cuenta.hash),true);
    assert.equal((await req(privado+'/1',aprobar)).status,400);assert.equal(commits,1);assert.equal(rollbacks,1);
    solicitud.estado='PENDIENTE';assert.equal((await req(privado+'/1',aprobar)).status,400,'existing account cannot be replaced');
    cuenta=undefined;assert.equal((await req(privado+'/1',{accion:'rechazar',motivo:'Identidad pendiente de confirmar'})).status,200);assert.equal(solicitud.estado,'RECHAZADA');assert.equal(cuenta,undefined);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
