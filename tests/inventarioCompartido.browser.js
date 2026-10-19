const express = require('express');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const pool = require('../src/db');

(async () => {
  const original = pool.query;
  pool.query = async sql => {
    if (sql.includes('FROM usuarios_sedes')) return [[{sede:'Cartago'},{sede:'Taller'},{sede:'Tecnicos'},{sede:'granel_la_cruz'}]];
    if (sql.includes('FROM prov_inventario i')) return [[{sede:'Cartago',codigo:'GUANTE',descripcion:'Guantes de seguridad',unidad:'PAR'}]];
    return [[]];
  };
  const app = express();
  app.set('view engine','ejs');
  app.set('views',path.join(__dirname,'../src/views'));
  app.use(express.static(path.join(__dirname,'../public')));
  app.use((req,res,next) => {
    req.session = {user:{id:91,rol:'SEGURIDAD_OCUP',sede:'granel_cartago',departamentoActivo:'SEGURIDAD_OCUPACIONAL',departamentos:['SEGURIDAD_OCUPACIONAL']}};
    next();
  });
  app.use('/proveeduria',require('../src/routes/proveeduria.routes'));
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  let browser;
  try {
    browser = await chromium.launch({channel:'chrome',headless:true});
    const page = await browser.newPage();
    for (const [nombre,width,height] of [['desktop',1440,960],['mobile',390,844]]) {
      await page.setViewportSize({width,height});
      await page.goto(`http://127.0.0.1:${server.address().port}/proveeduria/mis-solicitudes`);
      const sede = page.locator('select[name="sede"]');
      assert.deepEqual(await sede.locator('option').allTextContents(),['Seleccione la sede','Cartago','La Cruz']);
      assert.equal(await sede.inputValue(),'Cartago');
      await page.waitForSelector('tbody select option[value="GUANTE"]',{state:'attached'});
      await page.locator('tbody select').selectOption('GUANTE');
      assert.equal(await page.locator('.codigo').inputValue(),'GUANTE');
      await sede.selectOption('La Cruz');
      assert.equal(await page.locator('[data-catalogo-vacio]').isVisible(),false);
      assert.equal(await page.locator('tbody select').inputValue(),'GUANTE');
      assert.equal(await page.locator('[data-solicitud-inventario] button[type="submit"], [data-solicitud-inventario] button:not([type])').isDisabled(),false);
      await sede.selectOption('Cartago');
      assert.equal(await page.locator('tbody select option[value="GUANTE"]').count(),1);
      await page.screenshot({path:path.join(__dirname,`../tmp/inventario-compartido-${nombre}.png`),fullPage:true});
    }
    console.log('Sedes compartidas y catalogo verificados en escritorio y movil.');
  } finally {
    pool.query = original;
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode=1; });
