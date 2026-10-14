const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../src/utils/presupuestosContabilidad');
const {normalizarEmpresa}=require('../src/utils/empresasContabilidad');
const documento=(extra={})=>({empresa:'GAS TOMZA',fuente:'TALLER_ORDEN',id:1,referencia:'PO-1',departamento:'TALLER',moneda:'CRC',fechaOrden:'2026-10-01',fechaFactura:'',orden:10000,factura:0,tieneFactura:false,pagos:[],...extra});
const clasificacion={empresa:'GAS TOMZA',fuente:'TALLER_ORDEN',documento_id:1,sede:'Cartago',departamento:'TALLER',rubro:'MANTENIMIENTO',moneda:'CRC'};
const presupuesto={empresa:'GAS TOMZA',periodo:'2026-10',sede:'Cartago',departamento:'TALLER',rubro:'MANTENIMIENTO',moneda:'CRC',monto:200};
function calcular(docs,extra={}){return P.resumen({docs,clasificaciones:[clasificacion],presupuestos:[presupuesto],periodo:'2026-10',moneda:'CRC',...extra});}
test('una orden pendiente compromete el presupuesto sin ser gasto facturado ni pago',()=>{
  const r=calcular([documento()]).filas.find(r=>r.key==='MANTENIMIENTO');
  assert.equal(r.presupuesto,20000);assert.equal(r.ordenado,10000);assert.equal(r.compromiso,10000);assert.equal(r.facturado,0);assert.equal(r.pagado,0);assert.equal(r.disponible,10000);
});
test('facturar libera el compromiso, sin sumar orden, factura y pago como tres gastos',()=>{
  const r=calcular([documento({tieneFactura:true,fechaFactura:'2026-10-03',factura:10000,pagos:[{fecha:'2026-10-04',monto:4000}]})]).filas.find(r=>r.key==='MANTENIMIENTO');
  assert.equal(r.compromiso,0);assert.equal(r.facturado,10000);assert.equal(r.pagado,4000);assert.equal(r.disponible,10000);
});
test('una factura del mes siguiente no libera el compromiso al cierre de octubre',()=>{
  const r=calcular([documento({tieneFactura:true,fechaFactura:'2026-11-03',factura:10000})]).filas.find(r=>r.key==='MANTENIMIENTO');assert.equal(r.compromiso,10000);assert.equal(r.facturado,0);
});
test('pagos de facturas de otros meses se contabilizan por fecha de pago',()=>{
  const r=calcular([documento({fechaOrden:'2026-09-01',tieneFactura:true,fechaFactura:'2026-09-03',factura:10000,pagos:[{fecha:'2026-10-01',monto:2500},{fecha:'2026-11-01',monto:7500}]})]).filas.find(r=>r.key==='MANTENIMIENTO');assert.equal(r.ordenado,0);assert.equal(r.facturado,0);assert.equal(r.pagado,2500);
});
test('documentos sin clasificación y claves repetidas no entran en totales',()=>{
  for(const extra of [{clasificaciones:[]},{}]){
    const r=calcular([documento(extra.clasificaciones?{}:{duplicado:true})],extra);assert.equal(r.pendientes,1);assert.equal(r.filas.find(r=>r.key==='MANTENIMIENTO').compromiso,0);
  }
});
test('la moneda de origen prevalece y las monedas desconocidas necesitan clasificación',()=>{
  assert.equal(calcular([documento({moneda:'USD'})]).documentos.length,0);
  const r=calcular([documento({moneda:''})],{clasificaciones:[]});assert.equal(r.pendientes,1);assert.equal(r.documentos[0].moneda,'');
  assert.equal(calcular([documento({moneda:''})]).filas.find(r=>r.key==='MANTENIMIENTO').compromiso,10000);
});
test('se conservan cero, centavos y filtros de sede y departamento',()=>{
  assert.equal(P.montoValido('0'),0);assert.equal(P.centavos('12.34'),1234);
  for(const x of ['','-1','NaN','Infinity','1,000','1.001','1e3'])assert.throws(()=>P.montoValido(x));
  assert.equal(calcular([documento()],{sede:'La Cruz'}).documentos.length,0);
  assert.equal(P.periodoValido('2026-13'),false);assert.equal(P.periodoValido('2026-10'),true);
});
test('las fechas con hora respetan el día de Costa Rica',()=>{
  assert.equal(P.fecha('2026-11-01T02:00:00Z'),'2026-10-31');
});
test('colillas y abonos antiguos se leen sin duplicar pagos de la misma fuente',async()=>{
  const db={query:async sql=>{
    if(sql.includes('FROM ordenes_compra'))return [[{id:1,po_numero:'PO-1',fecha:'2026-09-01',moneda:'CRC',total:100,factura:'FAC-1',factura_fecha:'2026-09-02',pagada:1,fecha_pago:'2026-10-02',abono_monto:30,abono_fecha:'2026-09-03'}]];
    if(sql.includes('FROM colillas_pago_proveedor'))return [[{fecha_pago:'2026-09-03',facturas_json:JSON.stringify([{tipo:'orden',factura_id:1,monto_pago:30}])},{fecha_pago:'2026-10-02',facturas_json:[{tipo:'orden',factura_id:1,monto_pago:70}]}]];
    return [[]];
  }};
  const {docs}=await P.cargarDocumentos(db);assert.deepEqual(docs[0].pagos,[{fecha:'2026-09-03',monto:3000},{fecha:'2026-10-02',monto:7000}]);
});
test('Carburación relaciona factura y pagos con su orden una sola vez',async()=>{
  const db={query:async sql=>{
    if(sql.includes('FROM carburacion_ordenes'))return [[{id:5,po_numero:'CAR-5',fecha:'2026-10-01',total:100,moneda:'USD'}]];
    if(sql.includes('FROM carburacion_facturas'))return [[{id:9,orden_id:5,numero:'F-9',fecha:'2026-10-02',total:100,moneda:'USD'}]];
    if(sql.includes('FROM carburacion_pagos_detalle'))return [[{factura_id:9,monto:40,fecha:'2026-10-03'}]];
    return [[]];
  }};
  const {docs}=await P.cargarDocumentos(db);assert.equal(docs.length,1);assert.equal(docs[0].factura,10000);assert.equal(docs[0].pagos[0].monto,4000);
});
test('una clave repetida entre portal y Taller exige conciliación',async()=>{
  const db={query:async sql=>{
    if(sql.includes('FROM facturas'))return [[{id:1,numero_factura:'F-1',fecha:'2026-10-01',monto:100,clave_electronica:'clave'}]];
    if(sql.includes('FROM prov_documentos'))return [[{id:2,tipo:'factura_portal',sede:'PORTAL',datos:{moneda:'CRC',factura:{total:100,electronica:{clave:'clave',fecha:'2026-10-01'}}}}]];
    return [[]];
  }};
  const {docs,advertencias}=await P.cargarDocumentos(db);assert.ok(docs.every(d=>d.duplicado));assert.equal(advertencias.length,1);
});
test('razones sociales equivalentes conservan la empresa sin asumir la de un negocio',()=>{
  assert.equal(normalizarEmpresa('Gas Tomza de Costa Rica Sociedad Anónima'),'GAS TOMZA');
  assert.equal(normalizarEmpresa('ENVASADORA SUPERGAS GLP S.A. DE C.V.'),'SUPER GAS');
  assert.equal(normalizarEmpresa('COMPAÑIA TRANSPORTADORA DE CATALUÑA, S.A.'),'TRANSPORTADORA DE CATALUÑA');
  assert.equal(normalizarEmpresa('Granel'),'');
  assert.equal(normalizarEmpresa('Empresa Nueva S.A.'),'EMPRESA NUEVA S.A.');
});
test('presupuestos y pagos de empresas diferentes no se mezclan en una misma sede y rubro',()=>{
  const docs=[documento({empresa:'GAS TOMZA'}),documento({id:2,empresa:'SUPER GAS',orden:30000,pagos:[{fecha:'2026-10-01',monto:10000}]})];
  const clasificaciones=[clasificacion,{...clasificacion,documento_id:2,empresa:'SUPER GAS'}];
  const presupuestos=[presupuesto,{...presupuesto,empresa:'SUPER GAS',monto:500}];
  for(const [empresa,pres,comp,pago] of [['GAS TOMZA',20000,10000,0],['SUPER GAS',50000,30000,10000],['',70000,40000,10000]]){
    const r=calcular(docs,{empresa,clasificaciones,presupuestos});const fila=r.filas.find(r=>r.key==='MANTENIMIENTO');
    assert.equal(fila.presupuesto,pres);assert.equal(fila.compromiso,comp);assert.equal(fila.pagado,pago);
  }
});
test('registros anteriores sin empresa quedan pendientes, sin asignación automática a Gas Tomza',()=>{
  const r=calcular([documento({empresa:''})],{presupuestos:[{...presupuesto,empresa:''}],clasificaciones:[{...clasificacion,empresa:''}]});
  assert.equal(r.pendientes,1);assert.equal(r.filas.find(r=>r.key==='MANTENIMIENTO').presupuesto,0);assert.equal(r.filas.find(r=>r.key==='MANTENIMIENTO').compromiso,0);
  const sinEmpresa=calcular([documento({empresa:''})],{empresa:'__SIN_EMPRESA__',clasificaciones:[]});assert.equal(sinEmpresa.documentos.length,1);
  assert.equal(calcular([documento({empresa:''})],{empresa:'GAS TOMZA',clasificaciones:[]}).documentos.length,0);
});
test('la empresa de la orden y del receptor XML se conserva desde el origen',()=>{
  assert.equal(P.documento('TALLER_ORDEN',{id:1,empresa_destino:'SUPER GAS'}).empresa,'SUPER GAS');
  assert.equal(P.documento('PROVEEDURIA',{id:2,tipo:'factura_portal',datos:{factura:{electronica:{nombre_receptor:'ENVASADORA SUPER GAS GLP S.A.'}}}}).empresa,'SUPER GAS');
  assert.equal(P.documento('TALLER_FACTURA',{id:3}).empresa,'');
});
test('los ocho presupuestos están disponibles y sus unidades se distinguen de la empresa legal',()=>{
  const {EMPRESAS_BASE}=require('../src/utils/empresasContabilidad');assert.equal(EMPRESAS_BASE.length,8);
  for(const nombre of ['LA CRUZ','CEDIS ZONA SUR','CEDIS ATLÁNTICO','CEDIS SAN CARLOS','ADMINISTRATIVO'])assert.ok(EMPRESAS_BASE.includes(nombre));
  const r=calcular([documento()],{empresa:'LA CRUZ',clasificaciones:[{...clasificacion,empresa:'LA CRUZ'}],presupuestos:[{...presupuesto,empresa:'LA CRUZ'}]});
  assert.equal(r.documentos[0].empresa,'LA CRUZ');assert.equal(r.documentos[0].empresaOrigen,'GAS TOMZA');assert.equal(r.filas.find(f=>f.key==='MANTENIMIENTO').compromiso,10000);
  assert.equal(calcular([documento()],{empresa:'GAS TOMZA',clasificaciones:[{...clasificacion,empresa:'LA CRUZ'}]}).documentos.length,0);
});


