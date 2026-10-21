const test=require('node:test'),assert=require('node:assert/strict');
const aprobacion=require('../src/utils/portalAprobacionContable');
const asientos=require('../src/utils/portalAsientos');
const linea={codigo:'A',descripcion:'Artículo A',cantidad:1,precio_unitario:100,subtotal:100,iva:13};
function escenario(){
  let row={id:11,tipo:'factura_portal',datos:{proveedor:'Proveedor',moneda:'CRC',razon_social:'GAS TOMZA',pagos:[],orden_compra:{origen:'PROVEEDURIA',id:2,numero:'PR-2'},factura:{numero:'F-11',total:113,estado:'PENDIENTE',subida_en:'2026-10-16',electronica:{clave:'506111',consecutivo:'F-11',fecha:'2026-10-16T10:00:00-06:00',emisor:'3101234567',nombre_emisor:'Proveedor',receptor:'3101349880',nombre_receptor:'GAS TOMZA',lineas:[{...linea}],hacienda:{estado:'ACEPTADA',ambiente:'produccion'}}}}};
  const orden={estado:'APROBADA',proveedor:'Proveedor',proveedor_cedula:'3101234567',moneda:'CRC',total:113,razon_social:'GAS TOMZA',lineas:[{...linea}]},writes=[];
  const db={async query(sql,params){
    if(sql.startsWith('SELECT * FROM prov_documentos'))return [[structuredClone(row)]];
    if(sql.startsWith('SELECT datos FROM prov_documentos'))return [[{datos:structuredClone(orden)}]];
    if(sql.includes('FROM prov_portal_factura_orden'))return [[]];
    if(sql.includes('JSON_UNQUOTE'))return [[{total:orden.total}]];
    writes.push({sql,params});if(sql.startsWith('UPDATE prov_documentos'))row.datos=JSON.parse(params[0]);return [{affectedRows:1}];
  }};
  return {db,writes,orden,get row(){return row;}};
}
test('aceptar desde cuentas por pagar usa la aprobación original y habilita Asientos una sola vez',async()=>{
  const e=escenario();assert.equal(asientos.convertir(e.row),null);
  await assert.rejects(asientos.obtener(e.db,{ids:[11]},true),/todavía no está aprobada/);
  const version=aprobacion.version(e.row.datos.factura);
  assert.equal(await aprobacion.aprobar(e.db,11,17,version),true);
  assert.equal(e.row.datos.factura.estado,'CONCILIADA');assert.equal(e.row.datos.factura.cuenta_por_pagar,true);
  const facturas=await asientos.obtener(e.db,{ids:[11]},true);
  assert.equal(facturas.length,1);assert.equal(facturas[0].tipo,'portal');assert.equal(facturas[0].monto_original,113);assert.equal(facturas[0].empresa_destino,'GAS TOMZA');
  assert.equal(await aprobacion.aprobar(e.db,11,17,version),false);
  assert.equal(e.writes.filter(w=>w.sql.includes('INSERT INTO prov_auditoria')).length,1);assert.equal(e.row.datos.eventos.length,1);
});
test('Hacienda rechazada, diferencias de precio o versión obsoleta no aprueban ni habilitan Asientos',async()=>{
  for(const tipo of ['hacienda','precio','version']){
    const e=escenario();if(tipo==='hacienda')e.row.datos.factura.electronica.hacienda.estado='RECHAZADA';if(tipo==='precio')e.orden.lineas[0].precio_unitario=99;
    await assert.rejects(aprobacion.aprobar(e.db,11,17,tipo==='version'?'obsoleta':aprobacion.version(e.row.datos.factura)));
    assert.equal(e.writes.length,0);assert.equal(asientos.convertir(e.row),null);
  }
});
test('asientos utiliza total neto y no saldo pagado, con notas de crédito y monedas sin mezclar',async()=>{
  const e=escenario();await aprobacion.aprobar(e.db,11,17,aprobacion.version(e.row.datos.factura));
  e.row.datos.pagos=[{monto:20}];e.row.datos.notas_credito=[{total:10,aplicada:true},{total:30,aplicada:false}];
  const f=asientos.convertir(e.row);assert.equal(f.monto_original,113);assert.equal(f.nota_credito_monto,10);assert.equal(f.moneda,'CRC');
  assert.equal((await asientos.obtener(e.db,{fecha_desde:'2026-11-01'})).length,0);
  assert.equal((await asientos.obtener(e.db,{proveedor_nombre:'Otro'})).length,0);
});
