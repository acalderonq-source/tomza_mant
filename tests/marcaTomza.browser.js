const express=require('express'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
const {agregarMarcaTomza}=require('../src/utils/marcaTomza');
(async()=>{
  const app=express();app.use(express.static(path.join(__dirname,'../public')));
  app.get('/',(req,res)=>res.send(agregarMarcaTomza('<!doctype html><html><head><title>Gas Tomza | Compras</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px Arial}nav{background:#132c45;color:white;padding:12px;display:flex;align-items:center;justify-content:space-between}main{padding:20px}header{margin:16px 0}a{color:inherit}</style></head><body><nav><a class="navbar-brand" href="#">Gas Tomza · Administración</a><a href="/logout">Salir</a></nav><main><h1>Gas Tomza</h1><header><a class="login-wordmark" href="#">Gas Tomza <span>Sistema empresarial</span></a></header><header><a class="empresa-logo"><img src="/img/logo_tomza.jpg" alt="Gas Tomza">Gas Tomza</a></header><p>Gas Tomza de Costa Rica S.A.</p><select><option>GAS TOMZA</option></select><input value="GAS TOMZA"><button>Descargar Gas Tomza</button></main></body></html>')));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:'+server.address().port);
      assert.equal(await page.locator('img.tomza-brand-logo').count(),4);
      for(const selector of ['.navbar-brand','.login-wordmark','.empresa-logo','h1'])assert.equal(await page.locator(selector+' img').count(),1);
      assert.equal(await page.title(),'Gas Tomza | Compras');assert.equal(await page.locator('input').inputValue(),'GAS TOMZA');
      assert.equal(await page.locator('option').textContent(),'GAS TOMZA');assert.equal(await page.locator('p').textContent(),'Gas Tomza de Costa Rica S.A.');
      assert.equal(await page.locator('.navbar-brand').textContent(),' · Administración');
      assert.equal(await page.locator('img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)),true);
      await page.screenshot({path:path.join(__dirname,`../tmp/marca-tomza-${width}.png`),fullPage:true});
    }
    console.log('Logo PNG verificado en encabezados, sin duplicados ni cambios de datos, en escritorio y movil.');
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
