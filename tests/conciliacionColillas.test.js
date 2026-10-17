const test=require('node:test');const assert=require('node:assert/strict');
const {conciliar}=require('../src/utils/conciliacionColillas');
const {construirResumenFinanciero}=require('../src/utils/resumenFinanciero');
test('referencias incompletas no se contabilizan aunque el importe coincida',()=>{const r=conciliar([{id:1,total_pagado:100,facturas_json:[{tipo:'independiente',monto_pago:100}]}]);assert.equal(r.alertas.length,1);assert.equal(r.totales.length,0);});
test('acceso departamental conserva el aislamiento de Taller y comparte solo conciliacion',()=>{
 const {puedeAbrirRutaPorDepartamento:puede}=require('../src/utils/departamentos');
 assert.equal(puede('CONTABILIDAD','/dashboard/conciliacion-pagos','CONTABILIDAD'),true);
 assert.equal(puede('OPERACIONES','/dashboard/conciliacion-pagos','ADMIN'),false);
});
test('consulta exige perfil financiero y usa el mes de fecha de pago, sin escrituras',async()=>{
 const express=require('express'),pool=require('../src/db'),router=require('../src/routes/conciliacionColillas.routes');
 const original=pool.query;const llamadas=[];
 pool.query=async(sql,params)=>{llamadas.push({sql,params});return [[]];};
 const app=express();app.use((req,res,next)=>{req.session={user:{rol:req.get('x-test-role')||'ADMIN'}};res.render=(_v,data)=>res.json(data);next();});app.use('/consulta',router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const base='http://127.0.0.1:'+server.address().port+'/consulta';
  assert.equal((await fetch(base,{headers:{'x-test-role':'MECANICO'}})).status,403);assert.equal(llamadas.length,0);
  assert.equal((await fetch(base+'?periodo=2026-99')).status,400);
  assert.equal((await fetch(base+'?periodo=2026-12')).status,200);
  assert.deepEqual(llamadas[0].params,['2026-12-01','2027-01-01']);
  assert.ok(llamadas.every(c=>c.sql.startsWith('SELECT')));
 }finally{pool.query=original;await new Promise(r=>server.close(r));}
});
test('motor pendiente no se cuenta como pagado',()=>{const r=construirResumenFinanciero({gastos:[{fuente:'ORDEN_MOTOR',monto:100,pagada:0},{fuente:'ORDEN_MOTOR',monto:200,pagada:1}]});assert.equal(r.totalOrdenesMotor,300);assert.equal(r.totalPagado,200);});
test('reparte pagos multiples sin sumar dos veces el total de la colilla',()=>{const r=conciliar([{id:1,total_pagado:300,facturas_json:[{tipo:'orden',factura_id:1,monto_pago:100},{tipo:'independiente',factura_id:2,monto_pago:200}]}],new Map([[1,'CRC']]));assert.equal(r.totales[0].monto,300);assert.equal(r.movimientos.length,2);assert.equal(r.alertas.length,0);});
test('no mezcla monedas ni adivina importes ausentes o lotes descuadrados',()=>{const r=conciliar([{id:1,total_pagado:200,facturas_json:[{tipo:'orden',factura_id:1,monto_pago:100},{tipo:'independiente',factura_id:2,monto_pago:100}]},{id:2,total_pagado:100,facturas_json:[{tipo:'orden',factura_id:1}]},{id:3,total_pagado:100,facturas_json:[{tipo:'independiente',factura_id:2,monto_pago:50}]}],new Map([[1,'USD']]));assert.equal(r.totales.length,0);assert.equal(r.alertas.length,3);});
test('abonos de varias fechas se suman como aplicaciones distintas sin duplicar facturas',()=>{const r=conciliar([{id:1,total_pagado:0.1,facturas_json:[{tipo:'independiente',factura_id:1,monto_pago:0.1}]},{id:2,total_pagado:0.2,facturas_json:[{tipo:'independiente',factura_id:1,monto_pago:0.2}]}]);assert.equal(r.totales[0].monto,0.3);});
