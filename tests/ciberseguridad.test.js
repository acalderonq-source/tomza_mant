const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { resumenDemo } = require('../src/utils/ciberseguridadDemo');
const { requireAdministracion } = require('../src/middleware/requireAdministracion');
test('la muestra concilia indicadores, fechas, tendencias y filtros', () => {
  for (const dias of [7, 14, 30]) for (const gravedad of ['Todas', 'Crítica', 'Alta', 'Media', 'Baja']) {
    const d = resumenDemo(dias, gravedad);
    assert.equal(d.tendencia.length, dias);
    assert.equal(d.total, d.incidentes.length);
    assert.equal(d.total, d.tendencia.reduce((sum, r) => sum + r.detectados, 0));
    assert.equal(d.total, d.tipos.reduce((sum, r) => sum + r.total, 0));
    assert.equal(d.bloqueados, d.tendencia.reduce((sum, r) => sum + r.bloqueados, 0));
    assert.equal(d.criticos, d.incidentes.filter(r => r.gravedad === 'Crítica').length);
    assert.equal(d.pendientes, d.incidentes.filter(r => r.estado === 'En investigación').length);
    assert.ok(d.incidentes.every(r => r.fecha.slice(0, 10) >= d.periodo.desde && r.fecha.slice(0, 10) <= d.periodo.hasta));
    if (gravedad !== 'Todas') assert.ok(d.incidentes.every(r => r.gravedad === gravedad));
  }
});
test('panel y datos requieren propietario y departamento Administración; rechaza filtros inválidos', async () => {
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.resolve(__dirname, '../src/views'));
  app.use((req, _res, next) => {
    req.session = { user: req.get('x-user') === 'none' ? null : { id: Number(req.get('x-user') || 1), usuario: '<admin>', rol: req.get('x-role') || 'ADMIN', departamentoActivo: req.get('x-area') || 'ADMINISTRACION' } }; next();
  });
  app.use('/admin/ciberseguridad', require('../src/routes/ciberseguridad.routes').crearRouter({}, requireAdministracion({}, async u => u.id === 1)));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/admin/ciberseguridad`;
  try {
    for (const ruta of ['', '/datos']) for (const headers of [{ 'x-user': 'none' }, { 'x-user': '2' }, { 'x-area': 'TALLER' }, { 'x-role': 'TALLER' }]) {
      const res = await fetch(base + ruta, { headers }); assert.ok([401, 403].includes(res.status));
    }
    const res = await fetch(base); assert.equal(res.status, 200); assert.match(res.headers.get('cache-control'), /no-store/);
    const html = await res.text(); assert.match(html, /DATOS DE EJEMPLO/); assert.match(html, /&lt;admin&gt;/);
    for (const query of ['dias=1', 'dias=abc', 'gravedad=Desconocida', 'dias=7&dias=30']) assert.equal((await fetch(base + '/datos?' + query)).status, 400);
    const datos = await (await fetch(base + '/datos?dias=7&gravedad=Cr%C3%ADtica')).json(); assert.equal(datos.demo, true); assert.equal(datos.tendencia.length, 7);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
