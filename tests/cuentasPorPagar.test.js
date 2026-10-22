const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const { preparar } = require('../src/utils/contabilidadDocumentos');
const { construir, enlacePago } = require('../src/utils/cuentasPorPagar');

const base = { tipo: 'factura', empresa: 'GAS TOMZA', moneda: 'CRC', fecha: '2026-09-01', total: 100000, pagado: 0, hacienda: 'ACEPTADA' };
function documentos() {
  return preparar([
    { ...base, origen: 'TALLER', id: 1, proveedorId: 7, proveedor: 'Repuestos Uno', numero: 'F-1', referencia: '2026-100', vencimiento: '2026-09-15' },
    { ...base, origen: 'TALLER', id: 2, proveedorId: 7, proveedor: 'Repuestos Uno', numero: 'F-2', referencia: '2026-101', vencimiento: '2026-12-31', pagado: 40000 },
    { ...base, origen: 'TALLER', id: 3, proveedorId: 8, proveedor: 'Llantas Dos', numero: 'F-3', referencia: '2026-102', vencimiento: '2026-10-01', pagado: 100000 },
    { ...base, origen: 'TALLER_INDEPENDIENTE', id: 4, proveedorId: 9, proveedor: 'Sin Orden', numero: 'F-4', moneda: '' },
    { ...base, origen: 'ELECTRONICA', id: 5, proveedor: 'Recibida', numero: 'F-5', pendienteVinculo: true },
    { ...base, origen: 'TALLER', id: 6, tipo: 'orden', proveedor: 'Repuestos Uno', referencia: '2026-103' }
  ], [], '2026-10-22');
}

test('suma solo facturas confirmadas con OC y separa las que no tienen orden', () => {
  const datos = construir(documentos());
  const crc = datos.resumen.find(r => r.moneda === 'CRC');
  assert.equal(crc.saldo, 100000 + 60000, 'la factura pagada y las órdenes no suman');
  assert.equal(crc.vencido, 100000);
  assert.equal(crc.facturas, 2);
  assert.equal(crc.sinOrden, 100000, 'la factura electrónica sin OC va aparte');
  assert.deepEqual(datos.sinOrdenSinMoneda, { facturas: 1, saldo: 100000 });
  assert.deepEqual(datos.sinOrden.map(d => d.numero).sort(), ['F-4', 'F-5']);
  assert.equal(datos.detalle[0].numero, 'F-1', 'la más vencida va primero');
});

test('calcula la antigüedad y filtra por tramo y proveedor', () => {
  const datos = construir(documentos());
  const tramos = Object.fromEntries(datos.antiguedad.find(a => a.moneda === 'CRC').tramos.map(t => [t.tramo, t.saldo]));
  assert.equal(tramos['31–60 días'], 100000);
  assert.equal(tramos['Por vencer'], 60000);
  assert.deepEqual(construir(documentos(), { tramo: 'Por vencer' }).detalle.map(d => d.numero), ['F-2']);
  assert.equal(construir(documentos(), { q: 'llantas' }).detalle.length, 0);
});

test('el botón Pagar lleva al módulo de origen de cada factura', () => {
  assert.equal(enlacePago({ origen: 'TALLER', proveedorId: 7 }), '/compras/facturas?proveedor_id=7&pagada=0');
  assert.equal(enlacePago({ origen: 'PROVEEDURIA', portal: true, id: 12 }), '/proveeduria/portal-proveedores/facturas#portal-factura-12');
  assert.equal(enlacePago({ origen: 'PROVEEDURIA', id: 3 }), '/proveeduria/ordenes/3');
  assert.equal(enlacePago({ origen: 'CARBURACION' }), '/carburacion/facturas');
});

test('la pantalla muestra resumen, antigüedad, proveedores y la bandeja sin OC', async () => {
  const datos = construir(documentos());
  const html = await ejs.renderFile(path.join(__dirname, '../src/views/contabilidad/cuentas_por_pagar.ejs'), {
    ...datos, advertencias: [], totalDetalle: datos.detalle.length, sinOrdenTotal: datos.sinOrden.length, pagina: 1, paginas: 1, user: { rol: 'CONTABILIDAD' }
  });
  assert.match(html, /<h1>Cuentas por pagar<\/h1>/);
  assert.match(html, /Antigüedad de saldos/);
  assert.match(html, /Repuestos Uno/);
  assert.match(html, /Sin orden de compra/);
  assert.match(html, /href="\/compras\/facturas\?proveedor_id=7&amp;pagada=0"/);
  assert.doesNotMatch(html, /F-3/, 'la factura pagada no aparece');
});

test('solo Contabilidad y Administración pueden abrir la pantalla', async () => {
  const router = require('../src/routes/cuentasPorPagar.routes');
  const guardia = router.stack[0].handle;
  const probar = rol => new Promise(resolve => {
    const res = { status(c) { return { send: () => resolve(c) }; }, set() {}, locals: {}, redirect: () => resolve(302) };
    guardia({ session: { user: { rol } } }, res, () => resolve(200));
  });
  assert.equal(await probar('MECANICO'), 403);
  assert.equal(await probar('CONTABILIDAD'), 200);
  assert.equal(await probar('ADMIN'), 200);
});
