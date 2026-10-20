const assert=require('node:assert/strict');
const express=require('express');
const ejs=require('ejs');
const {chromium}=require('playwright');
const {securityHeaders}=require('../src/middleware/security');
const {prepararFuente,finalizarHtmlSeguro}=require('../src/utils/vistasSeguras');
(async()=>{
 const app=express();app.use(securityHeaders);app.use(express.static(require('node:path').join(__dirname,'../public')));
 app.get('/',(_req,res)=>res.send(finalizarHtmlSeguro(ejs.render(prepararFuente('<html><head></head><body><p style="color:red">Seguro</p><%- datos %><script>window.autorizado=true</script></body></html>'),{cspNonce:res.locals.cspNonce,datos:'<script>window.inyectado=true</script>'}),res.locals.cspNonce)));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port);
  assert.equal(await page.evaluate(()=>window.autorizado),true);
  assert.equal(await page.evaluate(()=>window.inyectado),undefined);
  assert.equal(await page.locator('p').evaluate(el=>getComputedStyle(el).color),'rgb(255, 0, 0)');
  const nonce=await page.locator('meta[name="csp-nonce"]').getAttribute('content');await page.reload();
  assert.notEqual(await page.locator('meta[name="csp-nonce"]').getAttribute('content'),nonce);
  console.log('CSP: codigo autorizado, bloqueo de inyeccion, estilos y nonce distinto verificados.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