test('varias facturas de una orden se suman por mes y conservan el compromiso parcial',async()=>{
 const db={query:async sql=>{
  if(sql.includes('FROM carburacion_ordenes'))return [[{id:1,po_numero:'CAR-1',fecha:'2026-09-01',empresa_destino:'GAS TOMZA',moneda:'CRC',total:1000}]];
  if(sql.includes('FROM carburacion_facturas'))return [[{id:10,orden_id:1,numero:'F-1',fecha:'2026-09-10',total:200,moneda:'CRC'},{id:11,orden_id:1,numero:'F-2',fecha:'2026-09-20',total:300,moneda:'CRC'},{id:12,orden_id:1,numero:'F-3',fecha:'2026-10-01',total:500,moneda:'CRC'}]];
  if(sql.includes('FROM carburacion_pagos_detalle'))return [[{factura_id:10,fecha:'2026-10-05',monto:200}]];
  return [[]];
 }};
 const {docs}=await P.cargarDocumentos(db);assert.equal(docs.length,1);assert.equal(docs[0].factura,100000);
 const clasificaciones=[{fuente:'CARBURACION_ORDEN',documento_id:1,empresa:'GAS TOMZA',sede:'General',departamento:'CARBURACION',moneda:'CRC',rubro:'COMBUSTIBLE'}];
 const septiembre=P.resumen({docs,clasificaciones,presupuestos:[],periodo:'2026-09',moneda:'CRC'}).filas.find(r=>r.key==='COMBUSTIBLE');
 assert.equal(septiembre.facturado,50000);assert.equal(septiembre.compromiso,50000);assert.equal(septiembre.pagado,0);
 const octubre=P.resumen({docs,clasificaciones,presupuestos:[],periodo:'2026-10',moneda:'CRC'}).filas.find(r=>r.key==='COMBUSTIBLE');
 assert.equal(octubre.facturado,50000);assert.equal(octubre.pagado,20000);assert.equal(octubre.compromiso,0);
});
test('cada documento excluido explica el motivo y no altera los totales',()=>{
 const base={fuente:'CONTROL_RUBRO',id:1,empresa:'GAS TOMZA',moneda:'CRC',fechaFactura:'2026-09-01',factura:1000,orden:0,pagos:[],clasificacionPropia:{empresa:'GAS TOMZA',moneda:'CRC',rubro:'INVALIDO'}};
 const r=P.resumen({docs:[base],clasificaciones:[],presupuestos:[],periodo:'2026-09',moneda:'CRC'});
 assert.equal(r.pendientes,1);assert.equal(r.documentos[0].incluido,false);assert.match(r.documentos[0].motivoExclusion,/Rubro/);assert.equal(r.filas.reduce((s,x)=>s+x.facturado,0),0);
});
