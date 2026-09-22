const test = require('node:test');
const assert = require('node:assert/strict');

// In-memory query doubles: tests must never connect to the operational database.
let query;
let committed;
let rolledBack;
const statements = [];
const connection = {
  beginTransaction: async () => {},
  query: async (sql, params) => { statements.push({ sql, params }); return query(sql, params); },
  commit: async () => { committed = true; },
  rollback: async () => { rolledBack = true; },
  release: () => {}
};
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  getConnection: async () => connection,
  query: async (sql, params) => {
    if (/CREATE TABLE|ALTER TABLE/.test(sql)) return [{}];
    if (/UPDATE pagos_proveedor\s+SET (pagada = 1|periodo_cierre = DATE_FORMAT)/.test(sql)) return [{ affectedRows: 0 }];
    if (/INFORMATION_SCHEMA/i.test(sql)) return [[{ count: 1, numeric_scale: 4, numeric_precision: 14 }]];
    statements.push({ sql, params });
    return query(sql, params);
  }
} };
const router = require('../src/routes/compras.routes');
const data = { empresa: 'GAS TOMZA', fecha: '2026-09-22', monto: '100.10', proveedor: 'Prueba', numero_factura: '00100001010000340575', tipo_factura: 'ELECTRONICA' };
async function request(path, body = {}, params = {}, role = 'ADMIN') {
  const route = router.stack.find(layer => layer.route && [layer.route.path].flat().includes(path)).route;
  const req = { path, body, params, session: { user: { id: 1, rol: role } } };
  const result = { status: 200 };
  const res = { render: (view, locals) => { result.view = view; result.locals = locals; }, redirect: url => { result.redirect = url; }, status: code => { result.status = code; return res; }, send: value => { result.body = value; } };
  for (const layer of route.stack) {
    let allowed = false;
    await layer.handle(req, res, () => { allowed = true; });
    if (!allowed) break;
  }
  return { ...result, session: req.session };
}
test.beforeEach(() => { committed = false; rolledBack = false; statements.length = 0; query = async () => { throw new Error('Unexpected query'); }; });

