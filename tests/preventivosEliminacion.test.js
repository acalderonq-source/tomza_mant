const test=require('node:test');
const assert=require('node:assert/strict');
const {eliminarPreventivo}=require('../src/utils/preventivosEliminacion');
const {generarPreventivos}=require('../src/utils/preventivosSemanales');
function base(cambios={}) {
  const registro={id:9,unidad_id:3,tipo:'PREVENTIVO',estado:'PROGRAMADO',fecha:'2026-10-19',...cambios};
  const eventos=[];
  const db={async beginTransaction(){eventos.push('begin');},async commit(){eventos.push('commit');},async rollback(){eventos.push('rollback');},release(){eventos.push('release');},async query(sql,args){
    if(sql.startsWith('SELECT unidad_id'))return [[{unidad_id:3}]];
    if(sql.includes('FROM unidades'))return [[{id:3,sede:'Cartago'}]];
    if(sql.startsWith('SELECT *,'))return [[registro]];
    if(sql.startsWith('SELECT mantenimiento_id'))return [[]];
    if(sql.startsWith('INSERT')){eventos.push(['audit',args]);return [{affectedRows:1}];}
    if(sql.startsWith('DELETE')){eventos.push('delete');return [{affectedRows:1}];}
    throw Error(sql);
  }};
  const pool={query:async()=>[[]],getConnection:async()=>db};
  return {pool,db,eventos};
}
test('elimina solo la ocurrencia y guarda actor y copia en la misma transaccion',async()=>{
  const {pool,eventos}=base();await eliminarPreventivo(pool,9,{id:5},()=>true);
  const audit=eventos.find(e=>Array.isArray(e));assert.deepEqual(audit[1].slice(0,4),[9,3,'2026-10-19',5]);
  assert.equal(JSON.parse(audit[1][4]).tipo,'PREVENTIVO');
  assert.deepEqual(eventos.filter(e=>typeof e==='string'),['begin','delete','commit','release']);
});
test('rechaza cerrados, correctivos, ejecuciones y sedes ajenas sin borrar',async()=>{
  for(const cambios of [{estado:'CERRADO'},{tipo:'CORRECTIVO'},{ejecucion:'Trabajo realizado'},{fecha_cierre:'2026-10-19'}]){
    const {pool,eventos}=base(cambios);await assert.rejects(()=>eliminarPreventivo(pool,9,{id:5},()=>true),e=>e.status===409);
    assert.equal(eventos.includes('delete'),false);assert.equal(eventos.includes('rollback'),true);
  }
  const {pool,eventos}=base();await assert.rejects(()=>eliminarPreventivo(pool,9,{id:5},()=>false),e=>e.status===403);assert.equal(eventos.includes('delete'),false);
});
test('protege registros vinculados y revierte si no se pudo guardar auditoria',async()=>{
  for(const tabla of ['ejecuciones','mantenimiento_mecanicos','planes_taller','reportes_supervisores']){
    const {pool,db,eventos}=base();const original=db.query;
    db.query=async(sql,args)=>sql.includes(`FROM ${tabla} `)?[[{mantenimiento_id:9}]]:original(sql,args);
    await assert.rejects(()=>eliminarPreventivo(pool,9,{id:5},()=>true),e=>e.status===409);assert.equal(eventos.includes('delete'),false);
  }
  const {pool,db,eventos}=base();const original=db.query;
  db.query=async(sql,args)=>{if(sql.startsWith('INSERT'))throw Error('Fallo auditoria');return original(sql,args);};
  await assert.rejects(()=>eliminarPreventivo(pool,9,{id:5},()=>true),/Fallo auditoria/);assert.equal(eventos.includes('delete'),false);assert.equal(eventos.includes('rollback'),true);
});
test('el generador omite la fecha eliminada pero mantiene la siguiente semana',async()=>{
  const creadas=[];
  const db={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql,args){
    if(sql.includes('FROM unidades'))return [[{id:3,sede:'Cartago'}]];
    if(sql.includes('FROM preventivos_programaciones'))return [[{id:1,unidad_id:3,inicio:'2026-10-19',procesada:'2026-10-18',intervalo_semanas:1,creado_por:5}]];
    if(sql.includes('FROM mantenimientos'))return [[]];
    if(sql.includes('FROM preventivos_eliminados'))return [args[1]==='2026-10-19'?[{mantenimiento_id:9}]:[]];
    if(sql.startsWith('INSERT INTO mantenimientos')){creadas.push(args[2]);return [{insertId:10}];}
    return [{affectedRows:1}];
  }};
  const pool={query:async sql=>sql.includes('SELECT p.id')?[[{id:1,unidad_id:3,sede:'Cartago'}]]:[[]],getConnection:async()=>db};
  assert.equal(await generarPreventivos(pool,'2026-10-26'),1);assert.deepEqual(creadas,['2026-10-26']);
});

test('endpoint exige autenticacion, rol de gestion e identificador valido',async()=>{
  const express=require('express');
  const router=require('../src/routes/mantenimientos.routes');
  for(const [user,id,status] of [[null,'9',302],[{rol:'MECANICO'},'9',403],[{rol:'SUPERVISOR'},'9',403],[{rol:'ADMIN'},'invalido',400]]){
    const app=express();app.use((req,res,next)=>{req.session={user};next();});app.use('/mantenimientos',router);
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    try{const r=await fetch(`http://127.0.0.1:${server.address().port}/mantenimientos/${id}/eliminar`,{method:'POST',redirect:'manual'});assert.equal(r.status,status);}
    finally{await new Promise(r=>server.close(r));}
  }
});
