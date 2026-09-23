const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { crearHarness } = require('./helpers/aresepHarness');

async function main() {
  const { app, db } = crearHarness();
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${url}/aresep?periodo=2026-09`);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.btn')).borderTopLeftRadius === '6px');
    assert.equal(await page.locator('.aresep-tabs a').count(), 5);
    assert.equal(await page.locator('.empty h2').textContent(), 'Sin registros en este mes');
    await page.getByRole('button', { name: 'Incorporar unidades activas' }).click();
    await page.waitForURL('**/*incorporados=1');
    assert.equal(db.rows.length, 2);
    assert.equal(await page.locator('tbody tr').count(), 2);
    await page.screenshot({ path: path.join(os.tmpdir(), 'aresep-desktop.png'), fullPage: true });
    await page.getByRole('link', { name: 'Editar C164528', exact: true }).click();
    assert.equal(await page.locator('#f-placa').inputValue(), 'C164528');
    assert.equal(await page.locator('#f-placa').evaluate(el => el.parentElement.querySelectorAll('.tomza-plate-results').length), 0);
    assert.equal(await page.locator('#f-marca').inputValue(), 'Hino');
    await page.locator('#f-activo').fill('0001');
    await page.locator('#f-codigo_cr').fill('CR-01');
    await page.locator('#f-tipo_transporte').selectOption('3');
    await page.locator('#f-medicion').selectOption('2');
    await page.locator('#f-peso_maximo').fill('5500.50');
    await page.locator('#f-potencia').fill('200');
    await page.locator('#f-llantas').fill('6');
    await page.getByRole('button', { name: 'Guardar registro' }).click();
    await page.waitForURL('**/*guardado=1');
    assert.match(await page.locator('tbody').textContent(), /Completo/);
    await page.getByRole('link', { name: /Operación y costos/ }).click();
    await page.getByRole('link', { name: 'Agregar registro' }).click();
    await page.locator('#unidad-buscar').fill('178652');
    assert.equal(await page.locator('#unidad option').count(), 2);
    await page.locator('#unidad').selectOption('2');
    assert.equal(await page.locator('#f-placa').inputValue(), 'C178652');
    await page.locator('#f-ruta').fill('Guapiles');
    await page.locator('#f-km_mes').fill('1200');
    await page.locator('#f-precio_combustible').fill('600.25');
    await page.screenshot({ path: path.join(os.tmpdir(), 'aresep-operacion-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Guardar registro' }).click();
    await page.waitForURL('**/*guardado=1');
    assert.equal(db.rows.filter(r => r.seccion === 'operacion').length, 1);
    for (const seccion of ['unidades', 'operacion', 'planilla', 'ventas', 'rutas']) {
      await page.goto(`${url}/aresep/nuevo?periodo=2026-09&seccion=${seccion}`);
      assert.equal(await page.locator('form input[name="_csrf"]').inputValue(), 'test-csrf');
      assert.equal(await page.locator('.form-error').count(), 0);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${url}/aresep?periodo=2026-09`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(os.tmpdir(), 'aresep-mobile.png'), fullPage: true });
    await page.getByRole('link', { name: 'Editar C164528', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(os.tmpdir(), 'aresep-form-mobile.png'), fullPage: true });
    await page.setExtraHTTPHeaders({ 'x-test-role': 'TRAMITES' });
    await page.goto(`${url}/aresep?periodo=2026-09`);
    assert.equal(await page.locator('.aresep-tabs a').count(), 4);
    assert.equal(await page.getByRole('link', { name: /^Planilla/ }).count(), 0);
    assert.deepEqual(errors, []);
    console.log('ARESEP browser OK: alta, edición, búsqueda por placa, permisos, CSRF, escritorio y móvil.');
    console.log('Screenshots: ' + os.tmpdir() + '\\aresep-desktop.png, aresep-mobile.png, aresep-form-mobile.png');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
