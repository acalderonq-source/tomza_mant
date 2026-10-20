const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const path=require('node:path');
const pool=require('../src/db');
const {controlarAccesoPorDepartamento,puedeAbrirRutaPorDepartamento}=require('../src/utils/departamentos');
const {puedeAcceder}=require('../src/utils/accesosTrabajador');
const {SEDES_OPERACIONES}=require('../src/utils/operacionesTaller');
const operador={id:81,usuario:'operaciones',nombre:'Operaciones',rol:'SUPERVISOR',sede:'Cartago',departamentoActivo:'OPERACIONES',departamentos:['OPERACIONES']};

test('Operaciones permite crear y consultar reportes, con lectura y gestión separadas',()=>{
  for(const [ruta,metodo] of [['/reportes-supervisores','GET'],['/reportes-supervisores','POST'],['/reportes-supervisores/historial','GET'],['/reportes-supervisores/reporte/excel','GET']]){
    assert.equal(puedeAbrirRutaPorDepartamento('OPERACIONES',ruta,'SUPERVISOR',metodo),true);
    assert.equal(puedeAcceder({departamento:'OPERACIONES',permisos:{OPERACIONES:'GESTION'}},ruta,metodo),true);
    assert.equal(puedeAcceder({departamento:'OPERACIONES',permisos:{OPERACIONES:'LECTURA'}},ruta,metodo),metodo==='GET');
    assert.equal(puedeAcceder({departamento:'OPERACIONES',permisos:{}},ruta,metodo),false);
  }
  for(const [ruta,metodo] of [['/reportes-supervisores/rutas','GET'],['/reportes-supervisores/7/cerrar','POST'],['/reportes-supervisores/7/eliminar','POST'],['/reportes-supervisores/7/editar','POST'],['/reportes-supervisores/7/reabrir','POST'],['/mantenimientos','POST'],['/unidades/agregar','POST']]){
    assert.equal(puedeAbrirRutaPorDepartamento('OPERACIONES',ruta,'ADMIN',metodo),false);
    assert.equal(puedeAcceder({departamento:'OPERACIONES',permisos:{OPERACIONES:'GESTION'}},ruta,metodo),false);
  }
});

async function escenario(run){
  const original=pool.query;
  let actor={...operador};
  const unidades=[{id:1,placa:'TEC101',sede:'Tecnicos',activa:1},{id:2,placa:'CARTAGO999',sede:'Cartago',activa:1},{id:3,placa:'TEC-INACTIVA',sede:'Tecnicos',activa:0},{id:4,placa:'TEC202',sede:'Técnicos',activa:1}];
  const reportes=[],consultas=[];
  pool.query=async(sql,args=[])=>{
    consultas.push({sql,args});
    if(/information_schema/i.test(sql))return [[{count:1,total:1}]];
    if(sql.includes('SELECT id,placa FROM unidades') || sql.includes('SELECT id, placa, sede FROM unidades WHERE activa')){
      if(actor.departamentoActivo==='OPERACIONES')assert.deepEqual(args,[SEDES_OPERACIONES]);assert.match(sql,/activa\s*=\s*1/);
      return [unidades.filter(u=>u.activa&&SEDES_OPERACIONES.includes(u.sede))];
    }
    if(sql.includes('SELECT id, placa, sede FROM unidades WHERE id = ?'))return [unidades.filter(u=>String(u.id)===String(args[0])&&(!sql.includes('AND activa = 1')||u.activa))];
    if(sql.includes('INSERT INTO reportes_supervisores')){
      const [unidad_id,sede,supervisor_id,supervisor_nombre,descripcion_original,descripcion_limpia,semana_reporte,tipo_mantenimiento]=args;
      reportes.push({id:reportes.length+1,unidad_id,sede,supervisor_id,supervisor_nombre,descripcion_original,descripcion_limpia,semana_reporte,tipo_mantenimiento,estado:'PENDIENTE',fecha_reporte:'2026-10-20'});
      return [{insertId:reportes.length}];
    }
    if(sql.includes('FROM reportes_supervisores rs')){
      if(sql.includes("WHERE rs.estado IN ('HISTORIAL'"))return [[]];
      const sedes=args.find(Array.isArray);
      return [reportes.filter(r=>!sedes||sedes.includes(r.sede)).map(r=>({...r,placa:unidades.find(u=>u.id===r.unidad_id).placa}))];
    }
    if(sql.includes('COUNT(*) AS total FROM supervisor_rutas'))return [[{total:1}]];
    return [[]];
  };
  const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));
  app.use(express.urlencoded({extended:true}));
  app.use((req,res,next)=>{req.session={user:actor,sedeSeleccionada:actor.departamentoActivo==='TALLER'?'Tecnicos':'Cartago'};next();});
  app.use(controlarAccesoPorDepartamento);
  app.use('/operaciones',require('../src/routes/operaciones.routes'));
  app.use('/reportes-supervisores',require('../src/routes/reportesSupervisores.routes'));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{await run({base:`http://127.0.0.1:${server.address().port}`,reportes,consultas,cambiar:u=>{actor=u;}});}
  finally{pool.query=original;await new Promise(r=>server.close(r));}
}
const post=values=>({method:'POST',redirect:'manual',body:new URLSearchParams(values)});

