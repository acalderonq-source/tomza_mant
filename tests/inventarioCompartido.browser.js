const express = require('express');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const pool = require('../src/db');

(async () => {
  const original = pool.query;
  pool.query = async sql => {
    if (sql.includes('FROM usuarios_sedes')) return [[{sede:'Cartago'},{sede:'Taller'},{sede:'Tecnicos'},{sede:'granel_la_cruz'}]];
    if (sql.includes('FROM prov_inventario i')) return [[{sede:'Cartago',codigo:'GUANTE',descripcion:'Guantes de seguridad',unidad:'PAR'},{sede:'Cartago',codigo:'CAFE',descripcion:'Café',unidad:'UND',categoria:'Cafetería'}]];
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
      await page.goto(`http://127.0.0.1:${server.address().port}/proveeduria/mis-solicitudes`,{waitUntil:'domcontentloaded'});
      const sede = page.locator('select[name="sede"]');
      assert.deepEqual(await sede.locator('option').allTextContents(),['Seleccione la sede','Cartago','La Cruz']);
      assert.equal(await sede.inputValue(),'Cartago');
      const categorias = page.locator('[data-campo="categoria"]');
      const productos = page.locator('[data-campo="codigo"]');
      assert.equal(await productos.isDisabled(),true);
      assert.deepEqual(await categorias.locator('option').allTextContents(),['Seleccione una categoría','Limpieza','Oficina','Operaciones','Otros','Papelería','Salud ocupacional','Servicios ambientales','Técnicos','Uniformes']);
      const datos=JSON.parse(await page.locator('#prov-datos').textContent());
      for(const categoria of datos.categorias){
        await categorias.selectOption(categoria);
        const visibles=await productos.locator('option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));
        assert.deepEqual(visibles.sort(),datos.articulos.filter(a=>a.categoria===categoria).map(a=>a.codigo).sort());
      }
      await categorias.selectOption('Salud ocupacional');
      await page.waitForSelector('[data-campo="codigo"] option[value="GUANTE"]',{state:'attached'});
      assert.equal(await productos.locator('option').evaluateAll(options=>options.some(o=>/Café/.test(o.textContent))),false);
      await page.locator('[data-campo="codigo"]').selectOption('GUANTE');
      assert.equal(await page.locator('.codigo').inputValue(),'GUANTE');
      await sede.selectOption('La Cruz');
      assert.equal(await page.locator('[data-catalogo-vacio]').isVisible(),false);
      assert.equal(await page.locator('[data-campo="codigo"]').inputValue(),'GUANTE');
      assert.equal(await page.locator('[data-solicitud-inventario] button[type="submit"], [data-solicitud-inventario] button:not([type])').isDisabled(),false);
      await sede.selectOption('Cartago');
      assert.equal(await page.locator('[data-campo="codigo"] option[value="GUANTE"]').count(),1);
      await page.getByRole('button',{name:'Agregar artículo'}).click();
      await categorias.nth(1).selectOption('Salud ocupacional');
      await productos.nth(1).selectOption('GUANTE');
      assert.equal(await productos.nth(0).evaluate(el=>el.validity.customError),true);
      await categorias.nth(1).selectOption('Otros');
      assert.equal(await productos.nth(1).inputValue(),'');
      assert.equal(await page.locator('.codigo').nth(1).inputValue(),'');
      assert.equal(await productos.nth(0).evaluate(el=>el.validity.customError),false);
      const cafe=await productos.nth(1).locator('option').evaluateAll(options=>options.find(o=>o.value&&/Café/i.test(o.textContent)).value);
      await productos.nth(1).selectOption(cafe);
      assert.equal(await page.locator('.codigo').nth(1).inputValue(),cafe);
      assert.equal(await page.locator('input[data-campo="descripcion"]').count(),0);
      assert.equal(await page.locator('[data-solicitud-inventario]').evaluate(el=>el.checkValidity()),true);
      await categorias.nth(0).selectOption('');
      assert.equal(await productos.nth(0).isDisabled(),true);
      assert.equal(await page.locator('.codigo').nth(0).inputValue(),'');
      await page.screenshot({path:path.join(__dirname,`../tmp/inventario-compartido-${nombre}.png`),fullPage:true});
    }
    console.log('Sedes compartidas y catalogo verificados en escritorio y movil.');
  } finally {
    pool.query = original;
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode=1; });
