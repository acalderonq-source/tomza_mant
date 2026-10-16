const test=require('node:test'),assert=require('node:assert/strict');
const {facturasPendientesTaller,presentarFactura,proveedoresTaller}=require('../src/utils/portalFacturasTaller');
const orden={id:20,tipo:'orden',proveedor_id:16,proveedor_nombre:'Repuestos y Servicios Técnicos JM',numero_factura:'F-100',po_numero:'2026-500',fecha:'2026-09-10',vence:'2026-10-10',empresa_destino:'SUPER GAS',moneda:'CRC',monto:113000,nota_credito_monto:13000,abono_monto:25000};
test('conserva factura, orden, moneda, abonos y notas sin crear documentos fiscales o aprobaciones',()=>{
  const f=presentarFactura(orden,true);assert.equal(f.saldo,75000);assert.equal(f.empresa,'SUPER GAS');assert.equal(f.orden,'2026-500');assert.equal(f.url,'/compras/ordenes/20/detalle');assert.equal(f.electronica,undefined);assert.equal(f.cuenta_por_pagar,undefined);
  assert.equal(presentarFactura(orden).url,undefined);
});
test('consulta solo pendientes con saldo y excluye facturas ya enlazadas o con clave registrada',async()=>{
  const queries=[],db={query:async(sql,args)=>{queries.push({sql,args});return sql.includes('FROM ordenes_compra o')?[[orden]]:[[{...orden,tipo:'independiente',id:30,proveedor_id:14,empresa_destino:null,moneda:'USD',monto:100,nota_credito_monto:0,abono_monto:20}]];}};
  const r=await facturasPendientesTaller(db,{interno:true});assert.equal(r.resumen.CRC,75000);assert.equal(r.resumen.USD,80);assert.equal(r.facturas.length,2);assert.equal(r.facturas.find(f=>f.tipo==='independiente').empresa,'Por confirmar');
  assert.ok(queries.every(q=>q.sql.includes('COALESCE')&&q.sql.includes('pagada,0)=0')&&q.sql.includes('NOT EXISTS')));assert.match(queries[0].sql,/prov_portal_factura_orden/);
  assert.ok(queries.every(q=>!/^\s*(INSERT|UPDATE|DELETE)/i.test(q.sql)));assert.equal(r.proveedores.length,14);
});
test('portal externo filtra por cédula fiscal exacta en ambas fuentes y no expone enlaces internos',async()=>{
  const queries=[],db={query:async(sql,args)=>{queries.push({sql,args});return sql.includes('FROM ordenes_compra o')?[[orden]]:[[]];}};
  const r=await facturasPendientesTaller(db,{cedula:'3-101-123456'});
  assert.ok(queries.every(q=>q.args[1]==='3101123456'&&q.sql.includes('p.cedula_juridica')));assert.ok(r.facturas.every(f=>!f.url));assert.deepEqual(r.proveedores,[proveedoresTaller.find(p=>p.id===16)]);
});
test('sin identidad fiscal no consulta ni devuelve proveedores o facturas de Taller',async()=>{
  const db={query:async()=>{throw Error('No debe consultar');}};for(const cedula of ['',null,'123'])assert.deepEqual(await facturasPendientesTaller(db,{cedula}),{facturas:[],proveedores:[],resumen:{pendientes:0,CRC:0,USD:0}});
});
test('si la factura se paga en Taller desaparece de la siguiente consulta sin conservar saldo duplicado',async()=>{
  let pagada=false;const db={query:async sql=>sql.includes('FROM ordenes_compra o')?[pagada?[]:[orden]]:[[]]};assert.equal((await facturasPendientesTaller(db,{interno:true})).resumen.pendientes,1);pagada=true;assert.equal((await facturasPendientesTaller(db,{interno:true})).resumen.pendientes,0);
});
