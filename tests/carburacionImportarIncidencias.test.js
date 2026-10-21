const test=require('node:test');const assert=require('node:assert/strict');
const {fechaOrigen,estadoOrigen,prepararFila,importarIncidencias}=require('../src/scripts/importarIncidenciasCarburacion');const pool=require('../src/db');
test('incidencias importadas conservan fecha y solución y reconocen estados explícitos',()=>{
 assert.equal(fechaOrigen('07/082025'),'2025-08-07');assert.equal(fechaOrigen('2025-09-25T15:40:00'),'2025-09-25');assert.throws(()=>fechaOrigen('31/02/2025'));
 assert.equal(estadoOrigen('servicio restablecido'),'RESUELTA');assert.equal(estadoOrigen('serivcio restablecido'),'RESUELTA');assert.equal(estadoOrigen('pendiente'),'ABIERTA');assert.equal(estadoOrigen('NO INDICA'),'ABIERTA');assert.equal(estadoOrigen('Se va a cambiar el motor'),'EN_SEGUIMIENTO');
 const row=prepararFila({archivo:'Reporte.xlsx',hoja:'Reporte'},{fila:2,cliente_id:1,valores:['2025-06-08','09:42','Estación','Fuga','Servicio restablecido','JUNIO','Nota original']});
 assert.match(row.descripcion,/09:42/);assert.match(row.descripcion,/Nota original/);assert.match(row.descripcion,/fila: 2/);assert.equal(row.estado,'RESUELTA');
});
test('reimportar no duplica y un conflicto de cliente no modifica la incidencia',async()=>{
 const original=pool.getConnection;let inserted=[],existing=[];
 pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql,args)=>{
  if(sql.includes('FROM carburacion_clientes'))return [[{id:1}]];
  if(sql.startsWith('SELECT'))return [existing];
  inserted.push(...args[0]);return [{affectedRows:args[0].length}];
 }});
 try{
  const source={archivo:'Reporte.xlsx',hoja:'Reporte',filas:[{fila:2,cliente_id:1,valores:['2025-06-08','09:42','Estación','Fuga','pendiente','JUNIO']}]};
  const primero=await importarIncidencias(source,{id:1});assert.equal(primero.insertadas,1);
  existing=[{id:1,cliente_id:1,descripcion:inserted[0][2]}];inserted=[];
  assert.equal((await importarIncidencias(source,{id:1})).existentes,1);assert.equal(inserted.length,0);
  existing[0].cliente_id=2;assert.deepEqual((await importarIncidencias(source,{id:1})).conflictos,[2]);assert.equal(inserted.length,0);
 }finally{pool.getConnection=original;}
});
test('corrige únicamente fechas aprobadas y conserva el estado de atención',async()=>{
 const original=pool.getConnection;let actualizacion;
 const source={archivo:'Reporte.xlsx',hoja:'Reporte',filas:[{fila:736,cliente_id:1,valores:['1900-01-28','12:00','Estación','Fuga','servicio restablecido','Mayo']}]};
 const anterior=prepararFila(source,source.filas[0]);source.correcciones_fecha_aprobadas={736:'2026-05-28'};
 pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql,args)=>{
  if(sql.includes('FROM carburacion_clientes'))return [[{id:1}]];
  if(sql.startsWith('SELECT'))return [[{id:8,cliente_id:1,descripcion:anterior.descripcion}]];
  assert.match(sql,/UPDATE carburacion_cliente_incidencias SET fecha=/);assert.doesNotMatch(sql,/estado=/);actualizacion=args;return [{affectedRows:1}];
 }});
 try{const r=await importarIncidencias(source,{id:1});assert.equal(r.corregidas,1);assert.equal(actualizacion[0],'2026-05-28');assert.match(actualizacion[1],/1900-01-28/);assert.match(actualizacion[1],/Fecha corregida con confirmación: 2026-05-28/);}finally{pool.getConnection=original;}
});
