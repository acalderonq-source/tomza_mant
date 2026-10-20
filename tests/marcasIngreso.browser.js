const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { crearRouter } = require('../src/routes/marcasIngreso.routes');
(async () => {
  const rows = [];
  async function query(sql, args = []) {
    if (sql.startsWith('SELECT puede_')) return [[{ puede_marcar: args[0] === 52 ? 1 : 0, puede_consultar: args[0] === 2 ? 1 : 0 }]];
    if (sql.startsWith('SELECT usuario_id')) return [[{ usuario_id: 52 }]];
    if (sql.startsWith('INSERT')) { rows.push({ id: rows.length + 1, usuario_id: args[0], nombre: args[1], tipo: args[2], fecha_utc: new Date().toISOString(), foto: args[3] }); return [{ insertId: rows.length }]; }
    if (sql.startsWith('SELECT COUNT')) return [[{ total: rows.length }]];
    if (sql.startsWith('SELECT foto')) return [[{ foto: rows[0].foto }]];
    const result = rows.slice().reverse(); return [sql.includes('LIMIT 1') ? result.slice(0, 1) : result];
  }
  const db = { query, async getConnection() { return { query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }; } };
  const sessions = new Map();
  const app = express(); app.use(require('../src/middleware/security').securityHeaders); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '../src/views'));
  require('./helpers/secureBrowserApp')(app);
  app.use(express.static(path.join(__dirname, '../public'))); app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { const id = Number(req.get('x-test-user') || 52); if (!sessions.has(id)) sessions.set(id, { user: { id, nombre: id === 52 ? 'Saul Cardenas' : 'Asistencia de Taller', rol: id === 52 ? 'MECANICO' : 'TALLER', departamentoActivo: 'TALLER' } }); req.session = sessions.get(id); next(); });
  app.use('/marcas-ingreso', crearRouter(db));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const base = 'http://127.0.0.1:' + server.address().port;
  fs.mkdirSync(path.join(__dirname, '../tmp/marcas'), { recursive: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = constraints => {
        window.ultimaSolicitudCamara = constraints;
        // La camara virtual de Chromium no tiene orientacion fisica.
        const video = { ...constraints.video }; delete video.facingMode;
        return original({ ...constraints, video });
      };
    });
    const page = await context.newPage();
    await page.goto(base + '/marcas-ingreso');
    await page.getByRole('button', { name: 'Registrar entrada', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('input[type=file]').count(), 0);
    await page.getByRole('button', { name: 'Registrar entrada', exact: true }).click();
    await page.waitForFunction(() => !document.getElementById('tomar-foto').disabled);
    assert.ok(await page.locator('#camara-video').evaluate(video => video.videoWidth > 0));
    assert.deepEqual(await page.evaluate(() => window.ultimaSolicitudCamara.video.facingMode), { exact: 'environment' });
    await page.getByRole('button', { name: 'Tomar foto', exact: true }).click();
    await page.waitForSelector('#foto-preview[src]', { timeout: 10000 }).catch(async e => { console.log(await page.locator('main').innerText()); throw e; });
    assert.ok((await page.locator('#foto-preview').getAttribute('src')).startsWith('data:image/jpeg;'));
    await page.screenshot({ path: path.join(__dirname, '../tmp/marcas/camara-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Confirmar marca', exact: true }).click();
    await page.getByRole('button', { name: 'Registrar salida', exact: true }).waitFor(); assert.equal(rows.length, 1);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(__dirname, '../tmp/marcas/reloj-movil.png'), fullPage: true });
    await page.getByRole('button', { name: 'Registrar salida', exact: true }).click();
    await page.waitForFunction(() => !document.getElementById('tomar-foto').disabled || document.getElementById('marca-mensaje').textContent);
    assert.equal(await page.locator('#marca-mensaje').innerText(), '');
    await page.getByRole('button', { name: 'Tomar foto', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar marca', exact: true }).click();
    await page.getByRole('button', { name: 'Registrar entrada', exact: true }).waitFor(); assert.equal(rows.length, 2);
    await page.getByRole('button', { name: 'Registrar entrada', exact: true }).click();
    await page.waitForFunction(() => !document.getElementById('tomar-foto').disabled);
    const handle = await page.locator('#camara-video').evaluateHandle(video => video.srcObject.getTracks()[0]);
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.equal(await handle.evaluate(track => track.readyState), 'ended');
    await context.setExtraHTTPHeaders({ 'x-test-user': '2' }); await page.goto(base + '/marcas-ingreso');
    await page.waitForURL('**/marcas-ingreso/historial');
    assert.equal(await page.getByRole('heading', { name: 'Historial de marcas' }).count(), 1);
    assert.equal(await page.locator('tbody tr').count(), 2); assert.equal(await page.locator('button').allTextContents().then(x => x.some(t => t.includes('Registrar'))), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: path.join(__dirname, '../tmp/marcas/historial.png'), fullPage: true });
    const denied = await browser.newPage(); await denied.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permiso denegado', 'NotAllowedError'); }; });
    await denied.goto(base + '/marcas-ingreso'); await denied.getByRole('button', { name: 'Registrar entrada', exact: true }).click();
    await denied.waitForFunction(() => document.getElementById('marca-mensaje').textContent.includes('Permita'));
    assert.equal(await denied.locator('#guardar-marca').isVisible(), false);
    const sinTrasera = await browser.newPage();
    await sinTrasera.addInitScript(() => {
      window.intentosCamara = 0;
      navigator.mediaDevices.getUserMedia = async () => {
        window.intentosCamara++;
        throw new DOMException('Sin camara trasera', 'OverconstrainedError');
      };
    });
    await sinTrasera.goto(base + '/marcas-ingreso');
    await sinTrasera.getByRole('button', { name: 'Registrar entrada', exact: true }).click();
    await sinTrasera.waitForFunction(() => document.getElementById('marca-mensaje').textContent.includes('camara trasera'));
    assert.equal(await sinTrasera.evaluate(() => window.intentosCamara), 1);
    assert.equal(await sinTrasera.locator('#guardar-marca').isVisible(), false);
    console.log('Marcas: solicitud exclusiva de trasera, sin fallback frontal, JPEG, entrada/salida y permisos verificados.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
