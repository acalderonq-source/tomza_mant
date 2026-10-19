const express=require('express');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {agregarNavegacionInicio}=require('../src/utils/navegacionInicio');
(async()=>{
  const app=express();app.use(express.static(path.join(__dirname,'../public')));
  app.get('/',(req,res)=>{
    const logout=req.query.tipo==='form'?'<form action="/logout" method="POST"><input type="hidden" name="csrf" value="prueba"><button>Salir</button></form>':'<a href="/logout">Cerrar sesion</a>';
    res.send(agregarNavegacionInicio('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><header style="display:flex;justify-content:space-between;flex-wrap:wrap"><strong>Contabilidad</strong><nav><a href="/inicio">Inicio empresarial</a><span>Usuario</span>'+logout+'</nav></header></body></html>',req.query.tipo==='externo'?null:{rol:req.query.tipo==='tv'?'PANTALLA_PESADOS':'CONTABILIDAD'}));
  });
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    const base='http://127.0.0.1:'+server.address().port;
    for(const tipo of ['anchor','form']){
      await page.goto(base+'/?tipo='+tipo);
      assert.equal(await page.locator('a[href="/inicio"]').count(),1);
      assert.equal(await page.locator('.empresa-session-actions>.empresa-home-link').innerText(),'Ir a inicio');
      assert.equal(await page.locator('.empresa-session-actions').locator(tipo==='form'?'form[action="/logout"]':'a[href="/logout"]').count(),1);
      if(tipo==='form')assert.equal(await page.locator('input[name="csrf"]').inputValue(),'prueba');
      await page.setViewportSize({width:390,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    for(const tipo of ['tv','externo']){
      await page.goto(base+'/?tipo='+tipo);assert.equal(await page.locator('.empresa-session-actions').count(),0);
    }
    console.log('Ir a inicio: junto a salida, sin duplicados, formularios conservados, movil y exclusiones verificados.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
