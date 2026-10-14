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
  assert.equal(update.params[0], 96.21);
  const movement = writes.find(item => /INSERT/.test(item.sql));
  assert.deepEqual(movement.params, [1, null, 'Guapiles', 3.79, 'Relleno de aceite - Nivel bajo', null, null, 1]);
  assert.equal(update.params[0], available - movement.params[3]);
});
test('shared San Carlos inventory consumes Guapiles stock without a vehicle', async () => {
  const result = await fill({ sede: 'San Carlos', galones_usados: '0,5' }, { id: 2, rol: 'MECANICO', usuario: 'mecanico_guapiles' });
  assert.equal(committed, true);
  assert.equal(result.status, 200);
  assert.ok(reads[0].params[0].includes('Guapiles'));
  assert.ok(reads[0].params[0].includes('San Carlos'));
  assert.equal(writes.at(-1).params[2], 'Guapiles');
});
test('ACEITE LIMON is an independent oil inventory site', async () => {
  const result = await fill({ sede: 'ACEITE LIMON', galones_usados: '1' });
  assert.equal(result.status, 200);
  assert.equal(committed, true);
  assert.deepEqual(reads[0].params, [['ACEITE LIMON']]);
  assert.equal(writes.at(-1).params[2], 'ACEITE LIMON');
  assert.match(result.session.success, /ACEITE LIMON/);
});
test('only Limón oil users can see their independent oil inventory', async () => {
  const result = await fill(
    { sede: 'ACEITE LIMON', galones_usados: '1' },
    { id: 2, rol: 'MECANICO', usuario: 'mecanico_rio_claro' }
  );
  assert.equal(result.status, 403);
  assert.equal(connected, false);
  assert.equal(writes.length, 0);
});
test('Limón mechanic can register a fill against ACEITE LIMON', async () => {
  const result = await fill(
    { sede: 'ACEITE LIMON', galones_usados: '1' },
    { id: 4, rol: 'MECANICO', usuario: 'mecanico_limon' }
  );
  assert.equal(result.status, 200);
  assert.equal(committed, true);
  assert.equal(writes.at(-1).params[2], 'ACEITE LIMON');
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
test('bodeguero can allocate a fill to a selected unit plate', async () => {
  await fill({ unidad_id: '7', galones_usados: '1' });
  assert.equal(committed, true);
  assert.deepEqual(writes.at(-1).params.slice(5, 7), [7, 'C174021']);
});
test('supervisors cannot record oil fills', async () => {
  const result = await fill({ sede: 'Guapiles', galones_usados: '1' }, { id: 3, usuario: 'supervisor', rol: 'SUPERVISOR' });
  assert.equal(result.status, 403);
  assert.equal(connected, false);
});
test('rendered fill form supports an optional plate and requires a site for general fills', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../src/views/aceite_listado.ejs'), {
    galonALitros: 3.78541, capacidadEstandar: 208.2, capacidadEstandarGalones: 55,
    etiquetaSede: value => value, etiquetaSedeInventario: value => value, grupoAceite: router.grupoAceite,
    estanones: [], movimientos: [], cambios: [], gastoPorPlaca: [], ordenesAceite: [], resumen: {},
    sedesGestion: ['Guapiles'], unidadesRelleno: [{ id: 7, placa: 'C174021', sede: 'Cabezales', sede_inventario: 'Transportadora' }],
    fechaHoy: '2026-09-22', puedeGestionar: true, user: bodeguero, success: '', error: ''
  });
  const form = html.match(/<form[^>]*action="\/aceite\/rellenos"[^>]*>[\s\S]*?<\/form>/)[0];
  assert.match(form, /name="sede"[^>]*required/);
  assert.match(form, /name="unidad_id"/);
  assert.match(form, /Sin placa · relleno general/);
  assert.match(form, /name="galones_usados"/);
  assert.match(form, /value="Guapiles"[^>]* selected/);
  assert.match(form, /name="destino"/);
});

test('oil destination separates transport and granel from cylinder inventories', () => {
  for (const sede of ['Transportadora', 'Cabezales', 'granel_alajuela', 'Granel', 'ACEITE LIMON']) assert.equal(router.grupoAceite(sede), 'TRANSPORTE');
  for (const sede of ['Cartago', 'Alajuela', 'Guapiles', 'Nicoya']) assert.equal(router.grupoAceite(sede), 'CILINDREROS');
});

test('a mismatching destination cannot consume oil for a site or a unit', async () => {
  assert.equal((await fill({ destino: 'TRANSPORTE', sede: 'Guapiles', galones_usados: '1' })).status, 400);
  assert.equal((await fill({ destino: 'CILINDREROS', unidad_id: '7', galones_usados: '1' })).status, 400);
  assert.equal(writes.length, 0);
  assert.equal(connected, false);
});

test('a cylinder fill uses its own site stock when the destination matches', async () => {
  await fill({ destino: 'CILINDREROS', sede: 'Guapiles', galones_usados: '1' });
  assert.equal(committed, true);
  assert.equal(writes.find(item => /INSERT/.test(item.sql)).params[2], 'Guapiles');
});

test('the oil change form offers destinations and their permitted units', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../src/views/aceite_nuevo.ejs'), {
    unidades: [{ id: 1, placa: 'C123456', sede: 'Cabezales' }, { id: 2, placa: 'C654321', sede: 'Guapiles' }],
    grupoAceite: router.grupoAceite, user: bodeguero
  });
  assert.match(html, /Granel \/ Transportadora/);
  assert.match(html, /Cilindreros/);
  assert.match(html, /value="1" data-destino="TRANSPORTE"/);
  assert.match(html, /value="2" data-destino="CILINDREROS"/);
});

test('drum detail displays the consumption breakdown and movement ledger', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../src/views/aceite_estanon_detalle.ejs'), {
    estanon: {
      id: 12, descripcion: 'Aceite 15W40', sede: 'Guapiles', fecha_compra_formato: '12/10/2026',
      estado: 'ACTIVO', litros_capacidad: 208.2, litros_restantes: 180, litros_entrada: 208.2,
      litros_consumidos: 28.2, cantidad_salidas: 2, monto_total: 100000
    },
    movimientos: [{
      id: 5, tipo: 'SALIDA', litros: 10, sede: 'Guapiles', descripcion: 'Relleno semanal',
      placa: 'C123456', fecha_formato: '12/10/2026 10:00', usuario_nombre: 'Bodeguero', gasto_estimado: 4803
    }],
    destinos: [{ placa: 'C123456', litros: 10, movimientos: 1, gasto: 4803 }],
    costoPorLitro: 480.3,
    gastoConsumido: 13544.46,
    etiquetaSede: value => value,
    galonALitros: 3.78541,
    user: bodeguero
  });
  assert.match(html, /Gasto consumido estimado/);
  assert.match(html, /C123456/);
  assert.match(html, /Relleno semanal/);
  assert.match(html, /Movimientos del estañón/);
});
