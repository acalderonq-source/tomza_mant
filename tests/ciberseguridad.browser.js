const express = require('express'), path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { filtros } = require('../src/utils/ciberseguridad');
(async () => {
  let consultas = 0, fallo = false;
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), tipo: 'Ingreso fallido', gravedad: 'Baja', origen: '192.0.2.1', usuario: i === 0 ? '<img src=x onerror=alert(1)>' : 'Sin sesión', departamento: 'Sin sesión', ruta: '/login', http_estado: 200, fecha: new Date().toISOString(), ultimo: new Date().toISOString(), intentos: 2, estado: 'Pendiente', version: 1 }));
  const notas = new Map();
  const servicio = {
    resumenReal: async (_db, f) => {
      consultas++; if (fallo) throw Error('Prueba de caída');
      const visibles = rows.filter(r => f.gravedad === 'Todas' || r.gravedad === f.gravedad);
      return { demo: false, periodo: { desde: f.desde, hasta: f.hasta }, pagina: f.pagina, total: visibles.length * 2, grupos: visibles.length, bloqueados: 0, pendientes: visibles.filter(r => r.estado !== 'Resuelto').length, resueltos: visibles.filter(r => r.estado === 'Resuelto').length,
        tendencia: Array.from({ length: f.dias }, (_, i) => ({ fecha: new Date(Date.parse(f.desde + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10), detectados: i === f.dias - 1 ? visibles.length * 2 : 0, bloqueados: 0 })),
        tipos: [{ tipo: 'Ingreso fallido', total: visibles.length * 2 }], incidentes: visibles.slice(f.pagina * 12, f.pagina * 12 + 12), inicio: new Date().toISOString(), registro: { fallos: 0, descartados: 0 } };
    },
    seguimiento: async (_db, id) => notas.get(id) || [],
    cambiarEstado: async (_db, id, body, admin) => {
      assert.equal(admin, 1); const row = rows.find(r => r.id === id);
      if (row.version !== body.version) throw Object.assign(Error('El incidente cambió. Actualice el panel.'), { status: 409 });
      row.estado = body.estado; row.version++; notas.set(id, [{ estado: body.estado, nota: body.nota, administrador: 'admin', fecha: new Date().toISOString() }]);
    },
    exportar: async () => 'EVENTOS REALES DE TOMZA'
  };
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.resolve(__dirname, '../src/views'));
  app.use(require('../src/middleware/security').securityHeaders); require('./helpers/secureBrowserApp')(app);
  app.use(express.static(path.resolve(__dirname, '../public'))); app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: { id: 1, usuario: 'Administración' }, csrfToken: 'prueba' }; next(); });
  app.use(require('../src/middleware/security').ensureCsrfToken);
  app.use('/admin/ciberseguridad', require('../src/routes/ciberseguridad.routes').crearRouter({}, (_req, _res, next) => next(), servicio));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
    await page.clock.install();
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', msg => { if (msg.type() === 'error' && /Content Security Policy|Refused to/.test(msg.text())) errors.push(msg.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/admin/ciberseguridad`);
    await page.waitForFunction(() => document.querySelector('#estado').textContent.startsWith('Registro actualizado'));
    assert.equal(await page.locator('#total').textContent(), '40'); assert.equal(await page.locator('#incidentes tr').count(), 12);
    assert.equal(await page.locator('#incidentes img').count(), 0);
    await page.locator('#siguiente').click(); await page.waitForFunction(() => document.querySelector('#pagina').textContent.startsWith('Página 2'));
    assert.equal(await page.locator('#incidentes tr').count(), 8);
    await page.selectOption('#periodo', '7'); await page.waitForFunction(() => document.querySelector('#pagina').textContent.startsWith('Página 1'));
    assert.match(await page.locator('#rango').textContent(), new RegExp(filtros({ dias: '7' }).desde.split('-').reverse().join('/')));
    await page.getByRole('button', { name: 'Revisar incidente 1: Pendiente', exact: true }).click();
    await page.selectOption('#nuevo-estado', 'Resuelto'); await page.fill('#nota', 'Revisado <script>alert(1)</script>');
    await page.locator('#guardar').click(); await page.waitForFunction(() => !document.querySelector('#seguimiento').open);
    await page.waitForFunction(() => document.querySelector('#resueltos').textContent === '1');
    await page.getByRole('button', { name: 'Revisar incidente 1: Resuelto', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#historial').textContent.includes('Revisado'));
    assert.match(await page.locator('#historial').textContent(), /<script>alert\(1\)<\/script>/); assert.equal(await page.locator('#historial script').count(), 0);
    rows[0].version++; await page.fill('#nota', 'Otra revisión'); await page.locator('#guardar').click();
    await page.waitForFunction(() => document.querySelector('#seguimiento-error').textContent.includes('cambió'));
    await page.locator('#cerrar').click();
    await page.selectOption('#gravedad', 'Crítica'); await page.waitForFunction(() => document.querySelector('#estado').textContent.endsWith('Gravedad: Crítica'));
    assert.equal(await page.locator('#total').textContent(), '0'); assert.match(await page.locator('#incidentes').textContent(), /No hay eventos/);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportar').click()]);
    assert.doesNotMatch(download.suggestedFilename(), /EJEMPLO/); assert.match(fs.readFileSync(await download.path(), 'utf8'), /EVENTOS REALES/);
    await page.selectOption('#gravedad', 'Todas'); await page.waitForFunction(() => document.querySelector('#estado').textContent.endsWith('Gravedad: Todas'));
    const antes = consultas; await page.clock.fastForward(61000); await page.waitForFunction(() => document.querySelector('#panel').getAttribute('aria-busy') === 'false'); assert.ok(consultas > antes);
    fallo = true; await page.locator('#actualizar').click(); await page.waitForFunction(() => document.querySelector('#estado').textContent.includes('desactualizados'));
    assert.equal(await page.locator('#exportar').isDisabled(), true);
    fallo = false; await page.locator('#actualizar').click(); await page.waitForFunction(() => document.querySelector('#estado').textContent.startsWith('Registro actualizado'));
    const out = path.resolve(__dirname, '../tmp/ciberseguridad-real'); fs.mkdirSync(out, { recursive: true });
    await page.screenshot({ path: path.join(out, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Revisar incidente 1: Resuelto', exact: true }).click();
    assert.equal(await page.locator('#seguimiento').isVisible(), true); await page.screenshot({ path: path.join(out, 'movil.png'), fullPage: true });
    assert.deepEqual(errors, []); console.log('Panel real: filtros, vacío, seguimiento, conflictos, XSS, CSRF, CSV, refresco, errores y móvil verificados.');
  } finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
