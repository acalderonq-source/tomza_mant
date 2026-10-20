const test=require('node:test'),assert=require('node:assert/strict'),ejs=require('ejs'),path=require('node:path');
const {resumenEstadoCuenta,datosFacturaEstado}=require('../src/utils/proveeduriaEstadoCuenta');
const {saldo}=require('../src/utils/proveeduria');
const {aprobable}=require('../src/utils/proveedorHacienda');
const {seguimiento}=require('../src/utils/portalSeguimiento');
const {excepciones}=require('../src/utils/portalControlFactura');
const fuente={proveedor:'TECNOANALITICA INTERNACIONAL S.A. ($)',receptor:'GAS TOMZA DE COSTA RICA S.A.',moneda:'USD',fecha_corte:'2026-10-05',sha256:'a'.repeat(64),cliente_codigo:'00507',saldo_reportado:260.05,facturas:[{fila:20,numero:'12345',consecutivo:'00100001010000012345',fecha:'2026-09-01',vence:'2026-09-30',monto:100.05,saldo:40.05,detalle:'Servicio descrito en el estado'},{fila:21,numero:'12346',consecutivo:'00100001010000012346',fecha:'2026-09-02',vence:'2026-10-01',monto:200,saldo:200,detalle:'Otro servicio'}]};
const crear=()=>datosFacturaEstado(fuente,fuente.facturas[0],99,{id:55,nombre:'Estado de cuenta.xls',mime:'application/vnd.ms-excel'});
test('importación distingue importe original, saldo al corte y diferencia del resumen sin inventar pagos',()=>{
  assert.deepEqual(resumenEstadoCuenta(fuente),{facturas:2,total_facturas:300.05,saldo_detallado:240.05,saldo_resumen:260.05,diferencia:20,aplicaciones_anteriores:60});
  const d=crear();assert.equal(d.factura.numero,'12345');assert.equal(d.factura.electronica.consecutivo,'00100001010000012345');assert.equal(d.factura.fecha_vencimiento,'2026-09-30');assert.equal(d.proveedor,'TECNOANALITICA INTERNACIONAL S.A.');
  assert.equal(d.pagos.length,0);assert.equal(d.notas_credito.length,0);assert.equal(d.factura.estado,'PENDIENTE');assert.equal(d.factura.cuenta_por_pagar,undefined);assert.equal(d.factura.archivo,undefined);assert.equal(d.factura.electronica.archivo,undefined);assert.equal(d.factura.electronica.clave,'');assert.throws(()=>aprobable(d.factura));
  assert.deepEqual(saldo(d),{facturado:100.05,pagos:0,creditos:0,aplicaciones_anteriores:60,saldo:40.05});
  d.pagos.push({monto:10});assert.equal(saldo(d).saldo,30.05);assert.equal(saldo(d).pagos,10);assert.equal(seguimiento(d).estado,'Pendiente de Hacienda');
  assert.equal(saldo({facturas_vinculadas:[d]}).saldo,30.05);
});
test('rechaza repetidas, identificadores incompletos y saldos o fechas inconsistentes',()=>{
  for(const extra of [{consecutivo:'123'},{saldo:-1},{saldo:101},{monto:NaN},{fecha:'texto'},{vence:'2025-01-01'}])assert.throws(()=>resumenEstadoCuenta({...fuente,facturas:[{...fuente.facturas[0],...extra}]}));
  assert.throws(()=>resumenEstadoCuenta({...fuente,facturas:[fuente.facturas[0],fuente.facturas[0]]}));
  assert.throws(()=>saldo({...crear(),importacion_estado_cuenta:{tipo:'ESTADO_CUENTA',aplicaciones_anteriores:-1}}));
});
test('listas de Proveeduría y portal muestran facturas sin OC, origen, saldo y adjunto real sin links a XML/PDF inexistentes',async()=>{
  const d=crear();d.control={diferencias:['Sin OC']};const row={id:10,tipo:'factura_portal',sede:'Cartago',datos:d};
  const lista=await ejs.renderFile(path.join(__dirname,'../src/views/proveeduria/facturas_sin_orden.ejs'),{docs:[row],saldo});
  assert.match(lista,/12345/);assert.match(lista,/00100001010000012345/);assert.match(lista,/diferencia sin detalle/);assert.match(lista,/Servicio descrito/);assert.match(lista,/facturas\/10\/archivo\/estado/);
  const portal=await ejs.renderFile(path.join(__dirname,'../src/views/portal_proveedores/tabla.ejs'),{docs:[row],saldo,seguimiento,excepciones,interno:true,puedeContabilidad:true});
  assert.match(portal,/Estado de cuenta original/);assert.match(portal,/XML\/PDF pendientes/);assert.match(portal,/Aplicaciones anteriores/);assert.doesNotMatch(portal,/href="[^"]*\/archivo\/(?:pdf|xml)"/);assert.match(portal,/disabled>Consultar Hacienda/);
});
module.exports={fuente};
