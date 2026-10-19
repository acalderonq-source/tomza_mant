const { test }=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const path=require('node:path');
const { crearRouter }=require('../src/routes/ingresosSesion.routes');
test('solo ADMIN consulta ingresos o cambia correos de personas existentes',async()=>{
  const writes=[];
  const db={query:async(sql,args)=>{
    if(sql.includes('FROM sesion_ingresos'))return [[{nombre:'Persona <script>mal</script>',usuario:'taller',rol:'TALLER',departamento:'TALLER',sede:'Cartago',ip:'127.0.0.1',dispositivo:'Chrome',correo_estado:'SIN_CORREO',creado_en:new Date()}]];
    if(sql.startsWith('SELECT personas.'))return [[{identidad:'C:100000001',nombre:'Persona',correo:null}]];
    if(sql.startsWith('SELECT persona_nombre'))return [args[0]==='100000001'?[{persona_nombre:'Persona'}]:[]];
    if(sql.startsWith('SELECT id FROM usuarios'))return [[]];
    if(sql.startsWith('INSERT INTO ingreso_correos')){writes.push(args);return [{affectedRows:1}];}
    if(sql.startsWith('UPDATE sesion_ingresos s JOIN')){assert.ok(sql.includes("IN ('ERROR','SIN_CORREO')"));return [{affectedRows:1}];}
    throw Error('Consulta inesperada');
  }};
  const app=express();app.set('view engine','ejs');app.set('views',path.resolve(__dirname,'../src/views'));
  app.use(express.json());app.use((req,_res,next)=>{req.session={user:req.get('x-role')?{id:5,rol:req.get('x-role')}:null};next();});
  app.use('/admin/ingresos',crearRouter(db));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port+'/admin/ingresos';
  const req=(ruta='',rol,body)=>fetch(base+ruta,{redirect:'manual',method:body?'POST':'GET',headers:{...(rol?{'x-role':rol}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  try{
    assert.equal((await req()).status,401);
    assert.equal((await req('','MECANICO')).status,403);
    assert.equal((await req('/correos','TALLER',{identidad:'C:100000001',correo:'persona@example.com'})).status,403);
    const log=await req('','ADMIN');assert.equal(log.status,200);assert.ok(!(await log.text()).includes('<script>mal</script>'));
    assert.equal((await req('/correos','ADMIN')).status,200);
    assert.equal((await req('/correos','ADMIN',{identidad:'C:100000001',correo:'persona@example.com'})).status,303);
    assert.deepEqual(writes[0],['C:100000001','persona@example.com',5]);
    assert.equal((await req('/correos','ADMIN',{identidad:'C:100000002',correo:'otra@example.com'})).status,404);
    assert.equal((await req('/correos','ADMIN',{identidad:'C:100000001',correo:'correo-invalido'})).status,400);
    assert.equal(writes.length,1);
    assert.equal((await req('/1/reintentar','MECANICO',{})).status,403);
    assert.equal((await req('/1/reintentar','ADMIN',{})).status,303);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
