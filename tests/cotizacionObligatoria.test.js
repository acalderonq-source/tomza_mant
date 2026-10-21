const test = require('node:test');
const assert = require('node:assert/strict');

// La base de datos no debe tocarse: sin cotización la orden se rechaza antes.
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async () => { throw new Error('No debe consultar la base sin cotización'); },
  getConnection: async () => { throw new Error('No debe abrir conexión sin cotización'); },
  on: () => {}
} };

async function crear(router, ruta) {
  const handler = router.stack.find(l => l.route && l.route.path === ruta && l.route.methods.post).route.stack.at(-1).handle;
  const result = {};
  const res = { status(code) { result.status = code; return res; }, send(body) { result.body = body; } };
  await handler({ body: { proveedor_id: '1', lineas: [] }, session: { user: { id: 1, rol: 'ADMIN' } } }, res);
  return result;
}

test('Compras/Taller no crea una orden de compra sin la cotización adjunta', async () => {
  const response = await crear(require('../src/routes/compras.routes'), '/ordenes');
  assert.equal(response.status, 400);
  assert.match(response.body, /Adjunte el archivo de la cotización/);
});

test('Motores no crea una orden de compra sin la cotización adjunta', async () => {
  const response = await crear(require('../src/routes/ordenesMotor.routes'), '/');
  assert.equal(response.status, 400);
  assert.match(response.body, /Adjunte el archivo de la cotización/);
});
