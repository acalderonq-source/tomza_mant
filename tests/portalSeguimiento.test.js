const test=require('node:test'),assert=require('node:assert/strict');
const {seguimiento,responderCorreccion}=require('../src/utils/portalSeguimiento');
const {validarCorrespondencia}=require('../src/utils/portalFacturaOrden');
const {ordenesDisponibles}=require('../src/utils/portalOrdenesDisponibles');
const datos=()=>({proveedor:'Maxi',moneda:'CRC',pagos:[],factura:{estado:'PENDIENTE',total:113,fecha_vencimiento:'2026-10-16',electronica:{emisor:'3101000000',nombre_receptor:'GAS TOMZA DE COSTA RICA SOCIEDAD ANONIMA',hacienda:{estado:'ACEPTADA'}}}});
test('prioridades usan el día de Costa Rica, no UTC, y excluyen facturas pagadas',()=>{
  const d=datos();d.factura.fecha_vencimiento='2026-10-14';d.gestion={fecha_limite:'2026-10-14'};
  assert.equal(seguimiento(d,new Date('2026-10-15T01:00:00Z')).vencida,false);
  assert.equal(seguimiento(d,new Date('2026-10-15T07:00:00Z')).prioridad,0);
  d.factura.cuenta_por_pagar=true;d.pagos=[{monto:113}];
  const s=seguimiento(d,new Date('2026-10-15T07:00:00Z'));assert.equal(s.estado,'Pagada');assert.equal(s.vencida,false);assert.equal(s.atrasada,false);
});
test('responder conserva el comprobante y el motivo, vuelve a revisión sin aprobar ni pagar',()=>{
  const row={datos:datos()};row.datos.factura.estado='RECHAZADA_INTERNA';row.datos.factura.motivo='Aclarar la OC';
  const original=row.datos.factura.electronica;
  responderCorreccion(row,{mensaje:'La OC correcta corresponde al documento adjunto'},'Proveedor 2');
  assert.equal(row.datos.factura.electronica,original);assert.equal(row.datos.factura.estado,'PENDIENTE');assert.equal(row.datos.factura.motivo,'Aclarar la OC');assert.equal(row.datos.mensajes.length,1);assert.equal(row.datos.factura.cuenta_por_pagar,undefined);
  assert.throws(()=>responderCorreccion(row,{mensaje:'Otra aclaración'},'Proveedor 2'),/pendiente de corrección/);
});
test('corrección bloqueada si existen pagos o la factura ya está aprobada',()=>{
  for(const cambio of [{pagos:[{monto:1}]},{factura:{...datos().factura,estado:'RECHAZADA_INTERNA',cuenta_por_pagar:true}}]){
    const d={...datos(),...cambio};d.factura.estado='RECHAZADA_INTERNA';assert.throws(()=>responderCorreccion({datos:d},{mensaje:'Respuesta válida'},'Proveedor'),/pendiente de corrección/);
  }
});
test('empresa receptora también limita el enlace, con equivalencias legales conocidas',()=>{
  const d=datos(),o={cedula:'3101000000',total:113,moneda:'CRC',empresa_destino:'GAS TOMZA'};
  assert.doesNotThrow(()=>validarCorrespondencia(d,o));assert.throws(()=>validarCorrespondencia(d,{...o,empresa_destino:'SUPER GAS'}),/receptora/);
});
test('listado fiscal de ambos módulos calcula saldo disponible y oculta órdenes agotadas o canceladas',async()=>{
  const queries=[];const db={query:async(sql,args)=>{queries.push({sql,args});
    if(sql.includes("d.tipo='oc'"))return [[{id:1,datos:{total:200,moneda:'CRC',estado:'GENERADA'}},{id:2,datos:{total:200,estado:'CANCELADA'}}]];
    if(sql.includes('FROM ordenes_compra'))return [[{id:3,po_numero:'2026-3',total:100,moneda:'USD'}]];
    return [[{origen:'PROVEEDURIA',orden_id:1,asignado:50},{origen:'COMPRAS',orden_id:3,asignado:100}]];
  }};
  const r=await ordenesDisponibles(db,'3-101-000000');assert.equal(r.length,1);assert.equal(r[0].disponible,150);assert.equal(r[0].factura,undefined);
  assert.ok(queries.every(q=>q.args.every(a=>a==='3101000000')));assert.match(queries[0].sql,/COUNT\(DISTINCT c2.cedula\)/);
});
