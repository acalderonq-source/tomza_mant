const assert=require('node:assert/strict');
const express=require('express');
const path=require('node:path');
const {chromium}=require('playwright');
const {crearRouter}=require('../src/routes/ingresosSesion.routes');
(async()=>{
  const db={query:async sql=>{
    if(sql.includes('FROM sesion_ingresos'))return [[{nombre:'Persona de prueba',usuario:'taller',rol:'TALLER',departamento:'TALLER',sede:'Cartago',ip:'192.0.2.1',dispositivo:'Chrome de prueba',correo_destino:'persona@example.invalid',correo_estado:'ENVIADO',creado_en:new Date()}]];
    return [[{identidad:'C:100000001',nombre:'Persona de prueba',correo:'persona@example.invalid'}]];
  }};
  const app=express();app.set('view engine','ejs');app.set('views',path.resolve(__dirname,'../src/views'));
  app.use(express.static(path.resolve(__dirname,'../public')));
  app.use((req,_res,next)=>{req.session={user:{id:1,rol:'ADMIN'}};next();});
  app.use('/admin/ingresos',crearRouter(db));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const base='http://127.0.0.1:'+server.address().port;
    await page.goto(base+'/admin/ingresos');
    assert.equal(await page.getByText('Persona de prueba',{exact:true}).isVisible(),true);
    assert.equal(await page.getByText('Enviado',{exact:true}).isVisible(),true);
    await page.screenshot({path:'tmp/registro-ingresos-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'tmp/registro-ingresos-mobile.png',fullPage:true});
    await page.goto(base+'/admin/ingresos/correos');
    assert.equal(await page.getByLabel('Correo verificado').inputValue(),'persona@example.invalid');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    console.log('Registro de ingresos y correos: desktop/mobile y estados visibles correctos.');
  }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
