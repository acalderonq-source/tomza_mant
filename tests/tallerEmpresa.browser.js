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
 app.get('/seguimiento',(_req,res)=>res.send('<!doctype html><html><head><link rel="stylesheet" href="/css/orden-trazabilidad.css"></head><body>'+require('ejs').render(require('node:fs').readFileSync(path.resolve(__dirname,'../src/views/compras/trazabilidad_orden.ejs'),'utf8'),{orden:{po_numero:'2026-001',proveedor_id:1,factura:'123',moneda:'CRC'},trazabilidad:{financiero:true,recibida:false,facturada:true,advertencias:[],asientos:[{lote_id:1,monto_asiento:100,fecha_factura:'2026-10-17'}],pagos:[{id:1,numero:'CP-1',fecha:'2026-10-17',tipo:'abono',monto:50}]}})+'</body></html>'));
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
     if(width>=1100) {
      const sidebar=page.locator('.taller-desktop-sidebar');
      const units=sidebar.locator('details').filter({has:page.locator('summary',{hasText:/^Unidades$/})});
      assert.equal(await units.locator('a[href="/unidades"]').isVisible(),false);
      await units.locator('summary').click();
      assert.equal(await units.locator('a[href="/unidades"]').isVisible(),true);
      const compras=sidebar.locator('details').filter({has:page.locator('summary',{hasText:/^Compras$/})});
      await compras.locator('summary').click();
      assert.equal(await compras.locator('a[href="/compras/ordenes"]').isVisible(),true);
      assert.equal(await compras.locator('a[href="/compras/facturas"]').isVisible(),true);
     }
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
  await page.goto('http://127.0.0.1:'+server.address().port+'/seguimiento');
  assert.equal(await page.getByRole('link',{name:'Descargar colilla'}).count(),1);
  assert.equal(await page.getByRole('link',{name:'Abrir asiento'}).count(),1);
  assert.match(await page.locator('.order-trace-flow').textContent(),/Sin confirmación registrada/);
  await page.screenshot({path:path.join(os.tmpdir(),'tomza-seguimiento-orden.png'),fullPage:true});
  assert.deepEqual(errors,[]); console.log('UI OK: escritorio, movil, busqueda, permisos conservados.');
 } finally {await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
