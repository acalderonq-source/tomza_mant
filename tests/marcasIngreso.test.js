const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const marcas = require('../src/utils/marcasIngreso');
const { crearRouter } = require('../src/routes/marcasIngreso.routes');
const jpeg = fs.readFileSync(path.join(__dirname, '../public/img/logo_tomza.jpg'));
test('administrador consulta desde Taller y Administracion sin permiso de marcar', async () => {
  const db = { query: async () => { throw Error('No debe depender de la lista de trabajadores'); } };
  for (const departamentoActivo of ['TALLER','ADMINISTRACION']) assert.deepEqual(await marcas.permisosMarcas(db, {rol:'ADMIN',departamentoActivo}), {marcar:false,consultar:true});
  assert.deepEqual(await marcas.permisosMarcas(db, {rol:'ADMIN',departamentoActivo:'CONTABILIDAD'}), {marcar:false,consultar:false});
  const {puedeAbrirRutaPorDepartamento:puede}=require('../src/utils/departamentos');
  assert.equal(puede('ADMINISTRACION','/marcas-ingreso/historial','ADMIN','GET'),true);
  assert.equal(puede('ADMINISTRACION','/marcas-ingreso/registrar','ADMIN','POST'),false);
});
function fotoDistinta(text) { const comentario = Buffer.from(text); const len = Buffer.alloc(2); len.writeUInt16BE(comentario.length + 2); return Buffer.concat([jpeg.subarray(0, -2), Buffer.from([0xff, 0xfe]), len, comentario, jpeg.subarray(-2)]); }
function fixture() {
  const rows = [], permisos = new Map([[52, { puede_marcar: 1, puede_consultar: 0 }], [2, { puede_marcar: 0, puede_consultar: 1 }]]);
  let wait = Promise.resolve(), seq = 0;
  async function query(sql, args = []) {
    if (sql.startsWith('SELECT puede_')) return [[permisos.get(Number(args[0]))].filter(Boolean)];
    if (sql.startsWith('SELECT usuario_id')) return [[permisos.get(Number(args[0]))?.puede_marcar ? { usuario_id: args[0] } : null].filter(Boolean)];
    if (sql.startsWith('INSERT')) {
      if (rows.some(r => r.reto === args[6] || (r.usuario_id === args[0] && r.sha === args[5]))) throw Object.assign(Error('duplicado'), { code: 'ER_DUP_ENTRY' });
      rows.push({ id: ++seq, usuario_id: args[0], nombre: args[1], tipo: args[2], foto: args[3], sha: args[5], reto: args[6], fecha_utc: '2026-10-20T14:30:00.000000Z' });
      return [{ insertId: seq }];
    }
    if (sql.startsWith('SELECT foto')) return [rows.filter(r => r.id === Number(args[0]) && (args.length === 1 || r.usuario_id === Number(args[1]))).map(r => ({ foto: r.foto }))];
    if (sql.startsWith('SELECT COUNT')) return [[{ total: rows.length }]];
    if (sql.includes('WHERE usuario_id=?')) { const found = rows.filter(r => r.usuario_id === args[0]).slice().reverse(); return [sql.includes('LIMIT 1') ? found.slice(0, 1) : found.slice(0, 20)]; }
    return [rows.slice().reverse()];
  }
  return { query, rows, permisos, async getConnection() {
    let unlock;
    return { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() { unlock?.(); },
      async query(sql, args) { if (sql.includes('FOR UPDATE')) { const previous = wait; wait = new Promise(r => { unlock = r; }); await previous; } return query(sql, args); } };
  } };
}
test('marcas: retos son de sesion, recientes y de un tipo/usuario concreto', () => {
  const r = marcas.nuevoReto(52, 'ENTRADA', 1000);
  assert.equal(r.token.length, 64); assert.notEqual(r.token, r.guardado.hash);
  assert.doesNotThrow(() => marcas.verificarReto(r.guardado, r.token, 52, 'ENTRADA', 1001));
  for (const [user, tipo, now, token] of [[2, 'ENTRADA', 1001, r.token], [52, 'SALIDA', 1001, r.token], [52, 'ENTRADA', 121000, r.token], [52, 'ENTRADA', 1001, 'x']]) assert.throws(() => marcas.verificarReto(r.guardado, token, user, tipo, now));
});
test('marcas: foto JPEG valida, limite, formato y rango de fechas', () => {
  assert.equal(marcas.validarFoto(jpeg.toString('base64')).tamanio, jpeg.length);
  for (const value of ['', null, 'data:image/jpeg;base64,' + jpeg.toString('base64'), Buffer.from('<svg>foto</svg>').toString('base64'), 'A'.repeat(1400000)]) assert.throws(() => marcas.validarFoto(value));
  assert.deepEqual(marcas.filtrosHistorial({}, '2026-10-20'), { desde: '2026-10-20', hasta: '2026-10-20', pagina: 1 });
  for (const q of [{ desde: '2026-02-30' }, { desde: '2026-12-01', hasta: '2026-10-20' }, { desde: '2020-01-01', hasta: '2026-10-20' }, { pagina: '-1' }]) assert.throws(() => marcas.filtrosHistorial(q));
});
test('marcas: serializa doble entrada, conserva servidor UTC y evita repetir foto/reto', async () => {
  const db = fixture(), user = { id: 52, nombre: 'Saul' }, foto = marcas.validarFoto(jpeg.toString('base64'));
  const results = await Promise.allSettled([marcas.registrarMarca(db, user, 'ENTRADA', foto, 'a'.repeat(64)), marcas.registrarMarca(db, user, 'ENTRADA', foto, 'b'.repeat(64))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(db.rows.length, 1);
  assert.equal(marcas.siguienteTipo(await marcas.ultimaMarca(db, 52)), 'SALIDA');
  await assert.rejects(() => marcas.registrarMarca(db, user, 'SALIDA', foto, 'c'.repeat(64)), { status: 409 });
  await marcas.registrarMarca(db, user, 'SALIDA', marcas.validarFoto(fotoDistinta('salida').toString('base64')), 'd'.repeat(64));
  assert.equal(db.rows.length, 2); assert.equal(marcas.siguienteTipo(await marcas.ultimaMarca(db, 52)), 'ENTRADA');
  db.permisos.get(52).puede_marcar = 0;
  await assert.rejects(() => marcas.registrarMarca(db, user, 'ENTRADA', foto, 'e'.repeat(64)), { status: 403 });
});
test('marcas HTTP: solo Saul registra; consulta restringida y fotos privadas', async () => {
  const db = fixture(), sesiones = new Map();
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '../src/views')); app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => {
    const id = Number(req.get('x-test-user'));
    if (!sesiones.has(id)) sesiones.set(id, { user: id ? { id, usuario: 'prueba', nombre: 'Persona', departamentoActivo: 'TALLER' } : null });
    req.session = sesiones.get(id); if (req.session.user && id===1) req.session.user.rol='ADMIN'; next();
  });
  app.use('/marcas-ingreso', crearRouter(db));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port + '/marcas-ingreso';
  const get = (url, id = 52) => fetch(base + url, { headers: { 'x-test-user': String(id) } });
  const post = (url, body, id = 52) => fetch(base + url, { method: 'POST', headers: { 'x-test-user': String(id), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await get('/', 0)).status, 401); assert.equal((await get('/', 3)).status, 403);
    const reloj = await (await get('/')).text(); assert.ok(reloj.includes('camara-video')); assert.ok(!reloj.includes('type="file"'));
    assert.equal((await get('/historial')).status, 403);
    assert.equal((await get('/historial', 1)).status, 200);
    assert.equal((await post('/reto', {}, 1)).status, 403);
    sesiones.get(1).user.departamentoActivo='ADMINISTRACION';
    assert.equal((await get('/historial', 1)).status, 200);
    assert.equal((await post('/registrar', {tipo:'ENTRADA'}, 1)).status, 403);
    assert.equal((await post('/reto', {}, 2)).status, 403);
    assert.equal((await post('/registrar', { tipo: 'ENTRADA', foto: jpeg.toString('base64') })).status, 409);
    const r = await (await post('/reto', {})).json();
    assert.equal((await post('/registrar', { token: r.token, tipo: 'ENTRADA', foto: jpeg.toString('base64'), usuario_id: 3, fecha: '2000-01-01' })).status, 201);
    assert.equal(db.rows[0].usuario_id, 52); assert.equal(db.rows[0].fecha_utc, '2026-10-20T14:30:00.000000Z');
    assert.equal((await post('/registrar', { token: r.token, tipo: 'ENTRADA', foto: jpeg.toString('base64') })).status, 409);
    const img = await get('/foto/1', 2); assert.equal(img.status, 200); assert.equal(img.headers.get('Content-Type'), 'image/jpeg'); assert.ok(img.headers.get('Cache-Control').includes('no-store'));
    assert.equal((await get('/foto/1', 1)).status, 200);
    assert.equal((await get('/foto/1', 3)).status, 403); assert.equal((await get('/foto/1', 0)).status, 401);
    assert.equal((await get('/historial?desde=2026-10-20&hasta=2026-10-20', 2)).status, 200);
    sesiones.get(52).user.departamentoActivo = 'PROVEEDURIA'; assert.equal((await get('/estado')).status, 403);
  } finally { await new Promise(r => server.close(r)); }
});
