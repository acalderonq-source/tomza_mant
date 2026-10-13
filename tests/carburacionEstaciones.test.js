const test=require('node:test');const assert=require('node:assert/strict');const express=require('express');const path=require('node:path');
const source=require('../src/data/carburacion_estaciones.json');
const clientes=require('../src/data/carburacion_clientes.json').clientes.map((c,i)=>({...c,id:i+1}));
const util=require('../src/utils/carburacionEstaciones');
const pool=require('../src/db');const routes=require('../src/routes/carburacion.routes');
const {guardarRegistro}=require('../src/utils/carburacionEstacionesStore');
test('extrae 195 registros de siete áreas y conserva las filas repetidas y datos originales',()=>{
  assert.equal(source.registros.length,195);assert.equal(source.omitidas.length,30);
  const conteos={};source.registros.forEach(r=>{conteos[r.categoria]=(conteos[r.categoria] || 0)+1;assert.doesNotThrow(()=>util.desdeExcel(r));});
  assert.deepEqual(conteos,{seguimiento:15,construccion:3,minae:8,municipal:32,pendiente:5,mantenimientos:66,mejoras:66});
  const rep=source.registros.filter(r=>r.categoria==='mejoras' && r.estacion==='Bomba Orotina');assert.equal(rep.length,2);
  assert.notDeepEqual(rep[0].valores,rep[1].valores);
  assert.equal(source.registros.filter(r=>r.categoria==='seguimiento' && util.desdeExcel(r).estado==='FINALIZADO').length,8);
});
test('calcula solo las fórmulas reconocidas y conserva fechas manuales y textos en fechas',()=>{
  const registros=source.registros.filter(r=>r.categoria==='mantenimientos').map(util.desdeExcel);
  const tike=registros.find(r=>r.estacion==='Tike Tibás');assert.equal(tike.campos.proximo_mantenimiento,'2026-12-01');assert.equal(tike.campos.calculo_proximo,'dias');
  const manual=registros.find(r=>r.estacion==='Servicentro Chamú');assert.equal(manual.campos.proximo_mantenimiento,'2026-11-06');assert.equal(manual.campos.calculo_proximo,'manual');
  const ingnova=registros.find(r=>r.estacion==='M&S Jimenez');assert.equal(ingnova.campos.ultimo_mantenimiento,'');assert.match(ingnova.campos.nota_mantenimiento,/Ingnova/);
  assert.equal(util.mantenimientoEstado({proximo_mantenimiento:'2026-10-12'},'2026-10-13'),'VENCIDO');
  assert.equal(util.mantenimientoEstado({proximo_mantenimiento:'2026-10-13'},'2026-10-13'),'HOY');
  assert.equal(util.mantenimientoEstado({},'2026-10-13'),'SIN_FECHA');
  assert.equal(util.vincularCliente('Tike Tibas',clientes),1);
  assert.equal(util.vincularCliente('Via Flamingo',clientes),null);
});
test('valida fechas de mantenimiento y calcula la siguiente fecha al guardar',()=>{
  const body={estacion:'Tike Tibás',estado:'PENDIENTE',prioridad:'MEDIA',campos:{ultimo_mantenimiento:'2026-10-13',proximo_mantenimiento:'2026-10-14',calculo_proximo:'dias',frecuencia_dias:'90'}};
  assert.equal(util.validarRegistro(body,'mantenimientos').campos.proximo_mantenimiento,'2027-01-11');
  assert.throws(()=>util.validarRegistro({...body,campos:{ultimo_mantenimiento:'2026-02-30'}},'mantenimientos'),/Revise/);
  assert.throws(()=>util.validarRegistro({...body,campos:{ultimo_mantenimiento:'2026-10-13',proximo_mantenimiento:'2026-10-12'}},'mantenimientos'),/anterior/);
});
test('rechaza ediciones con una versión vieja sin modificar el registro',async()=>{
  const original=pool.getConnection;let rolledBack=false,writes=0;
  pool.getConnection=async()=>({beginTransaction:async()=>{},rollback:async()=>{rolledBack=true;},release(){},query:async sql=>{if(sql.startsWith('SELECT'))return [[{id:1,version:2}]];writes++;return [[]];}});
  try{await assert.rejects(guardarRegistro(1,{version:1},{id:34}),e=>e.status===409);assert.ok(rolledBack);assert.equal(writes,0);}finally{pool.getConnection=original;}
});
async function server(user,run){const app=express();app.set('views',path.join(__dirname,'../src/views'));app.set('view engine','ejs');app.use(express.urlencoded({extended:true}));app.use((req,res,next)=>{req.session={user};next();});app.use('/carburacion',routes);const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));try{await run(`http://127.0.0.1:${s.address().port}`);}finally{await new Promise(r=>s.close(r));}}
test('Estaciones solo se abre en Carburación y muestra siete áreas con filtros',async()=>{
  const original=pool.query;pool.query=async sql=>{assert.match(sql,/carburacion_/);if(sql.includes('COUNT(*)'))return [[{total:0}]];return [[]];};
  try{await server({id:34,nombre:'Emily',departamentoActivo:'CARBURACION',departamentos:['CARBURACION']},async base=>{
    const response=await fetch(`${base}/carburacion/estaciones?categoria=mantenimientos`);assert.equal(response.status,200);const html=await response.text();
    for(const c of util.CATEGORIAS)assert.ok(html.includes(c.nombre));assert.match(html,/Hoy y próximos 30 días/);assert.match(html,/Sin vincular/);assert.doesNotMatch(html,/\/taller\/|\/mantenimientos\/|PROVEEDURIA_TALLER/);
    const nuevo=await fetch(`${base}/carburacion/estaciones/nuevo?categoria=minae`);assert.equal(nuevo.status,200);assert.match(await nuevo.text(),/Respuesta a prevención/);
  });await server({id:2,departamentoActivo:'TALLER',departamentos:['TALLER']},async base=>{
    for(const route of ['estaciones','estaciones/1','estaciones/1/editar'])assert.equal((await fetch(`${base}/carburacion/${route}`)).status,403);
    assert.equal((await fetch(`${base}/carburacion/estaciones/1/editar`,{method:'POST'})).status,403);
  });}finally{pool.query=original;}
});
