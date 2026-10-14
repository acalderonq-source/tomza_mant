const test=require('node:test'),assert=require('node:assert/strict');
const {compararLineas,revisarFactura,exigirControl,registrarRecepcionCompras,excepciones}=require('../src/utils/portalControlFactura');
const {saldo}=require('../src/utils/proveeduria');
const {leerFacturaXML}=require('../src/utils/proveedorHacienda');
const linea=(cantidad=1)=>({codigo:'A',cantidad,precio_unitario:100,iva:13,descuento:0});
test('facturas parciales acumulan por artículo, incluidos códigos alternos y repetidos',()=>{
  assert.deepEqual(compararLineas([linea(2)],[linea(5)],[linea(3)]),[]);
  assert.match(compararLineas([linea(3)],[linea(5)],[linea(3)]).join(),/cantidad acumulada/);
  assert.match(compararLineas([linea(3),linea(3)],[linea(5)]).join(),/cantidad acumulada/);
  assert.match(compararLineas([{...linea(3),codigo:'ALTERNATIVO',codigos:['A']}],[linea(5)],[linea(3)]).join(),/cantidad acumulada/);
});
test('no permite precio, IVA, descuento, código ambiguo o detalle ausente',()=>{
  for(const cambio of [{precio_unitario:101},{iva:0},{descuento:5},{codigo:'B'},{cantidad:NaN}])assert.ok(compararLineas([{...linea(),...cambio}],[linea()]).length);
  assert.ok(compararLineas([linea()],[linea(),linea()]).length);
  assert.ok(compararLineas([],[linea()]).length);
});
function mock({origen='PROVEEDURIA',recibida=0,otras=[],total=565}={}){
  const writes=[];
  const db={query:async(sql,args)=>{
    if(sql.startsWith('INSERT')){writes.push({sql,args});return [{insertId:1}];}
    if(sql.includes("tipo='oc'"))return [[{datos:{proveedor:'Proveedor',moneda:'CRC',total:565,lineas:[linea(5)],recepciones:recibida?[{lineas:[{codigo:'A',cantidad:recibida}]}]:[]}}]];
    if(sql.includes('FROM prov_portal_factura_orden'))return [otras.map((cantidad,i)=>({id:20+i,datos:{pagos:[{monto:1}],factura:{total:cantidad*113,electronica:{lineas:[linea(cantidad)]}}}}))];
    if(sql.includes('AS total FROM prov_documentos')||sql.startsWith('SELECT total FROM ordenes_compra'))return [[{total}]];
    if(sql.includes('FROM ordenes_compra_detalle'))return [[{...linea(5),subtotal:500}]];
    if(sql.includes('FROM prov_portal_recepciones_compras'))return [[{lineas:[{codigo:'A',cantidad:recibida}]}]];
    if(sql.includes('FROM ordenes_compra'))return [[{nombre:'Proveedor',moneda:'CRC',estado:'EMITIDA',iva:13,subtotal:500,total:565}]];
    throw Error('Consulta inesperada: '+sql);
  }};
  const row={id:5,datos:{proveedor:'Proveedor',orden_compra:{origen,id:7},moneda:'CRC',pagos:[],factura:{total:226,electronica:{lineas:[linea(2)]}}}};
  return {db,row,writes};
}
test('aprobación compara OC y XML; pago exige recepción acumulada de ambas facturas',async()=>{
  for(const origen of ['PROVEEDURIA','COMPRAS']){
    const m=mock({origen,recibida:3,otras:[2]}),c=await revisarFactura(m.db,m.row,true);
    assert.deepEqual(c.diferencias,[]);assert.equal(c.recepcion,false);
    assert.doesNotThrow(()=>exigirControl(c));assert.throws(()=>exigirControl(c,true),/recibida/);
    const n=mock({origen,recibida:4,otras:[2]}),ok=await revisarFactura(n.db,n.row,true);assert.doesNotThrow(()=>exigirControl(ok,true));
  }
});
test('reverifica el monto acumulado al aprobar y pagar',async()=>{
  const m=mock({recibida:5,otras:[4]}),c=await revisarFactura(m.db,m.row,true);
  assert.match(c.diferencias.join(),/Monto acumulado/);assert.match(c.diferencias.join(),/cantidad acumulada/);
});
test('recepción parcial conserva referencia, actor y cantidades; rechaza excesos',async()=>{
  const m=mock({origen:'COMPRAS',recibida:2});
  await registrarRecepcionCompras(m.db,m.row,{referencia:'Entrega 1',cantidad_0:2},1);
  assert.equal(m.writes.length,1);assert.deepEqual(JSON.parse(m.writes[0].args[2]),[{codigo:'A',cantidad:2}]);
  await assert.rejects(registrarRecepcionCompras(m.db,m.row,{referencia:'Entrega 2',cantidad_0:4},1),/Cantidades/);
  await assert.rejects(registrarRecepcionCompras(m.db,m.row,{referencia:'Entrega 2',cantidad_0:-1},1),/Cantidades/);
});

