const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const s = require('../src/utils/ciberseguridad');
const { requireAdministracion } = require('../src/middleware/requireAdministracion');
async function servir(app, ejecutar) {
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  try { await ejecutar(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
}
test('clasifica rechazos reales sin registrar credenciales, consultas o solicitudes normales', () => {
  const req = { ip: '192.0.2.1', path: '/login', baseUrl: '', route: { path: '/login' }, body: { usuario: '123456789', password: 'privada', pin: 'secreto' }, originalUrl: '/login?token=oculto', headers: { 'x-forwarded-for': 'falso' } };
  const ahora = new Date('2026-10-20T12:01:00Z');
  assert.equal(s.clasificar(req, { statusCode: 200 }), null);
  assert.equal(s.clasificar({ ...req, ciberLoginFallido: true }, { statusCode: 500 }), null);
  const fallo = s.clasificar({ ...req, ciberLoginFallido: true }, { statusCode: 200 }, ahora);
  assert.equal(fallo.tipo, 'LOGIN_FALLIDO'); assert.equal(fallo.gravedad, 'Baja'); assert.equal(fallo.usuario, 'Sin sesión');
  assert.doesNotMatch(JSON.stringify(fallo), /123456789|privada|secreto|oculto|falso/);
  assert.equal(s.clasificar(req, { statusCode: 429 }, ahora).gravedad, 'Alta');
  assert.equal(s.clasificar(req, { statusCode: 403 }, ahora).tipo, 'ACCESO_DENEGADO');
  assert.equal(s.clasificar({ ...req, ciberLoginFallido: true }, { statusCode: 200 }, new Date('2026-10-20T12:14:59Z')).huella, fallo.huella);
  assert.notEqual(s.clasificar({ ...req, ciberLoginFallido: true }, { statusCode: 200 }, new Date('2026-10-20T12:15:00Z')).huella, fallo.huella);
});
test('middleware observa bloqueos HTTP y fallos login sin interrumpir las respuestas', async () => {
  const writes = [], db = { query: async (sql, args) => { writes.push({ sql, args }); } };
  const registrar = s.registrarSeguridad(db);
  const app = express(); app.use(registrar);
  app.post('/login', (req, res) => { req.ciberLoginFallido = true; res.send('credenciales incorrectas'); });
  app.get('/privado', (_req, res) => res.sendStatus(403));
  app.get('/limite', (_req, res) => res.sendStatus(429));
  app.get('/normal', (_req, res) => res.send('ok'));
  await servir(app, async base => {
    await fetch(base + '/login', { method: 'POST' }); await fetch(base + '/privado'); await fetch(base + '/limite'); await fetch(base + '/normal');
    await registrar.esperar();
    assert.equal(writes.length, 3); assert.deepEqual(writes.map(w => w.args[1]), ['LOGIN_FALLIDO', 'ACCESO_DENEGADO', 'LIMITE_INTENTOS']);
    assert.ok(writes.every(w => /ON DUPLICATE KEY UPDATE intentos=intentos\+1/.test(w.sql)));
  });
});
test('cola acotada y errores de almacenamiento se informan sin rechazar requests', async () => {
  let liberar, avisos = 0;
  const db = { query: () => new Promise((_, reject) => { liberar = () => reject(Error('base caída')); }) };
  const registrar = s.registrarSeguridad(db, { maxPendientes: 1, avisar: () => avisos++ });
  const req = { ip: '192.0.2.2', path: '/privado' };
  const responder = () => { const res = new EventEmitter(); res.statusCode = 403; let sigue = false; registrar(req, res, () => { sigue = true; }); res.emit('finish'); assert.equal(sigue, true); };
  responder(); await Promise.resolve(); responder(); liberar(); await registrar.esperar();
  assert.deepEqual(s.estadoRegistro(db), { fallos: 1, descartados: 1 }); assert.equal(avisos, 1);
});
test('períodos corresponden al calendario Costa Rica incluso cerca de medianoche', () => {
  const f = s.filtros({ dias: '7' }, new Date('2026-10-21T03:00:00Z'));
  assert.equal(f.hasta, '2026-10-20'); assert.equal(f.desde, '2026-10-14');
  for (const q of [{ dias: 'abc' }, { dias: '1' }, { gravedad: 'X' }, { pagina: '-1' }, { pagina: '1.1' }, { dias: ['7', '30'] }]) assert.throws(() => s.filtros(q), /Filtro/);
});
test('resumen real agrega intentos, completa días vacíos y entrega solo la página solicitada', async () => {
  const queries = [];
  const db = { query: async (sql, args) => {
    queries.push({ sql, args });
    if (sql.includes('COUNT(*)')) return [[{ grupos: 13, total: '22', bloqueados: '12', pendientes: '10', resueltos: '3' }]];
    if (sql.includes('GROUP BY DATE_FORMAT')) return [[{ fecha: '2026-10-20', detectados: '22', bloqueados: '12' }]];
    if (sql.includes('GROUP BY tipo')) return [[{ tipo: 'LOGIN_FALLIDO', total: '10' }, { tipo: 'LIMITE_INTENTOS', total: '12' }]];
    if (sql.includes('OFFSET')) return [[{ id: 13, tipo: 'LIMITE_INTENTOS', intentos: '12', version: 1 }]];
    if (sql.includes('ciberseguridad_config')) return [[{ inicio: '2026-10-20T08:00:00-06:00' }]];
    throw Error(sql);
  } };
  const d = await s.resumenReal(db, s.filtros({ dias: '7', pagina: '1', gravedad: 'Alta' }, new Date('2026-10-20T18:00:00Z')));
  assert.equal(d.demo, false); assert.equal(d.total, 22); assert.equal(d.grupos, 13); assert.equal(d.resueltos, 3);
  assert.equal(d.tendencia.length, 7); assert.equal(d.tendencia[0].detectados, 0);
  assert.equal(d.tendencia.reduce((n, r) => n + r.detectados, 0), d.total);
  assert.equal(d.tipos.reduce((n, r) => n + r.total, 0), d.total);
  assert.equal(d.incidentes[0].tipo, 'Límite de intentos'); assert.equal(d.incidentes[0].id, '13');
  assert.equal(queries.find(q => q.sql.includes('OFFSET')).args.at(-1), 12);
  assert.ok(queries.slice(0, 4).every(q => q.args.includes('Alta')));
});
test('cambio de estado y nota son atómicos; conflictos y fallos hacen rollback', async () => {
  for (const modo of ['ok', 'conflicto', 'fallo']) {
    const acciones = [];
    const conn = { beginTransaction: async () => acciones.push('begin'), query: async (sql, args) => {
      if (sql.startsWith('UPDATE')) { acciones.push('update'); assert.deepEqual(args, ['Resuelto', '1', 2]); return [{ affectedRows: modo === 'conflicto' ? 0 : 1 }]; }
      acciones.push('nota'); assert.equal(args[1], 7); if (modo === 'fallo') throw Error('DB'); return [{}];
    }, commit: async () => acciones.push('commit'), rollback: async () => acciones.push('rollback'), release: () => acciones.push('release') };
    const db = { getConnection: async () => conn };
    const operacion = s.cambiarEstado(db, '1', { estado: 'Resuelto', nota: 'Revisado con el usuario', version: 2 }, 7);
    if (modo === 'ok') { await operacion; assert.deepEqual(acciones, ['begin', 'update', 'nota', 'commit', 'release']); }
    else { await assert.rejects(operacion); assert.ok(acciones.includes('rollback')); assert.ok(!acciones.includes('commit')); }
  }
  await assert.rejects(s.cambiarEstado({}, '1', { estado: 'Resuelto', nota: 'x', version: 1 }, 7), { status: 400 });
});
test('CSV neutraliza fórmulas y falla explícitamente si excede el límite', async () => {
  assert.equal(s.celdaCSV('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  const db = { query: async () => [Array(10001).fill({})] };
  await assert.rejects(s.exportar(db, s.filtros()), { status: 400 });
});
test('rutas reales protegen lectura, CSV y seguimiento; errores no devuelven muestras', async () => {
  let llamados = 0;
  const servicio = { resumenReal: async () => { llamados++; return { demo: false, total: 0 }; }, seguimiento: async () => [], exportar: async () => 'csv', cambiarEstado: async () => {} };
  const app = express(); app.use(express.json()); app.set('view engine', 'ejs'); app.set('views', path.resolve(__dirname, '../src/views'));
  app.use((req, _res, next) => { req.session = { user: req.get('x-user') === 'none' ? null : { id: Number(req.get('x-user') || 1), usuario: '<admin>', rol: 'ADMIN', departamentoActivo: req.get('x-area') || 'ADMINISTRACION' } }; next(); });
  app.use('/admin/ciberseguridad', require('../src/routes/ciberseguridad.routes').crearRouter({}, requireAdministracion({}, async u => u.id === 1), servicio));
  await servir(app, async base => {
    const url = base + '/admin/ciberseguridad';
    for (const ruta of ['', '/datos', '/exportar.csv', '/1/seguimiento']) for (const headers of [{ 'x-user': 'none' }, { 'x-user': '2' }, { 'x-area': 'TALLER' }]) assert.ok([401, 403].includes((await fetch(url + ruta, { headers })).status));
    assert.equal((await fetch(url + '/1/seguimiento', { method: 'POST', headers: { 'x-area': 'TALLER', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal(llamados, 0);
    const res = await fetch(url); assert.match(await res.text(), /EVENTOS REALES/); assert.match(res.headers.get('cache-control'), /no-store/);
    assert.equal((await (await fetch(url + '/datos')).json()).demo, false);
    assert.equal((await fetch(url + '/datos?dias=abc')).status, 400);
    assert.equal((await fetch(url + '/foo/seguimiento')).status, 400);
    servicio.resumenReal = async () => { throw Error('SQL secreto'); };
    const error = await fetch(url + '/datos'); assert.equal(error.status, 503); assert.doesNotMatch(await error.text(), /SQL secreto/);
  });
});
