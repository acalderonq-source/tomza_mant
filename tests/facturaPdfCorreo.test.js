const {test}=require('node:test'),assert=require('node:assert/strict');
const {analizarTexto,leerPdf}=require('../src/utils/facturaPdfCorreo');
const {clasificar}=require('../src/utils/pasivosPdf');
const {pdfPrueba,lineas,clave}=require('./helpers/facturaPdfPrueba');
test('PDF real con texto se identifica por clave y receptor y conserva nota negativa',async()=>{
  const d=await leerPdf(pdfPrueba(lineas.map(l=>l.replace('CRC 100.00','100.00'))),'documento.pdf');
  assert.ok(d.identificado);assert.equal(d.proveedor_nombre,'PABLO CESAR HIDALGO');assert.equal(d.numero_factura,'00100001030000000118');assert.equal(d.monto,-100);assert.equal(d.moneda,'CRC');
});
test('cédulas reconocen razones comerciales y no confunden empresas',()=>{
  assert.equal(clasificar('GRUPO GASOLINERO GASOTICA SOCIEDAD ANONIMA','GAS TOMZA').nombre,'GASOTICA');
  assert.equal(clasificar('EURO EMBRAGUES Y MAS LTDA','GAS TOMZA').nombre,'EUROEMBRAGUES');
  assert.equal(clasificar('COMPUTRANS S.A.','GAS TOMZA').nombre,'COMPUTRANS');
  assert.equal(clasificar('Nombre comercial diferente','GAS TOMZA','003101685264').nombre,'GASOTICA');
  assert.equal(clasificar('COMPUTRANS S.A.','SUPER GAS','3101542565'),null);
});
test('no inventa monto ni moneda y no identifica al receptor por proveedor',()=>{
  const sinMoneda=analizarTexto(lineas.slice(0,5).concat('Total Comprobante: 100.00').join('\n'));
  assert.equal(sinMoneda.moneda,null);assert.equal(sinMoneda.monto,-100);
  const sinEmpresa=analizarTexto(lineas.slice(0,3).join('\n'));assert.equal(sinEmpresa.identificado,false);
  assert.equal(analizarTexto('Orden de compra 123'),null);
});
test('no toma subtotales o conversión USD como total y rechaza claves contradictorias',()=>{
  const d=analizarTexto(lineas.slice(0,5).concat('Subtotal: 200.00','Monto Total: 200.00','Total 100.00','Total USD: 1.00','Moneda: CRC').join('\n'));
  assert.equal(d.monto,-100);
  assert.equal(analizarTexto(lineas.join('\n').replace('No: 00100001030000000118','No: 00100001030000000119')),null);
});
