const test=require('node:test'),assert=require('node:assert/strict');
const {identificarReceptor,empresaFactura,diferenciaEmpresa}=require('../src/utils/portalEmpresaReceptora');
const {buscarCandidatos,cruzarFactura}=require('../src/utils/portalCruceAutomatico');
const {validarCorrespondencia}=require('../src/utils/portalFacturaOrden');
const receptores=[{cedula:'3101349880',nombre:'GAS TOMZA DE COSTA RICA SOCIEDAD ANONIMA',activo:1},{cedula:'3101044021',nombre:'ENVASADORA SUPER GAS GLP SOCIEDAD ANONIMA',activo:1}];
const e=i=>({receptor:receptores[i].cedula,nombre_receptor:receptores[i].nombre,emisor:'3101999999',nombre_emisor:'Proveedor',lineas:[{codigo:'A',cantidad:1,precio_unitario:100,iva:13,descuento:0}]});
const datos=i=>({proveedor:'Proveedor',moneda:'CRC',pagos:[],factura:{estado:'PENDIENTE',total:113,electronica:e(i)}});
test('identifica ambas empresas por cédula y rechaza nombres cruzados, cédulas ajenas e inactivas',()=>{
  for(const i of [0,1])assert.equal(identificarReceptor(e(i),receptores).empresa,i?'SUPER GAS':'GAS TOMZA');
  assert.throws(()=>identificarReceptor({...e(1),nombre_receptor:receptores[0].nombre},receptores),/no corresponde/);
  assert.throws(()=>identificarReceptor({...e(0),receptor:'999999999'},receptores),/autorizada/);
  assert.throws(()=>identificarReceptor(e(1),[{...receptores[1],activo:0}]),/autorizada/);
});
test('la cédula fiscal prevalece sobre nombres o empresas guardados, y la OC no admite empresas contradictorias',()=>{
  const d=datos(1);d.empresa_receptora={empresa:'GAS TOMZA'};assert.equal(empresaFactura(d),'SUPER GAS');
  assert.match(diferenciaEmpresa(d,{empresa_destino:'SUPER GAS',razon_social:receptores[0].nombre}),/contradictorias/);
  const o={proveedor:'Proveedor',moneda:'CRC',total:113,empresa_destino:'SUPER GAS'};
  assert.doesNotThrow(()=>validarCorrespondencia(datos(1),o));assert.throws(()=>validarCorrespondencia(datos(0),o),/OC es de SUPER GAS/);
  assert.throws(()=>validarCorrespondencia({...d,factura:{...d.factura,electronica:{...e(1),nombre_receptor:receptores[0].nombre}}},o),/no corresponde/);
});
test('entre órdenes idénticas de ambas empresas solo propone la del receptor del XML',async()=>{
  const pr=empresa=>({id:empresa==='SUPER GAS'?1:2,datos:{proveedor:'Proveedor',total:113,moneda:'CRC',empresa_destino:empresa,lineas:e(0).lineas}});
  const db={query:async sql=>sql.includes("d.tipo='oc'")?[[pr('GAS TOMZA'),pr('SUPER GAS')]]:[[]]};
  for(const i of [0,1]){const r=await buscarCandidatos(db,datos(i));assert.equal(r.candidatos.length,1);assert.equal(r.candidatos[0].empresa_destino,i?'SUPER GAS':'GAS TOMZA');assert.equal(r.empresas_incompatibles.length,1);}
});
test('cruce con única OC de otra empresa conserva alerta específica y no escribe un enlace',async()=>{
  let guardado;const writes=[];const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql,args)=>{
    if(sql.includes("tipo='factura_portal'"))return [[{id:10,datos:datos(0)}]];
    if(sql.includes("d.tipo='oc'"))return [[{id:1,datos:{proveedor:'Proveedor',total:113,moneda:'CRC',empresa_destino:'SUPER GAS',lineas:e(0).lineas}}]];
    if(sql.startsWith('UPDATE prov_documentos'))guardado=JSON.parse(args[0]);if(!sql.startsWith('SELECT'))writes.push(sql);return [[]];
  }};
  assert.equal((await cruzarFactura({getConnection:async()=>db},10)).estado,'EMPRESA_NO_COINCIDE');
  assert.match(guardado.empresas_incompatibles[0].detalle,/factura está emitida a GAS TOMZA/);assert.ok(!writes.some(s=>s.includes('INSERT INTO prov_portal_factura_orden')));
});
