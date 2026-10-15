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

test('conserva codigos antes o despues de cantidad, con ceros, puntos y barras', () => {
  const ejemplos = [
    ['AB.123/45 2 Filtro aceite 100.00 200.00', 'AB.123/45'],
    ['2 AB.123/45 Filtro aceite 100.00 200.00', 'AB.123/45'],
    ['AB_123 Filtro aceite 2 100.00 200.00', 'AB_123'],
    ['000123 2 Filtro aceite 100.00 200.00', '000123'],
    ['Filtro aceite Código: ABC/DEF 2 100.00 200.00', 'ABC/DEF']
  ];
  for (const [fila, codigo] of ejemplos) {
    const linea = analizarFilas([fila]).lineas[0];
    assert.equal(linea.codigo_producto, codigo, fila);
    assert.equal(linea.cantidad, 2, fila);
    assert.equal(linea.descripcion, 'Filtro aceite', fila);
  }
  assert.equal(analizarFilas(['2 Bombillo 24V 100.00 200.00']).lineas[0].codigo_producto, '');
});

test('rechaza imagenes y archivos falsos sin invocar servicios externos', async () => {
  await assert.rejects(leerCotizacionLocal({archivo_data:'data:image/png;base64,AA=='}), /sin IA admite PDF/);
  await assert.rejects(leerCotizacionLocal({archivo_data:'data:application/pdf;base64,AA=='}), /PDF válido/);
});

test('formato Maxi separa codigo entre producto y cantidad sin quitar medidas de rotulas', () => {
  const result = analizarFilas([
    'Imagen Producto Código Cantidad Precio Total',
    'Rótula 1 1/8" x 5.44" Lh Elgin A23330022010 1 12,100.00 12,100.00',
    'Rótula 1 1/8" x 5.44" Rh Elgin A23330022110 1 12,100.00 12,100.00'
  ]);
  assert.deepEqual(result.lineas.map(l=>l.codigo_producto), ['A23330022010','A23330022110']);
  assert.equal(result.lineas[0].descripcion, 'Rótula 1 1/8" x 5.44" Lh Elgin');
  assert.equal(result.lineas[1].descripcion, 'Rótula 1 1/8" x 5.44" Rh Elgin');
  assert.equal(result.lineas.reduce((s,l)=>s+l.subtotal,0),24200);
});

test('lee un PDF real localmente sin clave ni llamadas HTTP', async () => {
  const Printer = require('pdfmake');
  const printer = new Printer({Roboto:{normal:'Helvetica'}});
  const doc = printer.createPdfKitDocument({content:['Proveedor Prueba','Placa: C12345','IVA 13%', '000123/AB 2 Filtro de aceite 1000.00 2000.00']});
  const buffer = await new Promise((resolve,reject)=>{const chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);doc.end();});
  const originalFetch = global.fetch;
  global.fetch = () => { throw Error('No se permiten servicios externos'); };
  try {
    const result = await leerCotizacionLocal({archivo_data:'data:application/pdf;base64,'+buffer.toString('base64')});
    assert.equal(result.lineas.length,1);
    assert.equal(result.lineas[0].descripcion,'Filtro de aceite');
    assert.equal(result.lineas[0].codigo_producto,'000123/AB');
    assert.equal(result.lineas[0].subtotal,2000);
  } finally { global.fetch = originalFetch; }
});
