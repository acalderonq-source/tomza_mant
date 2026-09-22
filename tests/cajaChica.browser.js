const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const ejs = require('ejs');
const { chromium } = require('playwright');
const { injectSecurityAssets } = require('../src/middleware/security');

async function main() {
  const app = express();
  app.use('/js', express.static(path.join(__dirname, '../public/js')));
  app.get('/', async (req, res) => {
    const ready = [
      { id: 1, empresa: 'GAS TOMZA', fecha: '2026-09-21', numero_factura: '00100001010000340575', proveedor: 'Proveedor de prueba', monto: '100.10', tipo_factura: 'ELECTRONICA', unidad: 'C174021', concepto: 'REPUESTOS' },
      { id: 2, empresa: 'SUPER GAS', fecha: '2026-09-22', numero_factura: '123456', proveedor: 'Proveedor B', monto: '200.20', tipo_factura: 'SIMPLIFICADO', unidad: '-', concepto: 'SUMINISTROS' }
    ];
    const html = await ejs.renderFile(path.join(__dirname, '../src/views/compras/caja_chica.ejs'), {
      user: { rol: req.query.role || 'ADMIN', usuario: 'Prueba' }, success: '', error: '', hoy: '2026-09-22',
      cajaChica: {
        filtros: { q: '', desde: '', hasta: '', pagina: 1, paginas: 1 }, resumen: { total_mes: 0, total: 0 },
        flujoResumen: { facturas_pendientes: 1, monto_gas_tomza: 100.1, monto_super_gas: 200.2, documentos_listos: 2 },
        facturasElectronicasPendientes: [{ id: 3, fecha_emision: '2026-09-22', nombre_emisor: 'Almacen de materiales', consecutivo: '00100001010000340576', clave: '506' + '0'.repeat(47), monto_total: 27354.05, moneda: 'CRC', detalle_resumen: 'Repuestos para unidad' }],
        documentosListos: ready, cortes: [], historial: []
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
    await page.getByRole('button', { name: 'Confirmar recibida', exact: true }).click();
    await page.locator('#documento.show').waitFor();
    assert.equal(await page.locator('#doc-numero').inputValue(), '00100001010000340576');
    assert.match(await page.locator('#form-documento').getAttribute('action'), /electronicas\/3\/confirmar$/);
    assert.equal(await page.locator('#form-documento input[name="_csrf"]').inputValue(), 'test-csrf');
    await page.locator('#documento').getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.locator('#tab-preparar').click();
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
    await page.screenshot({ path: path.join(os.tmpdir(), 'caja-chica-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(os.tmpdir(), 'caja-chica-mobile.png'), fullPage: true });
    await page.goto(`${url}/?role=CONTABILIDAD#preparar`);
    await page.locator('#preparar.active').waitFor();
    assert.equal(await page.locator('#generar-corte').count(), 0);
    assert.equal(await page.locator('#documento').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: modal, CSRF, totals, filters, mobile width and read-only role.');
    console.log(path.join(os.tmpdir(), 'caja-chica-desktop.png'));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
