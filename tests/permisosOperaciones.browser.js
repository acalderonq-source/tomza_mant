const express=require('express'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
const {crearRouter}=require('../src/routes/perfilesAcceso.routes');
(async()=>{
  const perfil={id:8,usuario:'operaciones',nombre:'Operaciones',rol:'SUPERVISOR',sede:'Cartago'};
  const anterior=JSON.stringify({departamento:'OPERACIONES',sede:'Cartago',permisos:{OPERACIONES:'GESTION'}});
  const query=async(sql,args=[])=>{
    if(sql.startsWith('SELECT u.id'))return [[perfil]];
    if(sql.startsWith('INSERT INTO usuario_accesos_personales'))perfil.config_json=args[1];
    return [[]];
  };
  const db={query,getConnection:async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}})};
  const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));
  app.use(express.static(path.join(__dirname,'../public')));app.use(express.urlencoded({extended:true}));
  app.use((req,res,next)=>{req.session={user:{id:1,rol:'ADMIN',departamentoActivo:'ADMINISTRACION'}};next();});
  app.use('/admin/perfiles',crearRouter(db,async()=>true));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.on('dialog',dialog=>dialog.accept());
    const url=`http://127.0.0.1:${server.address().port}/admin/perfiles/8`;
    for(const width of [1440,390]){
      perfil.config_json=anterior;
      await page.setViewportSize({width,height:900});await page.goto(url,{waitUntil:'domcontentloaded'});
      for(const id of ['OPERACIONES','REPORTES_TALLER','SUMINISTROS']){
        assert.equal(await page.locator('#permiso-'+id).isVisible(),true);
        assert.equal(await page.locator('#permiso-'+id).inputValue(),'GESTION');
      }
      await page.getByLabel('Operaciones',{exact:true}).selectOption('NINGUNO');
      await page.getByLabel('Reportes a Taller',{exact:true}).selectOption('GESTION');
      await page.getByLabel('Solicitud de suministros',{exact:true}).selectOption('LECTURA');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:path.join(__dirname,`../tmp/permisos-operaciones-${width}.png`),fullPage:true});
      await page.getByRole('button',{name:'Guardar cambios'}).click();await page.waitForURL('**/admin/perfiles?guardado=1');
      assert.deepEqual(JSON.parse(perfil.config_json).permisos,{REPORTES_TALLER:'GESTION',SUMINISTROS:'LECTURA'});
      await page.goto(url,{waitUntil:'domcontentloaded'});
      assert.equal(await page.locator('#permiso-OPERACIONES').inputValue(),'NINGUNO');
      assert.equal(await page.locator('#permiso-REPORTES_TALLER').inputValue(),'GESTION');
      assert.equal(await page.locator('#permiso-SUMINISTROS').inputValue(),'LECTURA');
    }
    console.log('Tres permisos independientes verificados y guardados en escritorio y móvil.');
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
