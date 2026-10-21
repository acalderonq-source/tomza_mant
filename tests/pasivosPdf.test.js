const {test}=require('node:test');
const assert=require('node:assert/strict');
const pdf=require('../src/utils/pasivosPdf');
test('revisión completa reconoce Turbos Cartago y Lapa Green sin ampliar empresas autorizadas',()=>{
  assert.equal(pdf.clasificar('RECONSTRUCCION DE TURBOS CARTAGO SOCIEDAD DE RESPONSABILIDAD LIMITADA','GAS TOMZA','3102887390').nombre,'RECONSTRUCCION DE TURBOS CARTAGO');
  assert.equal(pdf.clasificar('SOLUCIONES AUTOMOTRICES LAPA GREEN S.R.L.','SUPER GAS','3102783927').nombre,'LAPAGREEN (SG)');
  assert.equal(pdf.clasificar('SOLUCIONES AUTOMOTRICES LAPA GREEN S.R.L.','GAS TOMZA','3102783927'),null);
  assert.equal(pdf.clasificar('Autopistas del Sol, S.A.','GAS TOMZA','3101428504'),null);
});
test('Maxi Repuestos reconoce razón social del XML y cédula en ambas empresas',()=>{
  for(const empresa of ['GAS TOMZA','SUPER GAS']){
    assert.equal(pdf.clasificar('MAXI REPUESTOS SOCIEDAD DE RESPONSABILIDAD LIMITADA',empresa).empresa,empresa);
    assert.equal(pdf.clasificar('Otra variante',empresa,'3102449648').nombre,empresa==='SUPER GAS'?'MAXI REPUESTOS (SG)':'MAXI REPUESTOS');
  }
  assert.equal(pdf.clasificar('MAXI REPUESTOS SOCIEDAD DE RESPONSABILIDAD LIMITADA',''),null);
});
test('lista distingue empresa y grupo, tildes y proveedores compartidos',()=>{
  assert.equal(pdf.clasificar('Purdy Motor S.A.','GAS TOMZA').grupo,'TALLER');
  assert.equal(pdf.clasificar('MAXI REPUESTOS','SUPER GAS').empresa,'SUPER GAS');
  assert.equal(pdf.clasificar('MAXI REPUESTOS',''),null);
  assert.equal(pdf.clasificar('MAXI REPUESTOS (SG)','').empresa,'SUPER GAS');
  assert.equal(pdf.clasificar('NOE ALONSO SALAZAR JIMÉNEZ','GAS TOMZA').grupo,'OTROS');
  assert.equal(pdf.clasificar('NO AUTORIZADO','GAS TOMZA'),null);
  assert.equal(pdf.clasificar('ICE (SG)','GAS TOMZA'),null);
});
test('período obligatorio, fechas reales y ordenadas',()=>{
  for(const q of [{},{desde:'2026-02-30',hasta:'2026-03-01'},{desde:'2026-10-21',hasta:'2026-10-20'}])assert.throws(()=>pdf.fechas(q));
  assert.deepEqual(pdf.fechas({desde:'2026-10-20',hasta:'2026-10-20'}),{desde:'2026-10-20',hasta:'2026-10-20'});
});
test('consulta parametrizada por fecha de factura y distingue PDF de imágenes',async()=>{
  const rows=await pdf.cargar({query:async(sql,params)=>{
    assert.match(sql,/a.fecha_factura>=\?/);assert.deepEqual(params,['2026-10-01','2026-10-20']);
    return [[{proveedor_nombre:'DELOITTE',empresa_origen:'GAS TOMZA',factura_tipo:'orden',ruta:'/uploads/facturas/a.pdf'},{proveedor_nombre:'DELOITTE',factura_tipo:'independiente',ruta:'/uploads/facturas/a.jpg'},{proveedor_nombre:'DELOITTE',factura_tipo:'portal',portal_datos:JSON.stringify({razon_social:'GAS TOMZA',factura:{archivo:{id:8,mime:'application/pdf'}}})},{proveedor_nombre:'DELOITTE',empresa_origen:'GAS TOMZA',factura_tipo:'orden',ruta:'/uploads/facturas/../secreto.pdf'}]];
  }},{desde:'2026-10-01',hasta:'2026-10-20'});
  assert.deepEqual(rows.map(r=>r.disponible),[true,false,true,false]);
});
test('recupera únicamente el adjunto original del portal y valida PDF',async()=>{
  const row={factura_tipo:'portal',adjunto:{id:8}};
  assert.equal((await pdf.contenido({query:async(sql,params)=>{assert.deepEqual(params,[8]);return [[{contenido:Buffer.from('%PDF-1.7 original')}]];}},row)).toString(),'%PDF-1.7 original');
  await assert.rejects(pdf.contenido({query:async()=>[[{contenido:Buffer.from('imagen')}]]},row),/PDF válido/);
  assert.equal(pdf.nombre('Proveedor / S.A.'),'Proveedor _ S.A');
});
