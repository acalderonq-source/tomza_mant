const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const db = require('../src/db');
const bcrypt = require('bcryptjs');
const router = require('../src/routes/auth.routes');
const { registrarSeguridad } = require('../src/utils/ciberseguridad');
test('login real registra usuario inexistente, clave incorrecta y bloqueo por cuenta', async () => {
  const originalQuery = db.query, originalCompare = bcrypt.compare;
  let existe = false;
  db.query = async () => [existe ? [{ id: 1, usuario: 'prueba-ciber', password: 'hash' }] : []];
  bcrypt.compare = async () => false;
  const eventos = [], registro = registrarSeguridad({ query: async (_sql, args) => eventos.push(args) });
  const app = express(); app.use(express.urlencoded({ extended: false }));
  app.set('view engine', 'ejs'); app.set('views', path.resolve(__dirname, '../src/views'));
  app.use((req, _res, next) => { req.session = {}; next(); }); app.use(registro); app.use(router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const post = () => fetch(`http://127.0.0.1:${server.address().port}/login`, { method: 'POST', body: new URLSearchParams({ usuario: 'prueba-ciber', password: 'no-conservar-password' }) });
  try {
    assert.equal((await post()).status, 200); existe = true;
    for (let i = 0; i < 9; i++) assert.equal((await post()).status, 200);
    assert.equal((await post()).status, 429); await registro.esperar();
    assert.equal(eventos.filter(e => e[1] === 'LOGIN_FALLIDO').length, 10);
    assert.equal(eventos.filter(e => e[1] === 'LIMITE_INTENTOS').length, 1);
    assert.doesNotMatch(JSON.stringify(eventos), /no-conservar-password|prueba-ciber/);
  } finally { db.query = originalQuery; bcrypt.compare = originalCompare; server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
