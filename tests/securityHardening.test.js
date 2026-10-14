const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {ensureCsrfToken,injectSecurityAssets,securityHeaders,bloquearRutaEstaticaPrivada}=require('../src/middleware/security');
const {selloUsuario,protegerSesiones,IDLE_MS,ABSOLUTE_MS}=require('../src/middleware/sessionSecurity');
function response(){return {locals:{},headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},send(v){this.body=v;return this;},json(v){this.body=v;return this;},sendStatus(n){this.statusCode=n;},clearCookie(){this.cleared=true;},redirect(v){this.redirected=v;}};}
function csrf(headers={},body={},method='POST'){
  const req={method,path:'/login',protocol:'https',session:{csrfToken:'abc'},body,get:k=>headers[k],query:{}},res=response();let passed=false;
  ensureCsrfToken(req,res,()=>{passed=true;});return {req,res,passed};
}
test('login también exige CSRF; rechaza origen externo incluso con token correcto',()=>{
  assert.equal(csrf({host:'app.test'}).passed,false);
  assert.equal(csrf({host:'app.test','x-csrf-token':'abc'}).passed,true);
  assert.equal(csrf({host:'app.test',origin:'https://evil.test',referer:'https://app.test','x-csrf-token':'abc'}).passed,false);
  assert.equal(csrf({host:'app.test',origin:'http://app.test','x-csrf-token':'abc'}).passed,false);
  assert.equal(csrf({host:'app.test',origin:'null','x-csrf-token':'abc'}).passed,false);
  assert.equal(csrf({host:'app.test','sec-fetch-site':'cross-site','x-csrf-token':'abc'}).passed,false);
  assert.equal(csrf({host:'app.test',origin:'https://app.test'}).passed,true);
  assert.equal(csrf({host:'app.test'}, {},'GET').passed,true);
});
test('fetch adjunta el token solo al servidor propio, nunca a servicios externos',async()=>{
  const html=injectSecurityAssets('<html><head></head><body><form method="post"></form></body></html>','privado');
  assert.match(html,/name="_csrf"/);
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1],calls=[];
  const window={location:{href:'https://app.test/dashboard',origin:'https://app.test'},fetch:async(input,init)=>calls.push({input,init})};
  vm.runInNewContext(script,{window,URL,Headers,document:{querySelector:()=>({content:'privado'})}});
  await window.fetch('/pago',{method:'POST'});await window.fetch('https://externo.test',{method:'POST'});await window.fetch('/consulta');
  assert.equal(calls[0].init.headers.get('x-csrf-token'),'privado');
  assert.equal(calls[1].init.headers,undefined);assert.equal(calls[2].init.headers,undefined);
});
test('bloquea recorridos hacia archivos privados desde el servidor estático',()=>{
  for(const path of ['/uploads/facturas/a.pdf','/x/../uploads/facturas/a.pdf','/x/%2e%2e/uploads/facturas/a.pdf','/x/..%5cuploads/a.pdf','/uploads%2ffacturas/a.pdf']){
    const res=response();let passed=false;bloquearRutaEstaticaPrivada({path},res,()=>{passed=true;});assert.equal(passed,false,path);
  }
  let passed=false;bloquearRutaEstaticaPrivada({path:'/css/login.css'},response(),()=>{passed=true;});assert.equal(passed,true);
});
test('cabeceras restringen marcos, MIME y referencias; HSTS solo en HTTPS',()=>{
  for(const secure of [false,true]){const res=response();securityHeaders({secure},res,()=>{});assert.equal(res.headers['X-Frame-Options'],'SAMEORIGIN');assert.equal(res.headers['X-Content-Type-Options'],'nosniff');assert.match(res.headers['Content-Security-Policy'],/frame-ancestors 'self'/);assert.equal(Boolean(res.headers['Strict-Transport-Security']),secure);}
});
test('sesiones caducan y se invalidan al cambiar permisos, contraseña o PIN',async()=>{
  const now=Date.now(),original={id:1,usuario:'admin',rol:'ADMIN',sede:'TODAS',password:'hash-a',pin_hash:'pin-a'},originalAreas=[{departamento:'TALLER',es_principal:1}],secret='secreto-de-pruebas';
  for(const cambio of ['ninguno','password','pin','rol','sede','area','eliminado','idle','absoluta','antigua','fallo-db']){
    const actual={...original};let areas=structuredClone(originalAreas);
    if(cambio==='password')actual.password='hash-b';if(cambio==='pin')actual.pin_hash='pin-b';if(cambio==='rol')actual.rol='TALLER';if(cambio==='sede')actual.sede='OTRA';if(cambio==='area')areas=[];
    const user={...original,authStamp:selloUsuario(original,originalAreas,secret)},session={user,authenticatedAt:now-100,lastActivity:now-100};
    if(cambio==='idle')session.lastActivity=now-IDLE_MS-1;if(cambio==='absoluta')session.authenticatedAt=now-ABSOLUTE_MS-1;if(cambio==='antigua')delete user.authStamp;
    let destroyed=false,passed=false;session.destroy=cb=>{destroyed=true;cb();};
    const db={query:async sql=>{if(cambio==='fallo-db')throw Object.assign(Error('unavailable'),{code:'ENOTFOUND'});return sql.includes('FROM usuarios')?[cambio==='eliminado'?[]:[actual]]:[areas];}};
    const res=response();await protegerSesiones(db,secret,()=>now)({session,path:'/dashboard',method:'GET',headers:{}},res,()=>{passed=true;});
    assert.equal(passed,cambio==='ninguno',cambio);assert.equal(destroyed,!['ninguno','fallo-db'].includes(cambio),cambio);if(cambio==='fallo-db')assert.equal(res.statusCode,503);
  }
});
test('proveedores también caducan por inactividad sin permitir acceso interno',async()=>{
  let destroyed=false,passed=false;const now=Date.now(),session={proveedorPortal:{id:2},authenticatedAt:now-100,lastActivity:now-IDLE_MS-1,destroy:cb=>{destroyed=true;cb();}};
  const res=response();await protegerSesiones({query:async()=>{throw Error('No debe consultar usuario interno');}},'secret',()=>now)({session,method:'GET',path:'/portal-proveedores',headers:{}},res,()=>{passed=true;});
  assert.equal(destroyed,true);assert.equal(passed,false);assert.equal(res.redirected,'/portal-proveedores/login');
});

