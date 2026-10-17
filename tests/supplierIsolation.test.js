const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const { isolateSupplier } = require('../src/middleware/supplierIsolation');

test('supplier sessions cannot reach internal handlers, even if those handlers omit authorization', async () => {
  const app = express();
  app.use(session({ secret: 'test-only-supplier-isolation', resave: false, saveUninitialized: false }));
  app.get('/test-login/:kind', (req, res) => {
    req.session.proveedorPortal = { id: 7, version: 1 };
    if (req.params.kind === 'mixed') req.session.user = { id: 1, rol: 'ADMIN' };
    res.sendStatus(204);
  });
  app.use(isolateSupplier);
  app.all('*', (req, res) => res.send('handler reached'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const request = (url, method = 'GET') => fetch(base + url, { method, redirect: 'manual', headers: { cookie } });
  try {
    const login = await request('/test-login/supplier');
    cookie = login.headers.get('set-cookie').split(';')[0];
    for (const url of ['/dashboard', '/administracion', '/compras/facturas', '/contabilidad', '/api/unidades/buscar', '/uploads/facturas/a.pdf', '/login', '/portal-proveedores-falso', '/js/archivo-privado.json']) {
      for (const method of ['GET', 'POST', 'HEAD']) assert.equal((await request(url, method)).status, 403, `${method} ${url}`);
    }
    for (const url of ['/portal-proveedores', '/portal-proveedores/taller/facturas', '/portal-proveedores/facturas/7/archivo/pdf', '/js/portal-proveedores.js?v=1', '/css/portal-proveedores.css']) {
      assert.equal((await request(url)).status, 200, url);
    }
    assert.equal((await request('/css/portal-proveedores.css', 'POST')).status, 403);
    assert.equal((await request('/portal-proveedores/%2e%2e%2fdashboard')).status, 400);
    assert.equal((await request('/portal-proveedores/%252e%252e/dashboard')).status, 400);
    const home = await request('/');
    assert.equal(home.status, 302);
    assert.equal(home.headers.get('location'), '/portal-proveedores');
    cookie = '';
    const mixed = await request('/test-login/mixed');
    cookie = mixed.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/portal-proveedores')).status, 401);
    assert.equal((await request('/dashboard')).status, 200, 'mixed session was destroyed, caller is now anonymous');
    cookie = '';
    assert.equal((await request('/login')).status, 200, 'internal login remains available to unauthenticated employees');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
