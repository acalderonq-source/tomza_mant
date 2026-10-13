const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const pool = require('../src/db');
const routes = require('../src/routes/carburacion.routes');
async function server(user, run) {
  const app = express();
  app.set('views',path.join(__dirname,'../src/views'));
  app.set('view engine','ejs');
  app.use(express.urlencoded({extended:true}));
  app.use((req,res,next) => { req.session={user}; next(); });
  app.use('/carburacion',routes);
  const listener = app.listen(0,'127.0.0.1');
  await new Promise(resolve => listener.once('listening',resolve));
  try { await run(`http://127.0.0.1:${listener.address().port}`); }
  finally { await new Promise(resolve => listener.close(resolve)); }
}
const user={id:34,departamentoActivo:'CARBURACION',departamentos:['CARBURACION'],rol:'PROVEEDURIA_TALLER'};

test('elimina órdenes sin factura y conserva las facturadas',async()=>{
  const original=pool.getConnection;let facturada=false,eliminada=false,committed=false;
  pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{},release(){},query:async(sql,args)=>{
    if(sql.startsWith('SELECT id FROM carburacion_ordenes')){assert.match(sql,/eliminado_en IS NULL FOR UPDATE/);return [[{id:7}]];}
    if(sql.startsWith('SELECT id FROM carburacion_facturas'))return [facturada?[{id:8}]:[]];
    assert.match(sql,/SET eliminado_en=CURRENT_TIMESTAMP,eliminado_por=/);assert.deepEqual(args,[34,7]);eliminada=true;return [{affectedRows:1}];
  }});
  try{await server(user,async base=>{
    const url=base+'/carburacion/ordenes/7/eliminar';
    assert.equal((await fetch(url,{method:'POST',redirect:'manual'})).status,302);assert.ok(eliminada&&committed);
    facturada=true;eliminada=false;committed=false;
    assert.equal((await fetch(url,{method:'POST'})).status,409);assert.equal(eliminada,false);assert.equal(committed,false);
    assert.equal((await fetch(base+'/carburacion/ordenes/abc/eliminar',{method:'POST'})).status,404);
  });}finally{pool.getConnection=original;}
});