test('TLS de MySQL exige verificar certificado e identidad, sin degradar a conexión insegura',()=>{
  const {mysqlTls}=require('../src/utils/mysqlTls');
  assert.equal(mysqlTls({}),undefined);
  assert.deepEqual(mysqlTls({MYSQL_SSL:'true'}),{rejectUnauthorized:true,verifyIdentity:true,minVersion:'TLSv1.2'});
  assert.throws(()=>mysqlTls({MYSQL_SSL_CA:'certificado inventado'}),/PEM válido/);
  assert.throws(()=>mysqlTls({MYSQL_SSL_CA:'x',MYSQL_SSL_CA_FILE:'x'}),/solo MYSQL_SSL_CA/);
});

test('el proxy TCP conserva la validación de la identidad certificada de MySQL',()=>{
  const {mysqlNetwork,mysqlTls}=require('../src/utils/mysqlTls');
  assert.throws(()=>mysqlNetwork({MYSQL_SSL_SERVER_NAME:'MySQL_Server'}),/requiere TLS/);
  const env={MYSQL_SSL:'true',MYSQL_SSL_SERVER_NAME:'MySQL_Server',MYSQLHOST:'proxy.test',MYSQLPORT:'3306'};
  assert.equal(mysqlNetwork(env).host,'MySQL_Server');assert.equal(typeof mysqlNetwork(env).stream,'function');assert.equal(mysqlTls(env).verifyIdentity,true);
  assert.throws(()=>mysqlNetwork({...env,MYSQL_SSL_SERVER_NAME:'https://otro.test'}),/inválido/);
});

test('los datos de órdenes no pueden cerrar el script e inyectar HTML',()=>{
  const fs=require('node:fs'),ejs=require('ejs');
  const source=fs.readFileSync(require('node:path').join(__dirname,'../src/views/compras/orden_form.ejs'),'utf8');
  const tag=source.match(/<%- JSON\.stringify\(lineasIniciales\)[\s\S]*?%>/)[0];
  const lineasIniciales=[{descripcion:'</script><img src=x onerror=alert(1)>',codigo:'A<1'}];
  const output=ejs.render(tag,{lineasIniciales});assert.ok(!output.includes('<'));assert.deepEqual(JSON.parse(output),lineasIniciales);
});
