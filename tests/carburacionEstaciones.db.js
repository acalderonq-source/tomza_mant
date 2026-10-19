// Validación optativa en tablas aisladas; no modifica registros reales.
// $env:CARBURACION_DB_TEST='1'; node --test tests/carburacionEstaciones.db.js
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const express=require('express');
const pool=require('../src/db');
test('importa las siete hojas sin duplicar ni perder datos y permite actualizar con historial',{skip:process.env.CARBURACION_DB_TEST!=='1',timeout:120000},async()=>{
  const originalQuery=pool.query,originalConnection=pool.getConnection;
  const suffix=crypto.randomBytes(5).toString('hex');
  const names=['carburacion_proveedores','carburacion_clientes','carburacion_ordenes','carburacion_estaciones_registros','carburacion_estaciones_proveedores','carburacion_estaciones_historial'];
  const mapping=Object.fromEntries(names.map(n=>[n,`it_${suffix}_${n}`]));
  const rewrite=sql=>sql.replace(/\bcarburacion_[a-z_]+\b/g,n=>{if(!mapping[n])throw Error(`Consulta fuera de Estaciones: ${n}`);return mapping[n];}).replace(/\bfk_carburacion_orden_cliente\b/g,`fk_it_${suffix}_cliente`);
  const query=(sql,args)=>originalQuery.call(pool,rewrite(sql),args);
  let listener;
  try {
    for(const file of ['202610130001_carburacion_ordenes.sql','202610130003_carburacion_clientes.sql','202610130007_carburacion_ordenes_cotizacion_eliminar.sql','202610130005_carburacion_estaciones.sql'])for(const sql of fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8').split(';').map(s=>s.trim()).filter(Boolean))await query(sql);
    await query("INSERT INTO carburacion_proveedores (id,nombre,creado_por) VALUES (1,'Tecno Analitica S.A.',34),(2,'Ingnova Soluciones Integrales S.A.',34)");
    const clientes=require('../src/data/carburacion_clientes.json').clientes;
    await query('INSERT INTO carburacion_clientes (nombre,creado_por) VALUES ?',[clientes.map(c=>[c.nombre,34])]);
    pool.query=query;
    pool.getConnection=async()=>{
      const c=await originalConnection.call(pool);const q=c.query,release=c.release.bind(c);
      c.query=(sql,args)=>sql.includes('usuario_cedulas')?Promise.resolve([[{id:34}]]):q.call(c,rewrite(sql),args);
      c.release=()=>{c.query=q;c.release=release;release();};return c;
    };
    const {importarEstaciones}=require('../src/scripts/importarEstacionesCarburacion');
    const source=require('../src/data/carburacion_estaciones.json');
    const primero=await importarEstaciones(source);assert.equal(primero.insertados,195);assert.equal(primero.filasSinEstacion,30);
    const segundo=await importarEstaciones(source);assert.equal(segundo.insertados,0);
    const [[hist]]=await query('SELECT COUNT(*) cantidad FROM carburacion_estaciones_historial');assert.equal(hist.cantidad,195);
    const [[dup]]=await query("SELECT COUNT(*) cantidad FROM carburacion_estaciones_registros WHERE categoria='mejoras' AND estacion='Bomba Orotina'");assert.equal(dup.cantidad,2);
    const [[sin]]=await query("SELECT cliente_id FROM carburacion_estaciones_registros WHERE categoria='seguimiento' AND estacion='Via Flamingo' LIMIT 1");assert.equal(sin.cliente_id,null);
    const [[manual]]=await query("SELECT campos_json FROM carburacion_estaciones_registros WHERE categoria='mantenimientos' AND estacion='Servicentro Chamú'");
    const {parseJSON}=require('../src/utils/carburacionEstaciones');assert.equal(parseJSON(manual.campos_json).proximo_mantenimiento,'2026-11-06');
    const [[record]]=await query("SELECT * FROM carburacion_estaciones_registros WHERE categoria='mantenimientos' AND estacion='Tike Tibás'");
    const {guardarRegistro}=require('../src/utils/carburacionEstacionesStore');
    const body={version:record.version,estacion:record.estacion,cliente_id:record.cliente_id,prioridad:'ALTA',estado:'EN_PROCESO',ejecutivo:'Emily',detalle:'Mantenimiento registrado en prueba',proveedor_ids:['1'],campos:{ultimo_mantenimiento:'2026-10-13',calculo_proximo:'dias',frecuencia_dias:'90'},motivo:'Avance de prueba'};
    await guardarRegistro(record.id,body,{id:34,nombre:'Emily de prueba'});
    const [[updated]]=await query('SELECT version,campos_json,origen_json FROM carburacion_estaciones_registros WHERE id=?',[record.id]);assert.equal(updated.version,2);assert.equal(parseJSON(updated.campos_json).proximo_mantenimiento,'2027-01-11');assert.ok(updated.origen_json);
    await assert.rejects(guardarRegistro(record.id,body,{id:34}),e=>e.status===409);
    const [[changes]]=await query('SELECT COUNT(*) cantidad FROM carburacion_estaciones_historial WHERE registro_id=?',[record.id]);assert.equal(changes.cantidad,2);
    const [[sourceCopy]]=await query('SELECT origen_json FROM carburacion_estaciones_registros WHERE id=?',[record.id]);assert.deepEqual(parseJSON(sourceCopy.origen_json).valores,source.registros.find(r=>r.categoria==='mantenimientos' && r.estacion==='Tike Tibás').valores);
    const app=express();app.set('views',path.join(__dirname,'../src/views'));app.set('view engine','ejs');app.use(express.urlencoded({extended:true}));app.use((req,res,next)=>{req.session={user:{id:34,nombre:'Emily',departamentoActivo:'CARBURACION',departamentos:['CARBURACION']}};next();});app.use('/carburacion',require('../src/routes/carburacion.routes'));
    listener=app.listen(0,'127.0.0.1');await new Promise(resolve=>listener.once('listening',resolve));const base=`http://127.0.0.1:${listener.address().port}`;
    for(const categoria of ['seguimiento','construccion','minae','municipal','pendiente','mantenimientos']) {
      const response=await fetch(`${base}/carburacion/estaciones?categoria=${categoria}`);assert.equal(response.status,200,categoria);assert.match(await response.text(),/Nuevo registro/);
    }
    const [[archivado]]=await query("SELECT id FROM carburacion_estaciones_registros WHERE categoria='mejoras' LIMIT 1");
    for(const route of [`estaciones/${archivado.id}`,`estaciones/${archivado.id}/editar`])assert.equal((await fetch(`${base}/carburacion/${route}`)).status,404);
    for(const route of [`estaciones/${record.id}`,`estaciones/${record.id}/editar`,'estaciones/nuevo?categoria=minae','estaciones?categoria=mantenimientos&mantenimiento=vencidos','estaciones?categoria=seguimiento&proveedor_id=1&prioridad=ALTA'])assert.equal((await fetch(`${base}/carburacion/${route}`)).status,200,route);
    const detalle=await fetch(`${base}/carburacion/estaciones/${record.id}`);assert.match(await detalle.text(),/Avance de prueba/);
  } finally {
    if(listener)await new Promise(resolve=>listener.close(resolve));
    pool.query=originalQuery;pool.getConnection=originalConnection;
    for(const name of [...names].reverse())await originalQuery.call(pool,`DROP TABLE IF EXISTS \`${mapping[name]}\``);
    await pool.end();
  }
});
