const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { validarDatos, validarImagen, idValido, MAX_BYTES } = require('../src/utils/noticiasInicio');
const { crearRouters } = require('../src/routes/noticiasInicio.routes');
const { requireAdministracion } = require('../src/middleware/requireAdministracion');
const { ensureCsrfToken } = require('../src/middleware/security');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSLsAAAAASUVORK5CYII=';
test('noticias: valida titulo, orden, estado, ids y contenido real de imagen', () => {
  assert.deepEqual(validarDatos({ titulo: ' Noticias ', orden: '2', activa: '1' }), { titulo: 'Noticias', orden: 2, activa: 1 });
  assert.equal(validarDatos({ titulo: 'Oculta' }).activa, 0);
  for (const body of [{}, { titulo: 'x'.repeat(121) }, { titulo: 'x', orden: -1 }, { titulo: 'x', orden: 1.5 }, { titulo: 'x', activa: 'false' }]) assert.throws(() => validarDatos(body));
  assert.equal(validarImagen(PNG).mime, 'image/png');
  for (const value of ['', null, Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'), 'data:image/png;base64,' + PNG, PNG + '!', 'A'.repeat(Math.ceil(MAX_BYTES / 3) * 4 + 4)]) assert.throws(() => validarImagen(value));
  for (const id of ['0', '-1', '1x', '1 OR 1=1', '2147483648']) assert.equal(idValido(id), false);
  assert.equal(idValido('12'), true);
});
test('noticias: acceso interno, propietario, CSRF, publicar, desactivar y eliminar', async () => {
  const rows = new Map(); let seq = 0, writes = 0;
  const db = { async query(sql, args = []) {
    if (sql.startsWith('INSERT')) { const [titulo, orden, activa, mime, imagen] = args; rows.set(++seq, { id: seq, titulo, orden, activa, mime, imagen }); writes++; return [{ insertId: seq }]; }
    if (sql.startsWith('UPDATE')) { const [titulo, orden, activa, id] = args; const row = rows.get(id); if (row) Object.assign(row, { titulo, orden, activa }); writes++; return [{ affectedRows: row ? 1 : 0 }]; }
    if (sql.startsWith('DELETE')) { writes++; return [{ affectedRows: rows.delete(args[0]) ? 1 : 0 }]; }
    if (sql.startsWith('SELECT mime')) { const row = rows.get(args[0]); return [[row && (!sql.includes('activa=1') || row.activa) ? row : undefined].filter(Boolean)]; }
    return [Array.from(rows.values()).filter(r => !sql.includes('activa=1') || r.activa).map(({ id, titulo, orden, activa }) => ({ id, titulo, orden, activa }))];
  } };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const rol = req.get('x-test-role'); req.session = { csrfToken: 'token-test', user: rol ? { id: rol === 'ADMIN' ? 1 : 2, rol, departamentoActivo: req.get('x-test-area') || 'ADMINISTRACION' } : null }; next(); });
  app.use(ensureCsrfToken);
  const router = crearRouters(db, requireAdministracion(db, async user => user.id === 1));
  app.use('/inicio/noticias', router.lectura); app.use('/admin/noticias', router.administracion);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = { 'x-test-role': 'ADMIN', 'x-csrf-token': 'token-test', 'Content-Type': 'application/json' };
  const post = (url, body, h = headers) => fetch(base + url, { method: 'POST', headers: h, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(base + '/inicio/noticias')).status, 401);
    assert.equal((await fetch(base + '/admin/noticias', { headers: { 'x-test-role': 'TALLER' } })).status, 403);
    assert.equal((await post('/admin/noticias', { titulo: 'x', imagen: PNG }, { ...headers, 'x-csrf-token': 'wrong' })).status, 403);
    assert.equal((await post('/admin/noticias', { titulo: 'x', imagen: PNG }, { ...headers, 'x-test-area': 'TALLER' })).status, 403);
    assert.equal(writes, 0);
    assert.equal((await post('/admin/noticias', { titulo: 'Noticia', orden: 0, activa: true, imagen: PNG })).status, 201);
    const data = await (await fetch(base + '/inicio/noticias', { headers: { 'x-test-role': 'TALLER' } })).json();
    assert.equal(data.noticias.length, 1); assert.equal(data.noticias[0].imagen, '/inicio/noticias/1/imagen'); assert.equal(data.noticias[0].imagen.includes('base64'), false);
    const img = await fetch(base + data.noticias[0].imagen, { headers: { 'x-test-role': 'TALLER' } });
    assert.equal(img.headers.get('Content-Type'), 'image/png'); assert.equal(img.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), Buffer.from(PNG, 'base64'));
    assert.equal((await post('/admin/noticias/1/editar', { titulo: 'Oculta', orden: 2, activa: false })).status, 200);
    assert.equal((await fetch(base + '/inicio/noticias/1/imagen', { headers: { 'x-test-role': 'TALLER' } })).status, 404);
    assert.equal((await fetch(base + '/admin/noticias/1/imagen', { headers })).status, 200);
    assert.equal((await post('/admin/noticias/1/eliminar', {})).status, 200);
    assert.equal(rows.size, 0);
    assert.equal((await post('/admin/noticias/1/eliminar', {})).status, 404);
    assert.equal((await post('/admin/noticias', { titulo: 'Ataque', imagen: Buffer.from('<html>no</html>').toString('base64') })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('noticias: acceso personal permite leer pero no administrar ni publicar', () => {
  const { puedeAcceder } = require('../src/utils/accesosTrabajador');
  const config = { departamento: 'TALLER', permisos: {} };
  assert.equal(puedeAcceder(config, '/inicio/noticias', 'GET'), true);
  assert.equal(puedeAcceder(config, '/inicio/noticias/1/imagen', 'GET'), true);
  assert.equal(puedeAcceder(config, '/inicio/noticias', 'POST'), false);
  assert.equal(puedeAcceder(config, '/admin/noticias', 'GET'), false);
});
