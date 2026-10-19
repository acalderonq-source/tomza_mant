const express=require('express');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {departamentosInicio}=require('../src/utils/inicioEmpresa');
(async()=>{
  const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));
  app.use(express.static(path.join(__dirname,'../public')));
  app.get('/login',(req,res)=>res.render('login',{error:null,next:'',departamento:'',departamentoNombre:''}));
  app.get('/',(req,res)=>{
    const user=req.query.perfil==='publico'?null:{nombre:'Alexandro Calderon',rol:'ADMIN',departamentos:req.query.perfil==='mecanico'?['TALLER']:['TALLER','OPERACIONES','CONTABILIDAD','ADMINISTRACION','PROVEEDURIA']};
    res.render('inicio_empresa',{user,departamentos:departamentosInicio(user),next:''});
  });
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    const base='http://127.0.0.1:'+server.address().port;
    await page.goto(base);await page.screenshot({path:path.join(__dirname,'../tmp/inicio-desktop.png'),fullPage:true});
    assert.equal(await page.locator('.department-entry form').count(),5);
    await page.locator('#buscar-departamento').fill('contabilidad');
    assert.equal(await page.locator('.department-entry:visible').count(),1);
    await page.locator('#buscar-departamento').fill('inexistente');assert.equal(await page.locator('.menu-empty').isVisible(),true);
    await page.goto(base+'/?perfil=mecanico');assert.equal(await page.locator('.department-entry form').count(),1);
    assert.equal(await page.locator('input[value="ADMINISTRACION"]').count(),0);
    await page.setViewportSize({width:390,height:844});await page.goto(base);
    await page.screenshot({path:path.join(__dirname,'../tmp/inicio-mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.locator('.menu-toggle').click();assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'true');
    await page.keyboard.press('Escape');assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'false');
    await page.goto(base+'/?perfil=publico');assert.equal(await page.locator('.department-entry form').count(),0);
    assert.ok(await page.locator('.department-entry a[href^="/login?"]').count()>0);
    await page.setViewportSize({width:1440,height:960});await page.goto(base+'/login');
    assert.equal(await page.locator('form[action="/login"]').first().locator('input[name="departamento"]').count(),0);
    assert.equal(await page.getByText('Cambiar departamento').count(),0);
    await page.locator('[data-toggle-password]').click();assert.equal(await page.locator('#login-clave').getAttribute('type'),'text');
    await page.screenshot({path:path.join(__dirname,'../tmp/login-unico-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.goto(base+'/login');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(__dirname,'../tmp/login-unico-mobile.png'),fullPage:true});
    console.log('Inicio empresarial: desktop, movil, busqueda y permisos verificados.');
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