test('recepción de Compras conserva el código de proveedor cuando el código interno es nulo',async()=>{
  const m=mock({origen:'COMPRAS'}),query=m.db.query;
  m.db.query=async(sql,args)=>sql.includes('FROM ordenes_compra_detalle')?[[{...linea(5),id:77,codigo:null,codigo_producto:'A',subtotal:500}]]:query(sql,args);
  const c=await revisarFactura(m.db,m.row,true);assert.equal(c.orden[0].codigo,'A');assert.deepEqual(c.diferencias,[]);
  await registrarRecepcionCompras(m.db,m.row,{referencia:'Entrega Maxi',cantidad_77:2},1);
  assert.deepEqual(JSON.parse(m.writes[0].args[2]),[{codigo:'A',cantidad:2}]);
});
test('programación no reduce saldo; solo notas aplicadas reducen cuentas por pagar',()=>{
  const d={factura:{total:113},pagos:[{monto:20}],programacion:{monto:93},notas_credito:[{total:30,aplicada:true},{total:50,aplicada:false}]};
  assert.deepEqual(saldo(d),{facturado:113,pagos:20,creditos:30,saldo:63});
});
test('excepciones incluyen Hacienda, OC, precios y recepción',()=>{
  const d={factura:{electronica:{hacienda:{estado:'RECHAZADA'}}},control:{diferencias:['Precio diferente'],recepcion:false}};
  assert.deepEqual(excepciones(d),['Sin OC','Rechazada por Hacienda','Precio diferente']);
  d.orden_compra={id:1};assert.ok(excepciones(d).includes('Recepción pendiente'));
});
test('XML extrae detalle, descuento, impuesto y referencia de nota de crédito',()=>{
  const consecutivo='00100001030000000001',clave='506141026003101123456'+consecutivo+'112345678',original='50614102600310112345600100001010000000001112345678';
  const xml=`<NotaCreditoElectronica><Clave>${clave}</Clave><NumeroConsecutivo>${consecutivo}</NumeroConsecutivo><FechaEmision>2026-10-14T10:00:00-06:00</FechaEmision><Emisor><Identificacion><Numero>3101123456</Numero></Identificacion></Emisor><Receptor><Identificacion><Numero>3101654321</Numero></Identificacion></Receptor><DetalleServicio><LineaDetalle><CodigoComercial><Codigo>A</Codigo></CodigoComercial><Detalle>Artículo A</Detalle><Cantidad>2</Cantidad><PrecioUnitario>100</PrecioUnitario><Descuento><MontoDescuento>10</MontoDescuento></Descuento><SubTotal>190</SubTotal><Impuesto><Tarifa>13</Tarifa></Impuesto></LineaDetalle></DetalleServicio><ResumenFactura><TotalComprobante>214.7</TotalComprobante></ResumenFactura><InformacionReferencia><TipoDocIR>01</TipoDocIR><Numero>${original}</Numero></InformacionReferencia></NotaCreditoElectronica>`;
  const archivo={base64:Buffer.from(xml).toString('base64')},n=leerFacturaXML(archivo,true);
  assert.equal(n.tipo,'NOTA_CREDITO');assert.equal(n.lineas[0].descuento,10);assert.equal(n.lineas[0].iva,13);assert.equal(n.referencias[0].numero,original);
  assert.throws(()=>leerFacturaXML(archivo),/Solo se admiten facturas/);
  assert.throws(()=>leerFacturaXML({base64:Buffer.from(xml.replace('<TipoDocIR>01','<TipoDocIR>03')).toString('base64')},true),/única factura/);
});