test('accounting is read-only and mechanics cannot confirm receipts', async () => {
  for (const role of ['CONTABILIDAD', 'MECANICO']) {
    const response = await request('/facturas/caja-chica/electronicas/:id/confirmar', data, { id: 1 }, role);
    assert.equal(response.status, 403);
    assert.equal(statements.length, 0);
  }
});
test('confirmation locks an accepted unlinked invoice and preserves the consecutive', async () => {
  query = async sql => {
    if (/SELECT \*/.test(sql)) {
      assert.match(sql, /orden_compra_id IS NULL/);
      assert.match(sql, /ACEPTADA/);
      assert.match(sql, /FOR UPDATE/);
      return [[{ id: 1, moneda: 'CRC' }]];
    }
    if (/INSERT INTO caja_chica_documentos/.test(sql)) return [{ affectedRows: 1 }];
    throw new Error(sql);
  };
  const response = await request('/facturas/caja-chica/electronicas/:id/confirmar', data, { id: 1 });
  assert.equal(response.redirect, '/compras/facturas/caja-chica#preparar');
  assert.equal(committed, true);
  assert.equal(statements.at(-1).params[4], data.numero_factura);
});
test('duplicate electronic invoice rolls back and does not silently succeed', async () => {
  query = async sql => {
    if (/SELECT \*/.test(sql)) return [[{ id: 1, moneda: 'CRC' }]];
    throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
  };
  const result = await request('/facturas/caja-chica/electronicas/:id/confirmar', data, { id: 1 });
  assert.match(result.session.error, /ya fue confirmada/);
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
});
test('unlinked foreign-currency invoice cannot enter a CRC cash cut', async () => {
  query = async () => [[{ moneda: 'USD' }]];
  const result = await request('/facturas/caja-chica/electronicas/:id/confirmar', data, { id: 1 });
  assert.match(result.session.error, /colones/);
  assert.equal(committed, false);
});
test('cut persists both companies and only one reimbursement in the same transaction', async () => {
  query = async (sql, params) => {
    if (/SELECT \*/.test(sql)) {
      assert.match(sql, /FOR UPDATE/);
      return [[{ id: 1, empresa: 'GAS TOMZA', monto: '0.10' }, { id: 2, empresa: 'SUPER GAS', monto: '0.20' }]];
    }
    if (/INSERT INTO caja_chica_cortes/.test(sql)) { assert.deepEqual(params.slice(4, 7), [0.1, 0.2, 0.3]); return [{ insertId: 10 }]; }
    if (/INSERT INTO caja_chica_reintegros/.test(sql)) { assert.equal(params[1], 0.3); return [{ insertId: 20 }]; }
    if (/UPDATE caja_chica/.test(sql)) return [{ affectedRows: 1 }];
    throw new Error(sql);
  };
  const result = await request('/facturas/caja-chica/cortes', { fecha: '2026-09-22', base_caja: '900000', documento_ids: ['1', '2', '1'] });
  assert.equal(committed, true);
  assert.match(result.redirect, /#cortes$/);
  assert.equal(statements.filter(item => /INSERT INTO caja_chica_reintegros/.test(item.sql)).length, 1);
});
test('stale selection cannot close the same invoice twice', async () => {
  query = async sql => { assert.match(sql, /corte_id IS NULL/); return [[]]; };
  const result = await request('/facturas/caja-chica/cortes', { fecha: '2026-09-22', base_caja: '900000', documento_ids: ['1'] });
  assert.match(result.session.error, /otro corte/);
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
});
test('invoice acceptance is checked again before closing a cut', async () => {
  query = async sql => /FROM caja_chica_documentos/.test(sql)
    ? [[{ id: 1, factura_electronica_id: 1, empresa: 'GAS TOMZA', monto: '100' }]]
    : [[{ id: 1, estado_hacienda: 'RECHAZADA', moneda: 'CRC' }]];
  const result = await request('/facturas/caja-chica/cortes', { fecha: '2026-09-22', base_caja: '900000', documento_ids: ['1'] });
  assert.match(result.session.error, /cambi/);
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
});
test('closed documents cannot be edited or removed', async () => {
  query = async sql => { assert.match(sql, /corte_id IS NULL/); return [{ affectedRows: 0 }]; };
  for (const action of ['actualizar', 'eliminar']) {
    const result = await request(`/facturas/caja-chica/documentos/:id/${action}`, data, { id: 1 });
    assert.match(result.session.success, /corte cerrado/);
  }
});

test('manual order linking rejects an invoice reserved for petty cash', async () => {
  query = async sql => {
    if (/FROM ordenes_compra/.test(sql)) return [[{ id: 8, po_numero: 'TEST-8' }]];
    if (/FROM facturas_electronicas_cruce/.test(sql)) return [[{ id: 1 }]];
    if (/FROM caja_chica_documentos/.test(sql)) { assert.match(sql, /FOR UPDATE/); return [[{ id: 5 }]]; }
    throw new Error(sql);
  };
  const result = await request('/ordenes/:id/electronica/enlazar', { factura_electronica_id: 1 }, { id: 8 });
  assert.match(result.session.error, /reservada para caja chica/);
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
});

test('cash import does not auto-link orders or assume fiscal acceptance', async () => {
  query = async sql => {
    if (/SELECT id FROM facturas_electronicas_cruce/.test(sql)) return [[]];
    if (/INSERT INTO facturas_electronicas_cruce/.test(sql)) return [{ affectedRows: 1 }];
    throw new Error(sql);
  };
  const result = await request('/facturas/caja-chica/importar', {
    return_to: '/compras/facturas/caja-chica',
    facturas_electronicas_texto: 'Fecha\tClave\tConsecutivo\tNombre emisor\tMonto total\n22/09/2026\t506' + '0'.repeat(47) + '\t00100001010000340575\tProveedor Prueba\t100.10'
  });
  assert.equal(committed, true);
  assert.equal(result.redirect, '/compras/facturas/caja-chica');
  const insert = statements.find(item => /INSERT INTO facturas_electronicas_cruce/.test(item.sql));
  assert.equal(insert.params[7], 'PENDIENTE');
  assert.equal(insert.params[14], null);
});

for (const tipo of ['ELECTRONICA', 'SIMPLIFICADO']) {
  test(`manual ${tipo} invoice is independent from orders and imported invoices`, async () => {
    query = async (sql, params) => {
      assert.match(sql, /INSERT INTO caja_chica_documentos/);
      assert.doesNotMatch(sql, /factura_electronica_id|orden_compra_id|facturas_electronicas_cruce/);
      assert.equal(params[3], data.numero_factura);
      assert.equal(params[8], tipo);
      return [{ affectedRows: 1 }];
    };
    const result = await request('/facturas/caja-chica/documentos/manual', { ...data, tipo_factura: tipo });
    assert.match(result.session.success, /agregada/);
    assert.equal(statements.length, 1);
    assert.match(result.redirect, /#preparar$/);
  });
}
test('editing a manually entered invoice preserves its selected type', async () => {
  query = async (sql, params) => {
    assert.match(sql, /CASE WHEN factura_electronica_id IS NULL/);
    assert.equal(params[8], 'ELECTRONICA');
    return [{ affectedRows: 1 }];
  };
  const result = await request('/facturas/caja-chica/documentos/:id/actualizar', data, { id: 1 });
  assert.equal(result.session.success, 'Factura actualizada.');
});
test('cash screen no longer queries or preloads imported invoice listings', async () => {
  query = async sql => {
    assert.doesNotMatch(sql, /FROM facturas_electronicas_cruce/);
    return [[]];
  };
  const result = await request('/facturas/caja-chica');
  assert.equal(result.view, 'compras/caja_chica');
  assert.equal(result.locals.cajaChica.facturasElectronicasPendientes, undefined);
});
