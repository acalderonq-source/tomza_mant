const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { createRouters, validarSolicitud } = require('../src/routes/trabajadorSolicitudes.routes');
const { ensureCsrfToken, injectSecurityAssets } = require('../src/middleware/security');
const datos = { cedula: '3-0527-0365', nombre_completo: 'Persona Apellido de Prueba', puesto: 'Asistente de taller', sede: 'Cartago', correo:'persona@example.invalid' };

test('solicitud valida exactamente cedula, nombre completo, puesto y sede permitida', () => {
  assert.equal(validarSolicitud(datos, ['Cartago']).cedula, '305270365');
  for (const cambio of [{cedula:'abc305270365'}, {cedula:'123'}, {nombre_completo:'Ana'}, {puesto:''}, {sede:'Inventada'}, {puesto:['Jefe']}, {nombre_completo:'<script>alert(1)</script>'}]) {
    assert.throws(() => validarSolicitud({...datos,...cambio}, ['Cartago']));
  }
});
test('solicitar no crea acceso; ADMIN verifica, asigna perfil y crea acceso y carnet una sola vez', async () => {
  let solicitud, acceso, carnet, commits=0, rollbacks=0;
  const consultas=[];
  const query = async (sql, params=[]) => {
    consultas.push(sql);
    if (sql.includes('administracion_propietario')) return [[{usuario_id:99}]];
    if (sql.startsWith('INSERT INTO trabajador_solicitudes_acceso')) {
      solicitud ||= {id:1,cedula:params[0],nombre_completo:params[1],puesto:params[2],sede:params[3],correo:params[4],estado:'PENDIENTE',creado_en:new Date()};
      return [{affectedRows:1}];
    }
    if (sql.includes('FROM trabajador_solicitudes_acceso')) return [[solicitud].filter(Boolean)];
    if (sql.startsWith('SELECT id,usuario,nombre')) return [[{id:7,usuario:'taller',rol:'TALLER',sede:'Cartago'}]];
    if (sql.startsWith('SELECT id FROM usuarios WHERE id IN')) return [params[0].includes(7)?[{id:7}]:[]];
    if (sql.startsWith('SELECT cedula FROM usuario_cedulas')) return [acceso?[{cedula:acceso.cedula}]:[]];
    if (sql.startsWith('SELECT id FROM usuarios WHERE cedula')) return [[]];
    if (sql.startsWith('INSERT INTO usuario_cedulas')) { acceso={cedula:params[0],usuario_id:params[1],nombre:params[2],codigo:params[3],hash:params[4]}; return [{insertId:2}]; }
    if (sql.startsWith('SELECT cedula FROM carnets_trabajador')) return [carnet?[{cedula:carnet.cedula}]:[]];
    if (sql.startsWith('INSERT INTO carnets_trabajador')) { carnet={cedula:params[0],token:params[1]}; return [{insertId:1}]; }
    if (sql.startsWith('INSERT INTO ingreso_correos')) return [{affectedRows:1}];
    if (sql.startsWith('UPDATE trabajador_solicitudes_acceso')) { Object.assign(solicitud,{estado:params[0],codigo_trabajador:params[1],perfiles_json:params[2],revisado_por:params[3]}); return [{affectedRows:1}]; }
    throw Error('SQL inesperado: '+sql);
  };
  const db={query,getConnection:async()=>({query,beginTransaction:async()=>{},commit:async()=>{commits++;},rollback:async()=>{rollbacks++;},release:()=>{}})};
  const app=express();app.set('view engine','ejs');app.set('views',path.resolve(__dirname,'../src/views'));
  app.use(express.json());app.use(express.urlencoded({extended:false}));app.use(session({secret:'trabajadores-test-only',resave:false,saveUninitialized:false}));
  app.get('/test-login/:rol/:departamento?',(req,res)=>{req.session.user={id:99,rol:req.params.rol,departamentoActivo:req.params.departamento||'ADMINISTRACION'};res.sendStatus(204);});
  app.use(ensureCsrfToken);app.get('/token',(_req,res)=>res.json({token:res.locals.csrfToken}));
  const routers=createRouters(db,{cargarSedes:async()=>['Cartago']});
  app.use('/solicitar-ingreso',routers.publico);app.use('/admin/solicitudes-trabajadores',routers.privado);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port; let cookie='',token;
  const req=async(url,body,csrf=true)=>{
    const response=await fetch(base+url,{method:body?'POST':'GET',redirect:'manual',headers:{cookie,'Content-Type':'application/json',...(csrf?{'x-csrf-token':token||''}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;
  };
  const admin='/admin/solicitudes-trabajadores';
  const aprobar={accion:'aprobar',identidad_verificada:'1',codigo_trabajador:'2986',usuario_ids:['7']};
  try {
    token=(await(await req('/token')).json()).token;
    assert.equal((await req('/solicitar-ingreso')).status,200);
    assert.equal((await req('/solicitar-ingreso',datos,false)).status,403,'CSRF es obligatorio sin origen validado');
    assert.equal((await req('/solicitar-ingreso',{...datos,sitio_web:'spam'})).status,202);assert.equal(solicitud,undefined);
    assert.equal((await req('/solicitar-ingreso',datos)).status,202);assert.equal(acceso,undefined);assert.equal(carnet,undefined);
    assert.equal((await req('/solicitar-ingreso',{...datos,nombre_completo:'Intento de reemplazo'})).status,202);assert.equal(solicitud.nombre_completo,datos.nombre_completo);
    assert.equal((await req(admin)).status,401);
    await req('/test-login/MECANICO');assert.equal((await req(admin+'/1',aprobar)).status,403);
    await req('/test-login/ADMIN/TALLER');assert.equal((await req(admin)).status,403);
    await req('/test-login/ADMIN');assert.equal((await req(admin)).status,200);
    assert.equal((await req(admin+'/1',{...aprobar,identidad_verificada:'0'})).status,400);
    assert.equal((await req(admin+'/1',{...aprobar,usuario_ids:['1']})).status,400,'no acepta perfiles fuera del catalogo permitido');
    assert.equal((await req(admin+'/1',aprobar)).status,303);
    assert.equal(solicitud.estado,'APROBADA');assert.equal(solicitud.revisado_por,99);
    assert.equal(acceso.nombre,datos.nombre_completo);assert.equal(acceso.usuario_id,7);assert.ok(await bcrypt.compare('2986',acceso.hash));
    assert.equal(carnet.cedula,'305270365');assert.match(carnet.token,/^[a-f0-9]{64}$/);
    assert.equal((await req(admin+'/1',aprobar)).status,409);assert.equal(commits,1);
    solicitud.estado='PENDIENTE';assert.equal((await req(admin+'/1',aprobar)).status,409,'no reemplaza un acceso existente');
    assert.equal((await req(admin+'/1',{accion:'rechazar',motivo:'No corresponde a un trabajador verificado'})).status,303);
    assert.equal(solicitud.estado,'RECHAZADA');assert.equal(commits,2);assert.ok(rollbacks>=3);
    assert.equal(consultas.filter(sql=>sql.startsWith('INSERT INTO usuario_cedulas')).length,1);
  } finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
});
