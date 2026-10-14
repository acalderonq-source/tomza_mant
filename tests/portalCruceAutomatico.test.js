const test=require('node:test'),assert=require('node:assert/strict');
const {candidatosUnicos,cruzarFactura,buscarCandidatos}=require('../src/utils/portalCruceAutomatico');
const datos=()=>({proveedor:'Caribe Tools',moneda:'CRC',pagos:[],factura:{estado:'PENDIENTE',total:2650,electronica:{emisor:'304400875',nombre_emisor:'Yendry Melissa Alvarado Quiros'}}});
test('cruce exacto descarta proveedor, moneda, monto y órdenes consumidas',()=>{
  const o={proveedor:'Caribe Tools',moneda:'CRC',total:2650};
  assert.equal(candidatosUnicos(datos(),[o]).length,1);
  for(const cambio of [{proveedor:'Otro'},{moneda:'USD'},{total:2651},{asignado:1},{factura_registrada:true},{cedula:'3101000000'}])assert.equal(candidatosUnicos(datos(),[{...o,...cambio}]).length,0);
});
function mock(ordenes){
  const writes=[];let commit=false;
  const db={beginTransaction:async()=>{},commit:async()=>{commit=true;},rollback:async()=>{},release(){},query:async(sql,args)=>{
    if(sql.includes("tipo='factura_portal'"))return [[{id:5,tipo:'factura_portal',datos:datos()}]];
    if(sql.includes("d.tipo='oc'"))return [ordenes];
    if(sql.includes('FROM ordenes_compra'))return [[]];
    if(sql.includes('GROUP BY'))return [[]];
    if(sql.includes("tipo='oc' FOR UPDATE"))return [[ordenes[0]]];
    if(sql.includes('SUM(v.monto)'))return [[{total:0}]];
    writes.push({sql,args});return [{affectedRows:1}];
  }};
  return {pool:{getConnection:async()=>db},writes,get commit(){return commit;}};
}
const orden=id=>({id,datos:{proveedor:'Caribe Tools',total:2650,moneda:'CRC'}});
test('una única coincidencia se enlaza y se audita sin aprobar ni pagar',async()=>{
  const m=mock([orden(7)]),r=await cruzarFactura(m.pool,5);
  assert.equal(r.estado,'ENLAZADA');assert.equal(r.orden.numero,'PR-7');assert.equal(r.orden.automatico,true);assert.equal(m.commit,true);
  assert.ok(m.writes.some(w=>w.sql.startsWith('INSERT INTO prov_portal_factura_orden')));
  assert.ok(m.writes.some(w=>w.sql.includes('prov_auditoria')));
  assert.ok(m.writes.every(w=>!w.sql.includes('cuenta_por_pagar')));
});
test('cero o varias coincidencias se identifican sin elegir una orden',async()=>{
  for(const [rows,estado] of [[[],'SIN_COINCIDENCIA'],[[orden(7),orden(8)],'VARIAS_COINCIDENCIAS']]){
    const m=mock(rows),r=await cruzarFactura(m.pool,5);assert.equal(r.estado,estado);assert.equal(r.orden,null);assert.ok(!m.writes.some(w=>w.sql.startsWith('INSERT INTO prov_portal_factura_orden')));
  }
});
test('un listado truncado no autoriza un enlace automático',async()=>{
  const m=mock(Array.from({length:201},(_,i)=>orden(i+1))),r=await cruzarFactura(m.pool,5);assert.equal(r.estado,'REQUIERE_REVISION');assert.equal(r.orden,null);
});
test('coincidencias entre ambos módulos conservan la ambigüedad',async()=>{
  const db={query:async sql=>sql.includes("d.tipo='oc'")?[[orden(7)]]:sql.includes('FROM ordenes_compra')?[[{id:9,po_numero:'2026-200',nombre:'Caribe Tools',total:2650,moneda:'CRC'}]]:[[]]};
  const r=await buscarCandidatos(db,datos());assert.equal(r.candidatos.length,2);assert.deepEqual(r.candidatos.map(o=>o.origen),['PROVEEDURIA','COMPRAS']);
});
test('el cruce no cambia una factura que ya está enlazada o pagada',async()=>{
  for(const cambios of [{orden_compra:{id:8,origen:'COMPRAS'}},{pagos:[{monto:1}]}]){
    let writes=0;
    const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async sql=>{if(!sql.startsWith('SELECT'))writes++;return [[{id:5,datos:{...datos(),...cambios}}]];}};
    assert.equal((await cruzarFactura({getConnection:async()=>db},5)).estado,'SIN_CAMBIOS');assert.equal(writes,0);
  }
});