test('flujo real: unidades de Técnicos en Operaciones, registro por placa y recepción en Taller',async()=>{
  await escenario(async({base,reportes,consultas,cambiar})=>{
    const inicio=await fetch(base+'/operaciones');assert.equal(inicio.status,200);const html=await inicio.text();
    assert.match(html,/Reportes de Taller/);assert.match(html,/TEC101/);assert.match(html,/TEC202/);assert.doesNotMatch(html,/CARTAGO999|TEC-INACTIVA/);
    const form=await fetch(base+'/reportes-supervisores?unidad_id=1');assert.equal(form.status,200);const formulario=await form.text();
    assert.match(formulario,/value="1" selected/);assert.match(formulario,/Unidad de Operaciones/);assert.doesNotMatch(formulario,/href="\/mantenimientos"|href="\/reportes-supervisores\/rutas|Asignación semanal pendiente|CARTAGO999|TEC-INACTIVA|data-placa-search/);
    assert.equal((await fetch(base+'/reportes-supervisores',post({unidad_id:1,descripcion_original:'Revisar frenos de la unidad',tipo_mantenimiento:'CORRECTIVO',sede:'Cartago',supervisor_id:999}))).status,302);
    assert.equal(reportes.length,1);assert.equal(reportes[0].sede,'Tecnicos');assert.equal(reportes[0].supervisor_id,81);
    const seguimiento=await fetch(base+'/reportes-supervisores');assert.match(await seguimiento.text(),/revisar frenos de la unidad/i);
    for(const unidad_id of [2,3,999])await fetch(base+'/reportes-supervisores',post({unidad_id,descripcion_original:'Unidad ajena'}));
    assert.equal(reportes.length,1);
    assert.equal((await fetch(base+'/reportes-supervisores/historial')).status,200);
    const excel=await fetch(base+'/reportes-supervisores/reporte/excel');assert.equal(excel.status,200);assert.match(excel.headers.get('content-type'),/spreadsheetml/);
    assert.ok(consultas.filter(c=>c.sql.includes('FROM reportes_supervisores rs')).every(c=>c.sql.includes('rs.sede IN (?)')&&c.args.some(a=>Array.isArray(a)&&a.includes('Tecnicos'))));
    cambiar({...operador,rol:'TALLER',departamentoActivo:'TALLER',departamentos:['TALLER']});
    // Taller consulta Técnicos con su filtro de sede existente.
    const taller=await fetch(base+'/reportes-supervisores?sede=Tecnicos');assert.equal(taller.status,200);assert.match(await taller.text(),/revisar frenos de la unidad/i);
  });
});

test('Operaciones mantiene Técnicos incluso con rol ADMIN o Pesados y respeta accesos personales',async()=>{
  await escenario(async({base,cambiar,reportes})=>{
    for(const rol of ['ADMIN','SUPERVISOR_PESADO','TRAMITES']){
      cambiar({...operador,rol});
      assert.equal((await fetch(base+'/reportes-supervisores')).status,200);
      for(const ruta of ['/reportes-supervisores/1/cerrar','/reportes-supervisores/1/eliminar','/reportes-supervisores/rutas'])assert.equal((await fetch(base+ruta,post({}))).status,403);
      assert.equal((await fetch(base+'/reportes-supervisores/rutas')).status,403);
    }
    cambiar({...operador,accesoPersonal:{departamento:'OPERACIONES',permisos:{OPERACIONES:'LECTURA'}}});
    const lectura=await fetch(base+'/reportes-supervisores');assert.equal(lectura.status,200);assert.doesNotMatch(await lectura.text(),/name="descripcion_original"/);
    assert.equal((await fetch(base+'/reportes-supervisores',post({unidad_id:1,descripcion_original:'No guardar'}))).status,403);
    cambiar({...operador,accesoPersonal:{departamento:'OPERACIONES',permisos:{OPERACIONES:'GESTION'}}});
    assert.equal((await fetch(base+'/reportes-supervisores',post({unidad_id:4,descripcion_original:'Revisar luces'}))).status,302);
    assert.equal(reportes.length,1);assert.equal(reportes[0].sede,'Técnicos');
  });
});
