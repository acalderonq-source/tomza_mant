const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const path = require('node:path');

let available;
let committed;
let rolledBack;
let connected;
const writes = [];
const reads = [];
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql, params) => {
    if (/CREATE TABLE/.test(sql)) return [{}];
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ count: 1 }]];
    if (/SELECT id, placa, sede FROM unidades/.test(sql)) return [[{ id: 7, placa: 'C174021', sede: 'Cabezales' }]];
    if (/SELECT.*sede|SELECT DISTINCT sede/s.test(sql)) return [[{ sede: 'Guapiles' }, { sede: 'San Carlos' }, { sede: 'Transportadora' }, { sede: 'Rio Claro' }]];
    throw new Error(`Unexpected query: ${sql}`);
  },
  getConnection: async () => {
    connected = true;
    return {
      beginTransaction: async () => {},
      query: async (sql, params) => {
        if (/SELECT id, litros_restantes/.test(sql)) {
          reads.push({ sql, params });
          return [[{ id: 1, litros_restantes: available }]];
        }
        if (/UPDATE aceite_estanones|INSERT INTO aceite_movimientos/.test(sql)) { writes.push({ sql, params }); return [{ affectedRows: 1 }]; }
        throw new Error(`Unexpected transactional query: ${sql}`);
      },
      commit: async () => { committed = true; },
      rollback: async () => { rolledBack = true; },
      release: () => {}
    };
  }
} };
const router = require('../src/routes/aceite.routes');
const handler = router.stack.find(layer => layer.route?.path === '/rellenos').route.stack.at(-1).handle;
const bodeguero = { id: 1, rol: 'BODEGUERO', usuario: 'bodeguero' };
async function fill(body, user = bodeguero) {
  const req = { body, session: { user } };
  const result = { status: 200 };
  const res = { status: code => { result.status = code; return res; }, send: value => { result.body = value; }, redirect: url => { result.redirect = url; } };
  await handler(req, res);
  return { ...result, session: req.session };
}
test.beforeEach(() => { available = 100; committed = false; rolledBack = false; connected = false; writes.length = 0; reads.length = 0; });

test('a fill without a plate deducts stock and stores null vehicle identifiers', async () => {
  const result = await fill({ sede: 'Guapiles', galones_usados: '1', observaciones: 'Nivel bajo' });
  assert.equal(committed, true);
  assert.match(result.session.success, /sin placa/);
  assert.match(reads[0].sql, /FOR UPDATE/);
  const update = writes.find(item => /UPDATE/.test(item.sql));
  assert.equal(update.params[0], 100 - 3.78541);
  const movement = writes.find(item => /INSERT/.test(item.sql));
  assert.deepEqual(movement.params, [1, null, 'Guapiles', 3.78541, 'Relleno de aceite - Nivel bajo', null, null, 1]);
});
test('shared San Carlos inventory consumes Guapiles stock without a vehicle', async () => {
  const result = await fill({ sede: 'San Carlos', galones_usados: '0,5' }, { id: 2, rol: 'MECANICO', usuario: 'mecanico_guapiles' });
  assert.equal(committed, true);
  assert.equal(result.status, 200);
  assert.ok(reads[0].params[0].includes('Guapiles'));
  assert.ok(reads[0].params[0].includes('San Carlos'));
  assert.equal(writes.at(-1).params[2], 'Guapiles');
});
test('Granel and Transportadora keep their shared inventory', async () => {
  await fill({ sede: 'granel_guapiles', galones_usados: '1' });
  assert.equal(committed, true);
  assert.equal(writes.at(-1).params[2], 'Transportadora');
  assert.ok(reads[0].params[0].includes('Cabezales'));
});
test('site permissions remain enforced without a plate', async () => {
  const result = await fill({ sede: 'Transportadora', galones_usados: '1' }, { id: 2, rol: 'MECANICO', usuario: 'mecanico_rio_claro' });
  assert.equal(result.status, 403);
  assert.equal(connected, false);
  assert.equal(writes.length, 0);
});
test('missing sites and invalid quantities do not change inventory', async () => {
  for (const body of [{ galones_usados: '1' }, { sede: 'Guapiles', galones_usados: '0' }, { sede: 'Guapiles', galones_usados: '-1' }, { sede: 'Guapiles', galones_usados: 'NaN' }]) {
    const result = await fill(body);
    assert.ok(result.session.error);
    assert.equal(connected, false);
  }
});
test('insufficient oil rolls back without recording the fill', async () => {
  available = 1;
  const result = await fill({ sede: 'Guapiles', galones_usados: '2' });
  assert.match(result.session.error, /suficiente aceite/);
  assert.equal(rolledBack, true);
  assert.equal(committed, false);
  assert.equal(writes.length, 0);
});
test('older forms with a unit still allocate the fill to its plate', async () => {
  await fill({ unidad_id: '7', galones_usados: '1' });
  assert.equal(committed, true);
  assert.deepEqual(writes.at(-1).params.slice(5, 7), [7, 'C174021']);
});
test('supervisors cannot record oil fills', async () => {
  const result = await fill({ sede: 'Guapiles', galones_usados: '1' }, { id: 3, usuario: 'supervisor', rol: 'SUPERVISOR' });
  assert.equal(result.status, 403);
  assert.equal(connected, false);
});
test('rendered fill form requires a site and quantity but has no plate input', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../src/views/aceite_listado.ejs'), {
    galonALitros: 3.78541, capacidadEstandar: 208.2, capacidadEstandarGalones: 55,
    etiquetaSede: value => value, etiquetaSedeInventario: value => value,
    estanones: [], movimientos: [], cambios: [], gastoPorPlaca: [], ordenesAceite: [], resumen: {},
    sedesGestion: ['Guapiles'], fechaHoy: '2026-09-22', puedeGestionar: true, user: bodeguero, success: '', error: ''
  });
  const form = html.match(/<form[^>]*action="\/aceite\/rellenos"[^>]*>[\s\S]*?<\/form>/)[0];
  assert.match(form, /name="sede"[^>]*required/);
  assert.match(form, /name="galones_usados"/);
  assert.doesNotMatch(form, /name="unidad_id"|data-placa/);
  assert.match(form, /value="Guapiles" selected/);
});
