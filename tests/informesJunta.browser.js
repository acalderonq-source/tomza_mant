const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const express = require('express');
const { chromium } = require('playwright');
const { createRouter } = require('../src/routes/informesJunta.routes');
const { createStore } = require('../src/services/informesJunta');
const { ensureCsrfToken } = require('../src/middleware/security');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'informes-junta-browser-'));
  const screenshots = path.join(__dirname, '../tmp/informes-junta-qa'); await fs.mkdir(screenshots, { recursive: true });
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '../src/views'));
  app.use(express.json({ limit: '10mb' }));
  app.use((req, _res, next) => { req.session = { user: { id: 1, rol: 'ADMIN', usuario: 'Administrador de pruebas' }, csrfToken: 'browser-test' }; next(); });
  app.use(ensureCsrfToken);
  app.use('/admin/informes-junta', createRouter({ store: createStore(root) }));
  app.use(express.static(path.join(__dirname, '../public')));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const url = `http://127.0.0.1:${server.address().port}/admin/informes-junta`;
    await page.goto(url);
    await page.screenshot({ path: path.join(screenshots, '01-carga.png'), fullPage: true });
    await page.locator('#ij-demo').click();
    await page.getByText('Ejemplo ficticio cargado.', { exact: false }).waitFor();
    await page.locator('nav [data-view="validar"]').click();
    const form = page.locator('#ij-params');
    await form.locator('[name="unit"]').selectOption('Kilos');
    await form.locator('[name="days"]').fill('26');
    await form.locator('[name="target"]').fill('4500');
    await form.locator('[name="reference"]').fill('4200');
    await form.locator('[name="notes"]').fill('Prueba editable <script>literal</script>');
    await form.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await page.getByText('Cambios guardados. Excel y PPT', { exact: false }).waitFor();
    await page.screenshot({ path: path.join(screenshots, '02-validacion.png'), fullPage: true });
    await page.locator('nav [data-view="resumen"]').click();
    assert.match(await page.locator('#ij-summary-metrics').innerText(), /4[.,\s]300/);
    await page.locator('#ij-dimension').selectOption('division');
    assert.match(await page.locator('#ij-breakdown').innerText(), /Cartago/);
    await page.locator('nav [data-view="generar"]').click();
    await page.getByRole('heading',{name:'Relleno automático preparado',exact:true}).waitFor();
    await page.screenshot({ path: path.join(screenshots, '03-generar.png'), fullPage: true });
    for (const ext of ['xlsx', 'pptx']) {
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator(`[data-download="${ext}"]`).click()]);
      assert.match(download.suggestedFilename(), new RegExp(`v2\\.${ext}`));
      await download.saveAs(path.join(screenshots, 'demo.' + ext));
    }
    // Dirty parameters cannot be exported silently.
    await page.locator('nav [data-view="validar"]').click();
    await form.locator('[name="notes"]').fill('Cambio pendiente');
    await page.locator('nav [data-view="generar"]').click();
    await page.locator('[data-download="xlsx"]').click();
    await page.getByText('Guardá los parámetros', { exact: false }).waitFor();
    await page.locator('nav [data-view="validar"]').click();
    await form.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await page.getByText('Cambios guardados. Excel y PPT', { exact: false }).waitFor();
    await page.reload();
    await page.locator('nav [data-view="historial"]').click();
    await page.getByRole('button', { name: 'Abrir y editar', exact: true }).click();
    await page.getByText('Informe abierto.', { exact: false }).waitFor();
    assert.equal(await form.locator('[name="notes"]').inputValue(), 'Cambio pendiente');
    assert.equal(await form.locator('[name="unit"]').inputValue(), 'Kilos');
    await page.locator('nav [data-view="plantillas"]').click();
    await page.locator('#ij-template-sheet option').first().waitFor({ state: 'attached' });
    assert.equal(await page.locator('#ij-template-sheet option').count(), 43);
    assert.equal(await page.locator('#ij-template-slide option').count(), 29);
    await page.locator('#ij-template-apply').click();
    await page.locator('#ij-template-slide').selectOption('1');
    await page.locator('#ij-template-texts input').first().fill('OCTUBRE 2026');
    await page.locator('#ij-template-save').click();
    await page.getByText('Plantilla guardada.', { exact: false }).waitFor();
    await page.locator('nav [data-view="generar"]').click();
    const [templateDownload] = await Promise.all([page.waitForEvent('download'), page.locator('[data-download="pptx"]').click()]);
    const savedFile = path.join(screenshots, 'plantilla-editada.pptx'); await templateDownload.saveAs(savedFile);
    const zip = await require('jszip').loadAsync(await fs.readFile(savedFile));
    assert.match(await zip.file('ppt/slides/slide1.xml').async('string'), /OCTUBRE 2026/);
    assert.equal(Object.keys(zip.files).filter(file => /^ppt\/slides\/slide\d+\.xml$/.test(file)).length, 29);
    await page.locator('nav [data-view="plantillas"]').click();
    await page.locator('#ij-template-slide').selectOption('12');
    await page.screenshot({ path: path.join(screenshots, '06-plantillas-originales.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(screenshots, '04-movil.png'), fullPage: true });
    if (process.env.INFORMES_JUNTA_TEST_FILE) {
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.locator('nav [data-view="cargar"]').click();
      await page.locator('#ij-file').setInputFiles([process.env.INFORMES_JUNTA_TEST_FILE, process.env.INFORMES_JUNTA_TEST_FILE2].filter(Boolean));
      await page.getByText('registros. Revisá el mes', { exact: false }).waitFor();
      await page.locator('nav [data-view="validar"]').click();
      assert.match(await page.locator('#ij-compare').innerText(), process.env.INFORMES_JUNTA_TEST_FILE2 ? /5[.,\s]164[.,\s]799/ : /1[.,\s]945[.,\s]643/);
      if (process.env.INFORMES_JUNTA_TEST_FILE2) {
        assert.match(await page.locator('#ij-checks').innerText(), /Pulperias/);
        assert.match(await page.locator('#ij-checks').innerText(), /171 registros/);
        await page.locator('nav [data-view="plantillas"]').click();
        await page.locator('#ij-template-suggestions p').last().waitFor();
        assert.equal(await page.locator('#ij-template-suggestions p').count(), 6);
      }
      await page.locator('nav [data-view="generar"]').click();
      await page.getByRole('heading',{name:'Relleno automático preparado',exact:true}).waitFor();
      await page.locator('#ij-auto-slide').selectOption('12');
      await page.getByRole('button',{name:'Ampliar vista',exact:true}).click();
      await page.evaluate(()=>document.fonts.ready);
      await page.locator('#ij-auto-dialog').screenshot({path:path.join(screenshots,'07-granel-relleno.png')});
      const fits=await page.locator('#ij-auto-dialog').evaluate(dialog=>[...dialog.querySelectorAll('text')].map(text=>({cell:text.dataset.cell,length:text.getComputedTextLength(),size:Number(text.getAttribute('font-size'))})));assert.ok(fits.every(text=>Number.isFinite(text.length)&&text.length>0));
      await page.getByRole('button',{name:'Cerrar vista',exact:true}).click();
      if (process.env.INFORMES_JUNTA_TEST_FILE2) {
        assert.match(await page.locator('#ij-excel-preview').innerText(),/2[.,\s]736[.,\s]692/);
        const [filled]=await Promise.all([page.waitForEvent('download'),page.locator('[data-download="pptx"]').click()]);
        const filledFile=path.join(screenshots,'relleno-real.pptx');await filled.saveAs(filledFile);
        const actual=await require('jszip').loadAsync(await fs.readFile(filledFile));
        assert.match(await actual.file('ppt/slides/slide12.xml').async('string'),/>1,945,644<\/a:t>/);
        assert.match(await actual.file('ppt/slides/slide16.xml').async('string'),/>2,736,692<\/a:t>/);
      }
      await page.screenshot({ path: path.join(screenshots, '05-libro1.png'), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log('Browser OK: demo, edición, resumen, descargas, cambios pendientes, historial, móvil y carga real opcional.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
