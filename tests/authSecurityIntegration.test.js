const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),session=require('express-session'),bcrypt=require('bcryptjs'),path=require('node:path');
const pool=require('../src/db'),router=require('../src/routes/auth.routes'),{protegerSesiones}=require('../src/middleware/sessionSecurity'),{sessionSecret}=require('../src/utils/sessionConfig'),{ensureCsrfToken}=require('../src/middleware/security');
test('destinos del login no permiten redirecciones externas por barras invertidas',()=>{
  for(const url of ['//evil.test','/\\evil.test','https://evil.test','/foo\r\nLocation: x'])assert.equal(router.getSafeNextUrl(url),'');
  assert.equal(router.getSafeNextUrl('/dashboard'),'/dashboard');
});
test('login normal funciona, un cambio de rol revoca el acceso y los intentos fallidos se limitan',async()=>{
  const original=pool.query,hash=await bcrypt.hash('PruebaSegura123!',4);
  const user={id:501,usuario:'prueba-seguridad',rol:'TALLER',sede:'CENTRAL',password:hash,requiere_cambio_password:0};
  const cedula='3101000001';let pin=hash;let fallarRegistro=false;const ingresos=[];
  pool.query=async(sql,args)=>{
    if(sql.startsWith('SELECT correo FROM ingreso_correos'))return [[]];
    if(sql.startsWith('INSERT INTO sesion_ingresos')){if(fallarRegistro)throw Object.assign(Error('DB no disponible'),{code:'ECONNRESET'});ingresos.push(args);return [{insertId:ingresos.length}];}
    if(sql.includes('sesion_ingresos'))return [[]];
    if(sql.includes('FROM usuario_cedulas uc')&&sql.includes('JOIN usuarios u'))return [[{...user,pin_hash:pin,cedula_persona:cedula},{...user,id:502,usuario:'prueba-seguridad2',pin_hash:pin,cedula_persona:cedula}]];
    if(sql.includes('FROM usuarios'))return [[{...user,...(sql.includes('uc.pin_hash')?{pin_hash:args?.[0]===cedula?pin:null,...(args?.[0]===cedula?{cedula_persona:cedula}:{})}:{})}]];
    if(sql.includes('FROM usuario_departamentos'))return [[{departamento:'TALLER',es_principal:1}]];
    throw Error('Consulta inesperada');
  };
  const app=express();app.set('views',path.join(__dirname,'../src/views'));app.set('view engine','ejs');app.use(express.json());app.use(session({secret:'integration-only',resave:false,saveUninitialized:false}));app.use(protegerSesiones(pool,sessionSecret));app.use(ensureCsrfToken);
  app.get('/test-token',(req,res)=>res.json({token:res.locals.csrfToken}));
  app.get('/test-private',(req,res)=>req.session.user?res.json({usuario:req.session.user.usuario}):res.sendStatus(401));app.use(router);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;let cookie='',token;
  const request=async(url,options={})=>{const r=await fetch(base+url,{redirect:'manual',...options,headers:{cookie,...options.headers}});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;};
  const login=async(password)=>request('/login',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':token},body:JSON.stringify({usuario:user.usuario,password,departamento:'TALLER'})});
  try{
    token=(await(await request('/test-token')).json()).token;
    assert.equal((await login('PruebaSegura123!')).status,302);
    assert.equal(ingresos.length,1);
    assert.equal((await request('/test-private')).status,200);
    user.rol='BODEGUERO';assert.equal((await request('/test-private')).status,302);
    user.rol='TALLER';token=(await(await request('/test-token')).json()).token;
    for(let i=0;i<10;i++)assert.equal((await login('Incorrecta123!')).status,200);
    assert.equal((await login('Incorrecta123!')).status,429);
    assert.equal(ingresos.length,1,'los intentos fallidos no se cuentan como sesiones iniciadas');
    const loginPin=async(value)=>request('/login',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':token},body:JSON.stringify({cedula,pin:value,departamento:'TALLER'})});
    const perfil=async()=>request('/login/perfil',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':token},body:JSON.stringify({usuarioId:501})});
    assert.equal((await loginPin('PruebaSegura123!')).status,200);
    pin=await bcrypt.hash('NuevoPinSeguro123!',4);
    assert.equal((await perfil()).headers.get('location'),'/login?departamento=TALLER');
    assert.equal((await loginPin('NuevoPinSeguro123!')).status,200);
    assert.equal((await perfil()).headers.get('location'),'/dashboard');
    assert.equal((await request('/test-private')).status,200);
    assert.equal(ingresos.length,2,'la seleccion de perfil registra solo el ingreso final');
    assert.equal(ingresos[1][0],'C:'+cedula);
    token=(await(await request('/test-token')).json()).token;
    assert.equal((await loginPin('NuevoPinSeguro123!')).status,200);
    fallarRegistro=true;
    assert.equal((await perfil()).status,503,'no deja una sesion activa sin poder registrar el ingreso');
    assert.equal((await request('/test-private')).status,401);

  }finally{pool.query=original;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
