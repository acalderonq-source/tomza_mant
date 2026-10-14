const test=require('node:test'),assert=require('node:assert/strict');
const {validarCorrespondencia,vincularOrden}=require('../src/utils/portalFacturaOrden');
const factura=()=>({id:5,datos:{proveedor:'Caribe Tools (Yendry Melissa Alvarado Quiros)',moneda:'CRC',pagos:[],factura:{estado:'PENDIENTE',total:2650,electronica:{emisor:'304400875',nombre_emisor:'Yendry Melissa Alvarado Quiros'}}}});
test('la OC debe coincidir en identidad, moneda y no tener factura previa',()=>{
  const f=factura().datos,o={proveedor:'Caribe Tools',total:3000,moneda:'CRC'};
  assert.doesNotThrow(()=>validarCorrespondencia(f,o));
  assert.throws(()=>validarCorrespondencia(f,{...o,cedula:'3101000000'}),/proveedor/);
  assert.throws(()=>validarCorrespondencia(f,{...o,proveedor:'Otro proveedor'}),/proveedor/);
  assert.throws(()=>validarCorrespondencia(f,{...o,moneda:'USD'}),/moneda/);
  assert.throws(()=>validarCorrespondencia(f,{...o,factura_registrada:true}),/ya tiene/);
});
test('enlaza PR y Compras usando bloqueos y registra la referencia visible',async()=>{
  for(const origen of ['PROVEEDURIA','COMPRAS']){
    const row=factura(),queries=[];if(origen==='COMPRAS')row.datos.factura.estado='CONCILIADA';
    const db={query:async(sql,args)=>{
      queries.push({sql,args});
      if(sql.includes("tipo='oc'"))return [[{id:7,datos:{proveedor:'Caribe Tools',total:2650,moneda:'CRC'}}]];
      if(sql.includes('FROM ordenes_compra'))return [[{id:8,po_numero:'2026-100',nombre:'Otro nombre comercial',cedula_juridica:'3-0440-0875',total:2650,moneda:'CRC'}]];
      if(sql.includes('SUM'))return [[{total:0}]];
      return [{affectedRows:1}];
    }};
    await vincularOrden(db,row,{origen,referencia:origen==='PROVEEDURIA'?'PR-7':'2026-100'},1);
    assert.equal(row.datos.orden_compra.origen,origen);assert.match(queries[0].sql,/FOR UPDATE/);assert.match(queries.at(-1).sql,/INSERT INTO prov_portal_factura_orden/);
    assert.equal(row.datos.orden_compra.url,origen==='PROVEEDURIA'?'/proveeduria/ordenes/7':'/compras/ordenes/8/detalle');
  }
});
test('rechaza OC inexistente, exceso acumulado y cambio posterior a aprobación',async()=>{
  const row=factura();
  await assert.rejects(vincularOrden({query:async()=>[[]]},row,{origen:'PROVEEDURIA',referencia:'PR-9'},1),/no encontrada/);
  const db={query:async sql=>sql.includes("tipo='oc'")?[[{id:7,datos:{proveedor:'Caribe Tools',total:2650,moneda:'CRC'}}]]:[[{total:100}]]};
  await assert.rejects(vincularOrden(db,row,{origen:'PROVEEDURIA',referencia:'PR-7'},1),/supera/);
  row.datos.pagos=[{monto:1}];await assert.rejects(vincularOrden(db,row,{origen:'PROVEEDURIA',referencia:'PR-7'},1),/sin pagos/);row.datos.pagos=[];
  row.datos.factura.estado='CONCILIADA';row.datos.orden_compra={id:7};await assert.rejects(vincularOrden(db,row,{origen:'PROVEEDURIA',referencia:'PR-7'},1),/antes de aprobar/);
});
