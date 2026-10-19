const express=require('express');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {departamentosInicio}=require('../src/utils/inicioEmpresa');
(async()=>{
  const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));
  app.use(express.static(path.join(__dirname,'../public')));
  app.get('/',(req,res)=>{const user={nombre:'Persona de prueba',rol:'TALLER',departamentos:['TALLER']};res.render('inicio_empresa',{user,departamentos:departamentosInicio(user),next:''});});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    // No descargar mapas de OSM con pruebas automatizadas: solo se prueban controles y estados.
    await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e7eff5"/><path d="M0 128h256M128 0v256" stroke="#c7d6e1"/></svg>'}));
    const base='http://127.0.0.1:'+server.address().port;
    await page.goto(base);
    await page.waitForSelector('#sedes-mapa.leaflet-container');
    assert.equal(await page.locator('#sedes-mapa .leaflet-interactive').count(),1);
    assert.equal(await page.locator('#sedes-mapa .leaflet-tooltip').innerText(),'Cartago');
    assert.ok(await page.locator('.tomza-pin img').evaluate(el=>el.getBoundingClientRect().width<=36));
    await page.locator('#mapa-acercar').click();await page.locator('#mapa-alejar').click();
    assert.equal(await page.locator('#sedes-mapa .leaflet-tile').first().getAttribute('referrerpolicy'),'origin');
    await page.locator('#mapa-cartago').click();
    await page.waitForSelector('.leaflet-popup-content');
    assert.ok((await page.locator('.leaflet-popup-content').innerText()).includes('Gas Tomza · Cartago'));
    assert.equal(await page.locator('.leaflet-popup-content a').getAttribute('href'),'https://www.google.com/maps/dir/?api=1&destination=9.877662658691406,-83.94295501708984');
    assert.equal(await page.locator('input[value="ADMINISTRACION"]').count(),0);
    await page.locator('.leaflet-popup-close-button').click();
    await page.locator('#mapa-pais').click();await page.waitForSelector('.leaflet-popup-content',{state:'detached'});
    await page.screenshot({path:path.join(__dirname,'../tmp/sedes-mapa-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.locator('#mapa-cartago').click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.ok(await page.locator('#sedes-mapa').evaluate(el=>el.clientHeight>=300));
    await page.screenshot({path:path.join(__dirname,'../tmp/sedes-mapa-mobile.png'),fullPage:true});
    await page.route('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',route=>route.abort());
    await page.reload();
    assert.ok((await page.locator('#mapa-estado').innerText()).includes('No se pudo cargar'));
    assert.ok((await page.locator('.sedes-footer>a').getAttribute('href')).includes('9.877662658691406'));
    console.log('Mapa: coordenadas, marcador, zoom, popup, movil, permisos y fallo CDN verificados con tiles simulados.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
