const express = require('express'), path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.resolve(__dirname, '../src/views'));
  app.use(require('../src/middleware/security').securityHeaders);
  require('./helpers/secureBrowserApp')(app);
  app.use(express.static(path.resolve(__dirname, '../public')));
  app.use((req, _res, next) => { req.session = { user: { usuario: 'Administración' } }; next(); });
  app.use('/admin/ciberseguridad', require('../src/routes/ciberseguridad.routes').crearRouter({}, (_req, _res, next) => next()));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', msg => { if (msg.type() === 'error' && /Content Security Policy|Refused to/.test(msg.text())) errors.push(msg.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/admin/ciberseguridad`);
    await page.waitForFunction(() => document.querySelector('#estado').textContent.startsWith('Muestra cargada'));
    const total = Number(await page.locator('#total').textContent()); assert.ok(total > 100);
    assert.equal(await page.locator('#tendencia svg').count(), 1); assert.equal(await page.locator('#incidentes tr').count(), 12);
    await page.locator('#siguiente').click(); assert.match(await page.locator('#pagina').textContent(), /Página 2/);
    await page.selectOption('#periodo', '7'); await page.waitForFunction(() => document.querySelector('#rango').textContent.startsWith('14/10/2026'));
    assert.ok(Number(await page.locator('#total').textContent()) < total);
    await page.selectOption('#gravedad', 'Crítica'); await page.waitForFunction(() => document.querySelector('#estado').textContent.endsWith('Gravedad: Crítica'));
    assert.equal(await page.locator('#total').textContent(), await page.locator('#criticos').textContent());
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportar').click()]);
    assert.match(download.suggestedFilename(), /EJEMPLO/);
    assert.match(fs.readFileSync(await download.path(), 'utf8'), /DATOS SIMULADOS/);
    await page.selectOption('#periodo', '30'); await page.selectOption('#gravedad', 'Todas'); await page.waitForFunction(() => document.querySelector('#estado').textContent.endsWith('Gravedad: Todas'));
    const out = path.resolve(__dirname, '../tmp/ciberseguridad'); fs.mkdirSync(out, { recursive: true });
    await page.screenshot({ path: path.join(out, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(out, 'movil.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('Panel verificado: CSP, gráficos, filtros, paginación, CSV y vista móvil.');
  } finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
