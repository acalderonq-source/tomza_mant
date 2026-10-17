const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { chromium } = require('playwright');
const fakeDb = { query: async sql => {
  if (sql.includes('FROM unidades WHERE')) return [[{ id: 1, placa: 'C12345', sede: 'Cartago', marca: 'Hino', modelo: '300', activa: 1, varada: 0 }]];
  if (sql.includes('FROM empresa_operaciones')) return [[{ actor: 'Operador de prueba', ruta: '/compras/ordenes', estado: 'RESPONDIDA', respuesta: 302, creado_en: new Date() }]];
  if (sql.includes('FROM auditoria_sistema')) return [[{ usuario_nombre: 'Persona', accion: 'EDITAR', tabla_afectada: 'ordenes_compra', registro_id: 1, antes: { total: 100 }, despues: { total: 200 }, creado_en: new Date() }]];
  return [[]];
} };
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
(async () => {
  const app = express();
  app.set('view engine', 'ejs'); app.set('views', path.resolve(__dirname, '../src/views'));
  app.use(express.static(path.resolve(__dirname, '../public')));
  app.use((req, _res, next) => { req.session = { user: { id: 1, rol: req.query.rol || 'ADMIN', departamentoActivo: 'TALLER' } }; next(); });
  app.use('/control-empresa', require('../src/routes/controlEmpresa.routes'));
  app.get('/form', (_req, res) => res.send('<form method="post" action="/compras/ordenes"><button>Guardar</button></form><script src="/js/operaciones-empresa.js" defer></script>'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const base = 'http://127.0.0.1:' + server.address().port;
    await page.goto(base + '/control-empresa');
    assert.equal(await page.getByRole('heading', { name: 'Control de Taller V1' }).isVisible(), true);
    assert.equal(await page.getByText('Operador de prueba').isVisible(), true);
    await page.screenshot({ path: 'tmp/empresa-control-desktop.png', fullPage: true });
    await page.goto(base + '/control-empresa/unidades?placa=C12345');
    assert.equal(await page.getByRole('heading', { name: /C12345/ }).isVisible(), true);
    assert.equal(await page.locator('section').count(), 9);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: 'tmp/empresa-expediente-mobile.png', fullPage: true });
    assert.equal((await page.request.get(base + '/control-empresa?rol=TALLER')).status(), 403);
    assert.equal((await page.request.get(base + '/control-empresa/unidades?rol=MECANICO')).status(), 403);
    assert.equal((await page.request.get(base + '/control-empresa/auditoria/excel?rol=CONTABILIDAD')).status(), 403);
    await page.goto(base + '/form');
    const token = await page.locator('[name="_operacion"]').inputValue();
    assert.match(token, /^[a-f0-9-]{36}$/);
    console.log('Centro de control OK: permisos, expediente, desktop/mobile y token de formulario.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
