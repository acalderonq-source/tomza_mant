const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.resolve(__dirname, '../src/views'));
  app.get('/', (req, res) => res.render('compras/orden_form', {
    orden: {}, lineas: [], proveedores: [], siguientePO: '2026-1',
    esEdicion: false, user: { usuario: 'admin', rol: 'ADMIN' }
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    page.on('dialog', dialog => dialog.accept());
    const hostile = '<img src=x onerror="window.inyectado=1">';
    await page.route('**/compras/cotizacion/analizar', route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ ok: false, error: hostile })
    }));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.locator('#cotizacionInput').setInputFiles({
      name: hostile + '.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4')
    });
    await page.waitForFunction(() => !document.querySelector('#analizarCotizacionBtn').disabled);
    assert.equal(await page.locator('#cotizacionPreview img').count(), 0);
    await page.locator('#analizarCotizacionBtn').click();
    await page.waitForFunction(text => document.querySelector('#cotizacionPreview').textContent === text, hostile);
    assert.equal(await page.locator('#cotizacionPreview img').count(), 0);
    assert.equal(await page.evaluate(() => window.inyectado), undefined);
    assert.equal(await page.locator('#cotizacionInput').isEnabled(), true);
    await page.locator('#cotizacionInput').setInputFiles([]);
    assert.equal(await page.locator('#analizarCotizacionBtn').isDisabled(), true);
    console.log('Cotizacion segura: nombres y errores como texto; limpieza y recuperacion correctas.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
