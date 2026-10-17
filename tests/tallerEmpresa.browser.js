const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { chromium } = require('playwright');
(async () => {
 const app = express();
 app.set('view engine','ejs'); app.set('views',path.resolve(__dirname,'../src/views'));
 app.use(express.static(path.resolve(__dirname,'../public')));
 const user = {usuario:'taller',rol:'TALLER',sede:'TODAS',departamentoActivo:'TALLER',departamentos:['TALLER']};
 app.get('/dashboard',(_req,res)=>res.render('dashboard',{user,hoy:[],stats:{},sedeSeleccionada:'TODAS',sedesMultiples:[],usuarioPesados:false,sedesDashboard:[],etiquetaSede:s=>s,ejecutivo:{unidades:226},alertasEjecutivas:[],prioridadesTaller:[],puedeVerOficinaDiaDia:true}));
 app.get('/mantenimientos',(_req,res)=>res.render('mantenimientos',{user,mantenimientos:[],correctivos:[],filtro:'',filtros:{},mecanicos:[],sedeSeleccionada:'TODAS',success:null,error:null}));
 app.get('/taller/dashboard',(_req,res)=>res.render('taller_dashboard',{user,unidades:[],ultimosCorrectivos:[],prioridades:[],prioridadesPesados:[],prioridadesMecanico:[],solicitudesRepuestos:[],resumen:{enTaller:0,disponibles:0,total:0},sedeSeleccionada:'TODAS',puedeGestionar:false,puedeGestionarPrioridades:false,success:null,error:null}));
 app.get('/mantenimientos/dashboard',(_req,res)=>res.render('mantenimientos_dashboard',{user,dashboard:{},filtros:{sede:'TODAS'},sedesFiltro:[],familias:[]}));
 const server = app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
 let browser;
 try {
  browser = await chromium.launch({channel:'chrome',headless:true});
  const page = await browser.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:900});
   for(const route of ['/dashboard','/mantenimientos','/taller/dashboard','/mantenimientos/dashboard']) {
    await page.goto('http://127.0.0.1:'+server.address().port+route);
    await page.waitForLoadState('networkidle');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,route+' '+width);
    assert.equal(await page.locator('body.taller-empresa').count(),1);
    assert.equal(await page.locator('.taller-desktop-sidebar').isVisible(),width>=1100);
    if(width>=1100) {
      assert.equal(await page.locator('.taller-desktop-sidebar a[href="/dashboard"]').count(),1);
      const navBox = await page.locator('.taller-desktop-sidebar').boundingBox();
      const mainBox = await page.locator('main, body > .container-fluid').first().boundingBox();
      assert.ok(mainBox.x >= navBox.x + navBox.width, 'El menu no debe tapar el contenido');
    }
    if(route==='/dashboard') {
     const search=page.getByRole('searchbox',{name:'Buscar aplicación de Taller'});
     await search.fill('mantenimiento');
     assert.ok(await page.locator('.module-card:visible').count()>0);
     await search.fill('ningunmodulo123');
     assert.equal(await page.locator('.module-card:visible').count(),0);
     assert.equal(await page.locator('.taller-module-empty').isVisible(),true);
     await search.fill('');
    }
    await page.screenshot({path:path.join(os.tmpdir(),'tomza-empresa-'+route.slice(1).replaceAll('/','-')+'-'+width+'.png'),fullPage:true});
   }
  }
  assert.deepEqual(errors,[]); console.log('UI OK: escritorio, movil, busqueda, permisos conservados.');
 } finally {await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
