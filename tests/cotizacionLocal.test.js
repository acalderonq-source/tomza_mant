const test = require('node:test');
const assert = require('node:assert/strict');
const { analizarFilas, numero, leerCotizacionLocal } = require('../src/utils/cotizacionLocal');

test('montos costarricenses y estadounidenses se interpretan sin perder decimales', () => {
  assert.equal(numero('1.250,50'),1250.5);
  assert.equal(numero('1,250.50'),1250.5);
  assert.equal(numero('1,000'),1000);
  assert.ok(Number.isNaN(numero('texto')));
});

test('extrae solo filas verificables y proveedor unico sin convertir totales en productos', () => {
  const result = analizarFilas(['REPUESTOS PRUEBA S.A.','Placa: C174671','Credito IVA 13% CRC',
    'F123 Filtro aceite 2 1.250,50 2.501,00',
    '3 Bombillo 24V 100.00 300.00',
    'Total 2 1000 2000', 'Producto mal interpretado 2 100 123'], [{id:1,nombre:'Repuestos Prueba S.A.'}]);
  assert.equal(result.lineas.length,2);
  assert.equal(result.lineas[0].codigo_producto,'F123');
  assert.equal(result.lineas[0].cantidad,2);
  assert.equal(result.lineas[0].precio_unitario,1250.5);
  assert.equal(result.lineas[1].cantidad,3);
  assert.equal(result.placa_unidad,'C174671');
  assert.equal(result.iva,13);
  assert.equal(result.proveedor_nombre,'Repuestos Prueba S.A.');
});

test('no adivina impuestos ni proveedor y rechaza tablas sin cantidades', () => {
  assert.equal(analizarFilas(['Filtro 1 50 50']).iva,null);
  assert.equal(analizarFilas(['Filtro 1 50 50']).proveedor_nombre,'');
  assert.throws(()=>analizarFilas(['Total 1000','Filtro sin precio']), /No se reconoció/);
});

test('rechaza imagenes y archivos falsos sin invocar servicios externos', async () => {
  await assert.rejects(leerCotizacionLocal({archivo_data:'data:image/png;base64,AA=='}), /sin IA admite PDF/);
  await assert.rejects(leerCotizacionLocal({archivo_data:'data:application/pdf;base64,AA=='}), /PDF válido/);
});

test('lee un PDF real localmente sin clave ni llamadas HTTP', async () => {
  const Printer = require('pdfmake');
  const printer = new Printer({Roboto:{normal:'Helvetica'}});
  const doc = printer.createPdfKitDocument({content:['Proveedor Prueba','Placa: C12345','IVA 13%', '2 Filtro de aceite 1000.00 2000.00']});
  const buffer = await new Promise((resolve,reject)=>{const chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);doc.end();});
  const originalFetch = global.fetch;
  global.fetch = () => { throw Error('No se permiten servicios externos'); };
  try {
    const result = await leerCotizacionLocal({archivo_data:'data:application/pdf;base64,'+buffer.toString('base64')});
    assert.equal(result.lineas.length,1);
    assert.equal(result.lineas[0].descripcion,'Filtro de aceite');
    assert.equal(result.lineas[0].subtotal,2000);
  } finally { global.fetch = originalFetch; }
});
