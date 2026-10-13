const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const pool = require('../src/db');
const dashboard = require('../src/routes/dashboard.routes');

test('Carburación abre su propio dashboard sin consultar datos de Taller', async () => {
  const originalQuery = pool.query;
  let consultas = 0;
  pool.query = async () => { consultas++; throw new Error('No debe consultar Taller'); };
  const app = express();
  app.set('views', path.join(__dirname, '../src/views'));
  app.set('view engine', 'ejs');
  app.use((req, res, next) => {
    req.session = { user: { id: 34, rol: 'PROVEEDURIA_TALLER', departamentoActivo: 'CARBURACION' } };
    next();
  });
  app.use('/dashboard', dashboard);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/dashboard`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/carburacion/dashboard');
    assert.equal(consultas, 0);
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});
