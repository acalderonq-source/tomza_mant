const express=require('express'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
const {crearRouter}=require('../src/routes/perfilesAcceso.routes');
(async()=>{
  const perfil={id:8,usuario:'asistente',nombre:'Asistente de prueba',rol:'TALLER',sede:'Cartago',config_json:null};
  let guardados=0;
  const query=async(sql)=>{if(sql.startsWith('SELECT u.id'))return [[perfil]];if(sql.startsWith('INSERT INTO usuario_perfiles_historial'))guardados++;return [[]];};
  const db={query,getConnection:async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}})};
  const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));app.use(express.static(path.join(__dirname,'../public')));app.use(express.urlencoded({extended:true}));
  app.use((req,res,next)=>{req.session={user:{id:1,rol:'ADMIN',departamentoActivo:'ADMINISTRACION'}};next();});app.use('/admin/perfiles',crearRouter(db,async()=>true));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.on('dialog',dialog=>dialog.accept());
    const base='http://127.0.0.1:'+server.address().port;
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:900});await page.goto(base+'/admin/perfiles');
      await page.getByRole('link',{name:'Editar perfil',exact:true}).click();
      assert.equal(await page.locator('[data-permisos-perfil]').isVisible(),false);
      await page.locator('#modo').selectOption('personal');await page.locator('#departamento').selectOption('SEGURIDAD_OCUPACIONAL');
      await page.locator('#permiso-SEGURIDAD').selectOption('LECTURA');
      assert.equal(await page.locator('#permiso-MANTENIMIENTOS').isDisabled(),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      await page.screenshot({path:path.join(__dirname,`../tmp/perfil-editar-${width}.png`),fullPage:true});
      await page.getByRole('button',{name:'Guardar cambios'}).click();await page.waitForURL('**/admin/perfiles?guardado=1');
      assert.equal(await page.getByRole('status').isVisible(),true);
    }
    assert.equal(guardados,2);console.log('Editor verificado en escritorio y movil, con seleccion de permisos y guardado.');
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
