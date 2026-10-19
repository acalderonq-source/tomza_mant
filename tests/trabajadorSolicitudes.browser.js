const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const path = require('node:path');
const { chromium } = require('playwright');
const { createRouters } = require('../src/routes/trabajadorSolicitudes.routes');
const { ensureCsrfToken, injectSecurityAssets } = require('../src/middleware/security');
(async () => {
  let guardadas = 0;
  const db = { query: async (sql, args) => {
    if(sql.includes('administracion_propietario'))return [[{usuario_id:1}]];
    if (sql.startsWith('INSERT INTO trabajador_solicitudes_acceso')) { guardadas++; return [{insertId:1}]; }
    if (sql.includes('FROM trabajador_solicitudes_acceso')) return [[{id:1,cedula:'100000001',nombre_completo:'Persona de Prueba',puesto:'Asistente',sede:'Cartago',estado:'PENDIENTE',creado_en:new Date()}]];
    if (sql.includes('FROM usuarios')) return [[{id:7,usuario:'taller',nombre:'Asistente de taller',rol:'TALLER',sede:'Cartago'}]];
    throw Error('SQL inesperado');
  } };
  const app = express();
  app.set('view engine','ejs'); app.set('views',path.resolve(__dirname,'../src/views'));
  app.use(express.static(path.resolve(__dirname,'../public')));
  app.use(express.urlencoded({extended:false}));
  app.use(session({secret:'browser-trabajadores-only',resave:false,saveUninitialized:false}));
  app.use(ensureCsrfToken);
  app.use((req,res,next)=>{
    const render=res.render.bind(res);
    res.render=(vista,datos)=>render(vista,datos,(error,html)=>error?next(error):res.send(injectSecurityAssets(html,res.locals.csrfToken)));
    next();
  });
  app.get('/test-admin',(req,res)=>{req.session.user={id:1,rol:'ADMIN',departamentoActivo:'ADMINISTRACION'};res.redirect('/admin/solicitudes-trabajadores');});
  const routers = createRouters(db);
  app.use('/solicitar-ingreso',routers.publico);app.use('/admin/solicitudes-trabajadores',routers.privado);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  let browser;
  try {
    browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const base='http://127.0.0.1:'+server.address().port;
    await page.goto(base+'/solicitar-ingreso');
    assert.equal(await page.locator('[name="codigo_trabajador"]').count(),0);
    assert.equal(await page.locator('#sede option[value="granel_cartago"], #sede option[value="Taller"], #sede option[value="Tecnicos"]').count(),0);
    await page.getByLabel('Número de cédula').fill('100000001');
    await page.getByLabel('Nombre completo y apellidos').fill('Persona de Prueba');
    await page.getByLabel('Puesto',{exact:true}).fill('Asistente');
    await page.getByLabel('Correo para avisos de inicio de sesión').fill('persona@example.invalid');
    await page.getByLabel('Sede',{exact:true}).selectOption('Cartago');
    await page.screenshot({path:'tmp/solicitud-trabajador-desktop.png',fullPage:true});
    await page.getByRole('button',{name:'Enviar solicitud'}).click();
    await page.getByRole('heading',{name:'Solicitud recibida'}).waitFor();
    assert.equal(guardadas,1);
    await page.goto(base+'/test-admin');
    assert.equal(await page.getByRole('heading',{name:'Persona de Prueba'}).isVisible(),true);
    assert.equal(await page.getByRole('button',{name:'Aprobar y crear acceso y carnet'}).isVisible(),true);
    await page.screenshot({path:'tmp/solicitudes-trabajador-admin.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('checkbox').check();
    assert.equal(await page.getByRole('checkbox').isChecked(),true);
    await page.screenshot({path:'tmp/solicitudes-trabajador-mobile.png',fullPage:true});
    await page.goto(base+'/solicitar-ingreso');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    console.log('Solicitudes trabajadores: formulario, envio con CSRF, bandeja ADMIN y mobile correctos.');
  } finally { await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
