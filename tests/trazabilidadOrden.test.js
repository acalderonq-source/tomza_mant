const test=require('node:test');
const assert=require('node:assert/strict');
const {cargarTrazabilidadOrden}=require('../src/utils/trazabilidadOrden');
test('fecha documental sin hora no retrocede un dia por zona horaria',async()=>{
 const html=await require('ejs').renderFile(require('node:path').join(__dirname,'../src/views/compras/trazabilidad_orden.ejs'),{
  orden:{id:5,po_numero:'OC5',moneda:'CRC'},
  trazabilidad:{financiero:true,recibida:false,facturada:false,advertencias:[],asientos:[],pagos:[{id:1,numero:'CP1',fecha:'2026-10-17',tipo:'abono',monto:100}]}
 });
 assert.match(html,/17\/10\/2026/);assert.doesNotMatch(html,/16\/10\/2026/);
});
test('bodeguero consulta recepcion sin acceso a informacion financiera relacionada',async()=>{
 const r=await cargarTrazabilidadOrden({query(){throw Error('No debe consultar finanzas');}},{id:1,factura:'123',facturada:1,factura_producto_recibido:0},{rol:'BODEGUERO'});
 assert.equal(r.financiero,false);assert.equal(r.recibida,false);assert.equal(r.facturada,true);
});
test('colilla multiple usa solo el monto aplicado a esta orden, no el total del lote',async()=>{
 const r=await cargarTrazabilidadOrden({async query(sql,params){
  if(sql.includes('colillas_pago')){assert.deepEqual(JSON.parse(params[0]),{tipo:'orden',factura_id:5});return [[{id:7,recibo_numero:'CP1',tipo_pago:'abono',facturas_json:JSON.stringify([{tipo:'orden',factura_id:5,monto_pago:100},{tipo:'orden',factura_id:6,monto_pago:900}])}]];}
  assert.equal(params[0],5);return [[{lote_id:4}]];
 }},{id:5},{rol:'CONTABILIDAD'});
 assert.equal(r.pagos[0].monto,100);assert.equal(r.asientos[0].lote_id,4);
});
test('un historial no disponible no se presenta como ausencia de pagos',async()=>{
 const r=await cargarTrazabilidadOrden({async query(){throw Object.assign(Error('sin tabla'),{code:'ER_NO_SUCH_TABLE'});}},{id:5},{rol:'ADMIN'});
 assert.equal(r.advertencias.length,2);
});