test('rechaza un número de cotización demasiado largo',async()=>{
  await server(user,async base=>assert.equal((await fetch(base+'/carburacion/ordenes',{method:'POST',body:new URLSearchParams({numero_cotizacion:'X'.repeat(101)})})).status,400));
});
test('dashboard muestra sus indicadores, mantiene las monedas separadas y no consulta Taller',async () => {
  const original=pool.query;
  pool.query=async sql => {
    assert.match(sql,/carburacion_/);
    assert.doesNotMatch(sql,/\b(?:ordenes_compra|proveedores|mantenimientos|usuarios_sedes)\b/);
    if(sql.includes("estado='BORRADOR'")) return [[{total:3,mes:2,borradores:3}]];
    if(sql.includes('COUNT(*)')) return [[{total:2}]];
    if(sql.includes('GROUP BY moneda')) return [[{moneda:'CRC',total:1000},{moneda:'USD',total:20}]];
    return [[{id:1,po_numero:'CAR-000001',fecha:'2026-10-13T12:00:00Z',moneda:'CRC',total:1000,estado:'BORRADOR',proveedor:'Tecno Analitica S.A.'}]];
  };
  try { await server(user,async base => {
    const response=await fetch(`${base}/carburacion/dashboard`);
    const html=await response.text();
    assert.equal(response.status,200);
    for(const text of ['Órdenes registradas','Proveedores','CAR-000001','CRC','USD','Tecno Analitica']) assert.ok(html.includes(text));
    assert.doesNotMatch(html,/Taller|PROVEEDURIA_TALLER|Mantenimientos|Cambiar sede|\/compras\//);
    assert.match(html,/href="\/carburacion\/ordenes\/nueva"/);
    for (const formato of ['navbar navbar-dark topbar', 'container-fluid shell py-3', 'simple-hero mb-2', 'summary-grid mb-2', 'module-grid', 'module-icon icon-blue']) assert.ok(html.includes(formato));
    const estilos = require('node:fs').readFileSync(path.join(__dirname, '../src/views/partials/dashboard_styles.ejs'), 'utf8').trim();
    assert.ok(html.includes(estilos), 'Carburación debe usar los mismos estilos compartidos que Taller');
    assert.doesNotMatch(html, /carburacion-dashboard\.css|carb-hero|carb-module/);
  }); } finally {pool.query=original;}
});
test('dashboard vacío permite crear la primera orden',async () => {
  const original=pool.query;
  pool.query=async sql => sql.includes('COUNT(*)') ? [[{total:0,mes:0,borradores:0}]] : [[]];
  try { await server(user,async base => {
    const response=await fetch(`${base}/carburacion/dashboard`);
    assert.equal(response.status,200);
    assert.match(await response.text(),/Crear la primera orden/);
  }); } finally {pool.query=original;}
});
test('el formulario usa únicamente proveedores de Carburación y conserva el formato de órdenes',async () => {
  const original=pool.query;
  pool.query=async sql => {
    if(sql.includes('carburacion_clientes'))return [[{id:4,nombre:'Tike Tibás'}]];
    assert.match(sql,/FROM carburacion_proveedores/); return [[{id:7,nombre:'Proveedor exclusivo'}]];
  };
  try { await server(user,async base => {
    const response=await fetch(`${base}/carburacion/ordenes/nueva`);
    const html=await response.text();
    assert.equal(response.status,200);
    assert.match(html,/Proveedor exclusivo/);
    assert.match(html,/name="numero_cotizacion"/);
    assert.match(html,/Tike Tibás/);
    assert.match(html,/select name="cliente_id"/);
    assert.match(html,/action="\/carburacion\/ordenes"/);
    assert.match(html,/Detalle de productos\/servicios/);
    assert.doesNotMatch(html,/GENERAL TALLER|Correctivo|Preventivo|src="\/js\/placa-search/);
  }); } finally { pool.query=original; }
});
test('Taller no accede a órdenes ni proveedores de Carburación',async () => {
  await server({...user,departamentoActivo:'TALLER'},async base => {
    for(const route of ['dashboard','ordenes','proveedores','clientes','ordenes/1/pdf']) assert.equal((await fetch(`${base}/carburacion/${route}`)).status,403);
  });
});
test('guarda la orden en una transacción, recalcula el total y genera un consecutivo propio',async () => {
  const original=pool.getConnection;
  const writes=[];
  let committed=false;
  pool.getConnection=async () => ({
    beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{},release(){},
    query:async(sql,params)=>{ writes.push({sql,params}); if(sql.includes('carburacion_clientes'))return [[{id:4,nombre:'Tike Tibás'}]]; if(sql.startsWith('SELECT')) return [[{id:7}]]; return [{insertId:12,affectedRows:1}]; }
  });
  try { await server(user,async base => {
    const response=await fetch(`${base}/carburacion/ordenes`,{method:'POST',redirect:'manual',body:new URLSearchParams({numero_cotizacion:' COT-2026-18 ',proveedor_id:'7',cliente_id:'4',moneda:'CRC',empresa_destino:'GAS TOMZA','lineas[0][descripcion]':'Producto','lineas[0][cantidad]':'2','lineas[0][precio_unitario]':'100',total:'1'})});
    assert.equal(response.status,302);
    assert.ok(committed);
    const insert=writes.find(w=>w.sql.startsWith('INSERT INTO carburacion_ordenes'));
    assert.equal(insert.params[9],226);
    assert.equal(insert.params[4],'Tike Tibás');
    assert.equal(insert.params[14],4);
    assert.deepEqual(writes.find(w=>w.sql.startsWith('UPDATE carburacion_ordenes SET numero_cotizacion')).params,['COT-2026-18',12]);
    assert.equal(JSON.parse(insert.params[11])[0].codigo,'Tike Tibás');
    assert.equal(writes.find(w=>w.sql.startsWith('UPDATE carburacion_ordenes SET po_numero')).params[0],'CAR-000012');
    writes.forEach(w=>assert.match(w.sql,/carburacion_/));
  }); } finally {pool.getConnection=original;}
});
