const {test}=require('node:test'),assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const {generar}=require('../src/utils/listadoPasivosExcel');
const {facturaXml}=require('../src/utils/pasivosPdfOutlook');
const f={desde:'2026-10-17',hasta:'2026-10-21',fechaEntrega:'2026-10-21',persona:'Alex'};
const fila={empresa:'GAS TOMZA',proveedor_nombre:'Proveedor',numero_factura:'00100001010000012345',monto:100,moneda:'CRC'};
test('listado conserva columnas, fecha, persona y consecutivo y suma notas negativas por empresa',async()=>{
  const w=generar([fila,{...fila,numero_factura:'00100001030000000001',monto:-25,tipoDocumento:'nota_credito',referenciaFactura:fila.numero_factura},{...fila,empresa:'SUPER GAS',monto:10}],f);
  const reabierto=new ExcelJS.Workbook();await reabierto.xlsx.load(await w.xlsx.writeBuffer());const s=reabierto.getWorksheet('Pasivos CRC');
  assert.deepEqual(s.getRow(5).values.slice(1),['FECHA DE ENTREGA','PROVEEDOR','MONTO','# FACTURA','PERSONA']);
  const rows=[];s.eachRow(r=>rows.push(r));
  assert.equal(rows.find(r=>r.getCell(2).value==='TOTAL GAS TOMZA').getCell(3).value.result,75);
  assert.equal(rows.find(r=>r.getCell(2).value==='TOTAL SUPER GAS').getCell(3).value.result,10);
  const detalle=rows.find(r=>r.getCell(4).value===fila.numero_factura);
  assert.equal(detalle.getCell(5).value,'Alex');assert.equal(detalle.getCell(1).value.toISOString().slice(0,10),'2026-10-21');
  assert.ok(rows.some(r=>String(r.getCell(4).value).includes('NC 00100001030000000001 AP FACT')));
});
test('monedas diferentes se exportan en hojas separadas y nunca sumadas',()=>{
  assert.deepEqual(generar([fila,{...fila,moneda:'USD'}],f).worksheets.map(s=>s.name),['Pasivos CRC','Pasivos USD','Detalle de documentos']);
  assert.throws(()=>generar([],f));
  for(const filas of [[{...fila,monto:null}],[{...fila,moneda:null}]])assert.ok(generar(filas,f).getWorksheet('Por revisar'));
  assert.throws(()=>generar([fila],{...f,fechaEntrega:'2026-02-30'}));
});
test('detalle exporta condición y estado sin modificar el formato de pasivos',async()=>{
  const w=generar([{...fila,fecha_factura:'2026-10-21T14:00:00Z',condicionVenta:'02',condicionTexto:'Crédito',plazoCredito:'30',estadoHaciendaTexto:'Aceptado',respuestasHacienda:[{}]}],f);
  const reabierto=new ExcelJS.Workbook();await reabierto.xlsx.load(await w.xlsx.writeBuffer());const s=reabierto.getWorksheet('Detalle de documentos');
  assert.equal(s.getRow(2).getCell(9).value,'Crédito');assert.equal(s.getRow(2).getCell(10).value,'02');assert.equal(s.getRow(2).getCell(12).value,'Aceptado');assert.equal(s.getRow(2).getCell(13).value,1);
});
test('el XML aporta monto, moneda y nota de crédito sin perder el consecutivo',()=>{
  const xml=Buffer.from('<NotaCreditoElectronica><NumeroConsecutivo>00100001030000000001</NumeroConsecutivo><Emisor><Nombre>Proveedor</Nombre></Emisor><Receptor><Nombre>GAS TOMZA</Nombre></Receptor><ResumenFactura><CodigoTipoMoneda><CodigoMoneda>CRC</CodigoMoneda></CodigoTipoMoneda><TotalComprobante>25.50</TotalComprobante></ResumenFactura><InformacionReferencia><Numero>00100001010000012345</Numero></InformacionReferencia></NotaCreditoElectronica>');
  const r=facturaXml(xml);assert.equal(r.tipoDocumento,'nota_credito');assert.equal(r.monto,-25.5);assert.equal(r.moneda,'CRC');assert.equal(r.numero_factura,'00100001030000000001');
});
