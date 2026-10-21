const test = require('node:test');
const assert = require('node:assert/strict');

// Dobles en memoria: la prueba nunca toca la base de datos real.
let committed;
let rolledBack;
let released;
let failColilla;
const connStatements = [];
const connection = {
  beginTransaction: async () => {},
  query: async (sql, params) => {
    connStatements.push({ sql, params });
    if (/SELECT total, COALESCE\(nota_credito_monto/.test(sql)) return [[{ total: 1000, nota_credito_monto: 0, abono_monto: 0 }]];
    if (/UPDATE ordenes_compra/.test(sql)) return [{ affectedRows: 1 }];
    if (/FROM ordenes_compra o JOIN proveedores/.test(sql)) return [[{ po_numero: '2026-1', factura: 'F-1', total: 1000, comprobante_pago_archivo: null, proveedor_id: 7, proveedor_email: '', proveedor_nombre: 'Prueba' }]];
    if (/INSERT INTO colillas_pago_proveedor/.test(sql)) {
      if (failColilla) throw new Error('fallo al guardar colilla');
      return [{ insertId: 55 }];
    }
    throw new Error(`Consulta inesperada en la transacción: ${sql}`);
  },
  commit: async () => { committed = true; },
  rollback: async () => { rolledBack = true; },
  release: () => { released = true; }
};
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  getConnection: async () => connection,
  query: async sql => {
    if (/INFORMATION_SCHEMA/i.test(sql)) return [[{ count: 1, numeric_scale: 4, numeric_precision: 14 }]];
    if (/^\s*SELECT/i.test(sql)) return [[]];
    return [{ affectedRows: 0, insertId: 0 }];
  }
} };
const pdfPath = require.resolve('../src/utils/pdfReciboPago');
require.cache[pdfPath] = { id: pdfPath, filename: pdfPath, loaded: true, exports: { generarPDFReciboPago: async () => Buffer.from('%PDF-prueba') } };

const router = require('../src/routes/compras.routes');

async function pagar(body) {
  const route = router.stack.find(layer => layer.route && layer.route.path === '/facturas/:id/pagar').route;
  const req = { body, params: { id: '3' }, session: { user: { id: 1, rol: 'ADMIN', usuario: 'admin' } }, get: () => '' };
  const result = { headers: {} };
  const res = {
    redirect: url => { result.redirect = url; },
    status: code => { result.status = code; return res; },
    type: () => res,
    send: value => { result.body = value; },
    setHeader: (name, value) => { result.headers[name] = value; },
    end: value => { result.body = value; }
  };
  for (const layer of route.stack) {
    let next = false;
    await layer.handle(req, res, () => { next = true; });
    if (!next) break;
  }
  return { ...result, session: req.session };
}

test.beforeEach(() => { committed = false; rolledBack = false; released = false; failColilla = false; connStatements.length = 0; });

test('el pago individual genera la colilla y confirma pago y colilla juntos', async () => {
  const response = await pagar({ tipo: 'orden', fecha_pago: '2026-10-21', comprobante_numero: 'TRF-1' });
  assert.equal(response.session.error, undefined);
  assert.equal(response.headers['Content-Type'], 'application/pdf');
  assert.ok(Buffer.isBuffer(response.body));
  assert.equal(committed, true);
  assert.equal(rolledBack, false);
  assert.equal(released, true);
  assert.ok(connStatements.some(s => /UPDATE ordenes_compra/.test(s.sql)));
  assert.ok(connStatements.some(s => /INSERT INTO colillas_pago_proveedor/.test(s.sql)));
  assert.match(connStatements[0].sql, /FOR UPDATE/);
});

test('si la colilla falla, el pago se revierte y la factura no queda pagada', async () => {
  failColilla = true;
  const response = await pagar({ tipo: 'orden', fecha_pago: '2026-10-21' });
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  assert.equal(released, true);
  assert.equal(response.redirect, '/compras/facturas');
  assert.match(response.session.error, /Error interno/);
});

test('un tipo de factura inválido no abre transacción', async () => {
  const response = await pagar({ tipo: 'otro', fecha_pago: '2026-10-21' });
  assert.equal(response.session.error, 'Tipo de factura inválido.');
  assert.equal(connStatements.length, 0);
});
