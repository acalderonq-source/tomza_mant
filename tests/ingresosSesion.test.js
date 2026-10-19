const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registrarIngreso, mensajeIngreso, correoIngreso, identidadIngreso, procesarAvisosIngreso, perfilAvisosIngreso } = require('../src/utils/ingresosSesion');
const { filtrosIngreso } = require('../src/routes/ingresosSesion.routes');
test('contacto e identidad son individuales por cedula, no por perfil compartido',()=>{
  assert.equal(identidadIngreso({id:2,cedula:'100000001'}),'C:100000001');
  assert.equal(identidadIngreso({id:2,cedula:'100000002'}),'C:100000002');
  assert.equal(identidadIngreso({id:1}),'U:1');
  assert.equal(correoIngreso(' Persona@Example.com '),'persona@example.com');
  for(const c of ['a@b.com,c@d.com','a@b.com\r\nbcc:test@a.com','invalido'])assert.throws(()=>correoIngreso(c,true));
});
test('ingreso guarda persona, IP validada y aviso pendiente sin PIN ni secretos',async()=>{
  let params;
  const db={query:async(sql,args)=>{
    if(sql.startsWith('SELECT correo'))return [[{correo:'persona@example.com'}]];
    params=args;return [{insertId:9}];
  }};
  const user={id:7,usuario:'taller',nombre:'Persona',cedula:'100000001',rol:'TALLER',departamentoActivo:'TALLER',sede:'Cartago',pin:'secreto'};
  assert.equal(await registrarIngreso(db,user,{ip:'127.0.0.1',get:()=>'<Chrome>'}),9);
  assert.equal(params[0],'C:100000001');assert.equal(params[3],'Persona');assert.equal(params[7],'127.0.0.1');assert.equal(params[10],'PENDIENTE');
  assert.ok(!JSON.stringify(params).includes('secreto'));
});
test('sin correo guarda el log sin intentar inventar un destinatario',async()=>{
  let params;
  const db={query:async(sql,args)=>sql.startsWith('SELECT')?[[]]:(params=args,[{insertId:1}])};
  await registrarIngreso(db,{id:1,usuario:'admin',nombre:'Admin',rol:'ADMIN',departamentoActivo:'TALLER'},{ip:'direccion-no-valida',get:()=>''});
  assert.equal(params[7],null);assert.equal(params[9],null);assert.equal(params[10],'SIN_CORREO');
});
test('aviso escapa datos y nunca incluye contrasena ni PIN',()=>{
  const msg=mensajeIngreso({nombre:'<script>nombre</script>',usuario:'taller',creado_en:new Date(),departamento:'TALLER',pin:'1234',password:'secreto'});
  assert.ok(msg.html.includes('&lt;script&gt;'));assert.ok(!msg.html.includes('<script>'));
  assert.ok(!msg.html.includes('1234'));assert.ok(!msg.html.includes('secreto'));
});
test('cola registra envio y fallos SMTP sin guardar mensajes privados del error',async()=>{
  const rows=[1,2].map(id=>({id,intentos:0,correo_estado:'PENDIENTE',correo_destino:'persona@example.com',nombre:'Persona',usuario:'taller',creado_en:new Date()}));
  const cambios=[];
  const db={query:async(sql,args)=>{
    if(sql.startsWith('SELECT *'))return [rows];
    cambios.push({sql,args});return [{affectedRows:1}];
  }};
  let enviados=0;
  await procesarAvisosIngreso(db,async(_to,_sub,_html,opciones)=>{
    assert.equal(opciones.perfil,'seguridad');
    if(++enviados===2)throw Object.assign(Error('contrasena privada'),{code:'EAUTH'});
  },{});
  assert.equal(enviados,2);
  assert.ok(cambios.some(c=>c.sql.includes("correo_estado='ENVIADO'")));
  assert.ok(cambios.some(c=>c.args?.[0]==='EAUTH'));
  assert.ok(!JSON.stringify(cambios).includes('contrasena privada'));
});
test('no envia en staging ni cuando otra instancia reclamo el aviso',async()=>{
  let count=0;
  const db={query:async sql=>{count++;return sql.startsWith('SELECT')?[[{id:1,intentos:0,correo_estado:'PENDIENTE'}]]:[{affectedRows:0}];}};
  await procesarAvisosIngreso(db,()=>assert.fail(),{APP_ENV:'staging'});assert.equal(count,0);
  await procesarAvisosIngreso(db,()=>assert.fail(),{});
});
test('filtros rechazan fechas invalidas y rangos sin limite',()=>{
  assert.throws(()=>filtrosIngreso({desde:'2026-02-31',hasta:'2026-03-10'}));
  assert.throws(()=>filtrosIngreso({desde:'2020-01-01',hasta:'2026-01-01'}));
  assert.equal(filtrosIngreso({desde:'2026-10-01',hasta:'2026-10-19'}).hasta,'2026-10-19');
});
test('avisos priorizan seguridad y reutilizan facturas solo cuando no hay remitente general',()=>{
  assert.equal(perfilAvisosIngreso({estaConfigurado:p=>p==='seguridad'}),'seguridad');
  assert.equal(perfilAvisosIngreso({estaConfigurado:p=>p==='facturas'}),'facturas');
  assert.equal(perfilAvisosIngreso({estaConfigurado:()=>false}),null);
});
test('falta de remitente queda identificada en el log sin exponer configuracion privada',async()=>{
  let codigo;
  const db={query:async(sql,args)=>{
    if(sql.startsWith('SELECT'))return [[{id:1,intentos:0,correo_estado:'PENDIENTE',creado_en:new Date()}]];
    if(sql.includes("correo_estado='ERROR',error_codigo=?"))codigo=args[0];
    return [{affectedRows:1}];
  }};
  const enviar=()=>assert.fail();enviar.estaConfigurado=()=>false;
  await procesarAvisosIngreso(db,enviar,{});
  assert.equal(codigo,'REMITENTE_NO_CONFIGURADO');
});
