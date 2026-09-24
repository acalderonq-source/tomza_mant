const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const ejs = require('ejs');
const { chromium } = require('playwright');
const { injectSecurityAssets } = require('../src/middleware/security');

async function main() {
  const app = express();
  const submitted = [];
  const drafts = [];
  app.use(express.urlencoded({ extended: true }));
  app.post('/compras/facturas/caja-chica/documentos/manual', (req, res) => {
    submitted.push(req.body);
    res.redirect('/');
  });
  app.post('/compras/facturas/caja-chica/descargar', (req, res) => {
    drafts.push(req.body);
    res.attachment('Caja_Chica_Gas_Tomza_borrador.xlsx').send(Buffer.from('excel-test'));
  });
  app.use('/js', express.static(path.join(__dirname, '../public/js')));
  app.get('/', async (req, res) => {
    const ready = [
      { id: 1, empresa: 'GAS TOMZA', fecha: '2026-09-21', numero_factura: '00100001010000340575', proveedor: 'Proveedor de prueba', monto: '100.10', tipo_factura: 'ELECTRONICA', unidad: 'C174021', concepto: 'REPUESTOS' },
      { id: 2, empresa: 'SUPER GAS', fecha: '2026-09-22', numero_factura: '123456', proveedor: 'Proveedor B', monto: '200.20', tipo_factura: 'SIMPLIFICADO', unidad: '-', concepto: 'SUMINISTROS' }
    ];
    const html = await ejs.renderFile(path.join(__dirname, '../src/views/compras/caja_chica.ejs'), {
      user: { rol: req.query.role || 'ADMIN', usuario: 'Prueba' }, success: '', error: '', hoy: '2026-09-22',
      cajaChica: {
        resumen: { total_mes: 0, total: 0 },
        flujoResumen: { monto_gas_tomza: 100.1, monto_super_gas: 200.2, documentos_listos: 2 },
        documentosListos: ready,
        cortes: [{ id: 1, fecha: '2026-09-23', estado: 'GENERADO', documentos: 42, total_gas_tomza: 272683.16, total_super_gas: 17000, total_documentos: 289683.16 }],
        historial: []
      }
    });
    res.send(injectSecurityAssets(html, 'test-csrf'));
  });
  const server = await new Promise(resolve => { const started = app.listen(0, '127.0.0.1', () => resolve(started)); });
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    await page.waitForFunction(() => Boolean(window.bootstrap));
    assert.equal(await page.locator('#recibidas,#importar').count(), 0);
    await page.locator('button[data-mode="manual"]').click();
    await page.locator('#documento.show').waitFor();
    assert.equal(await page.locator('#doc-numero').inputValue(), '');
    assert.equal(await page.locator('#doc-proveedor').inputValue(), '');
    assert.equal(await page.locator('#doc-tipo').inputValue(), 'ELECTRONICA');
    assert.match(await page.locator('#form-documento').getAttribute('action'), /documentos\/manual$/);
    assert.equal(await page.locator('#form-documento input[name="_csrf"]').inputValue(), 'test-csrf');
    await page.locator('#doc-empresa').selectOption('SUPER GAS');
    await page.locator('#doc-numero').fill('00000012345');
    await page.locator('#doc-proveedor').fill('Proveedor de caja independiente');
    await page.locator('#doc-monto').fill('200.20');
    await page.locator('#doc-concepto').fill('SUMINISTROS');
    await page.locator('#guardar-documento').click();
    await page.waitForURL(url + '/');
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].numero_factura, '00000012345');
    assert.equal(submitted[0].tipo_factura, 'ELECTRONICA');
    assert.equal(submitted[0].factura_electronica_id, undefined);
    await page.locator('button[data-mode="manual"]').click();
    await page.locator('#documento.show').waitFor();
    assert.equal(await page.locator('#doc-numero').inputValue(), '');
    await page.locator('#doc-tipo').selectOption('SIMPLIFICADO');
    await page.locator('#documento').getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.locator('#tab-preparar').click();
    assert.equal(await page.locator('.js-seleccion:checked').count(), 2);
    assert.equal(await page.getByText('Cerrar caja y preparar Excel').count(), 0);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#descargar-tomza').click()
    ]);
    assert.match(download.suggestedFilename(), /borrador\.xlsx$/);
    assert.equal(drafts[0].empresa, 'GAS TOMZA');
    assert.deepEqual(drafts[0].documento_ids, ['1', '2']);
    assert.equal(await page.locator('.js-seleccion:checked').count(), 2);
    await page.locator('#seleccionar-todas').check();
    assert.equal(await page.locator('#cantidad-seleccion').textContent(), '2');
    assert.match(await page.locator('#monto-total').textContent(), /300,30/);
    await page.locator('#efectivo-20000').fill('2');
    await page.locator('#vales').fill('50');
    assert.match(await page.locator('#total-caja').textContent(), /40.?350,30/);
    await page.locator('#empresa-listas').selectOption('SUPER GAS');
    assert.equal(await page.locator('.ready-row:visible').count(), 1);
    await page.locator('#seleccionar-todas').uncheck();
    assert.equal(await page.locator('#cantidad-seleccion').textContent(), '1');
    await page.locator('#empresa-listas').selectOption('');
    await page.locator('#tab-cortes').click();
    assert.equal(await page.getByRole('button', { name: 'Reabrir' }).count(), 1);
    assert.equal(await page.locator('.js-reabrir input[name="_csrf"]').inputValue(), 'test-csrf');
    await page.locator('#tab-preparar').click();
    await page.screenshot({ path: path.join(os.tmpdir(), 'caja-chica-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(os.tmpdir(), 'caja-chica-mobile.png'), fullPage: true });
    await page.goto(`${url}/?role=CONTABILIDAD#preparar`);
    await page.locator('#preparar.active').waitFor();
    assert.equal(await page.locator('#generar-corte').count(), 0);
    assert.equal(await page.locator('#documento').count(), 0);
    await page.locator('#tab-cortes').click();
    assert.equal(await page.getByRole('button', { name: 'Reabrir' }).count(), 0);
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: modal, CSRF, totals, filters, mobile width and read-only role.');
    console.log(path.join(os.tmpdir(), 'caja-chica-desktop.png'));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
