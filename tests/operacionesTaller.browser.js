const express=require('express');
const path=require('node:path');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const pool=require('../src/db');
const {controlarAccesoPorDepartamento}=require('../src/utils/departamentos');
(async()=>{
  const original=pool.query,unidades=[{id:1,placa:'TEC101',sede:'Tecnicos'},{id:2,placa:'TEC202',sede:'Tecnicos'}],reportes=[];
  pool.query=async(sql,args=[])=>{
    if(/information_schema/i.test(sql))return [[{count:1,total:1}]];
    if(sql.includes('SELECT id,placa FROM unidades')||sql.includes('SELECT id, placa, sede FROM unidades WHERE activa'))return [unidades];
    if(sql.includes('SELECT id, placa, sede FROM unidades WHERE id = ?'))return [unidades.filter(u=>String(u.id)===String(args[0]))];
    if(sql.includes('INSERT INTO reportes_supervisores')){const [unidad_id,sede,supervisor_id,supervisor_nombre,descripcion_original,descripcion_limpia,semana_reporte,tipo_mantenimiento]=args;reportes.push({id:1,unidad_id,sede,supervisor_id,supervisor_nombre,descripcion_original,descripcion_limpia,semana_reporte,tipo_mantenimiento,estado:'PENDIENTE',placa:'TEC101',fecha_reporte:'2026-10-20'});return [{insertId:1}];}
    if(sql.includes('FROM reportes_supervisores rs'))return [reportes];
    return [[]];
  };
  const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));
  app.use(express.static(path.join(__dirname,'../public')));app.use(express.urlencoded({extended:true}));
  const session={user:{id:81,usuario:'operaciones',nombre:'Operaciones',rol:'SUPERVISOR',sede:'Cartago',departamentoActivo:'OPERACIONES',departamentos:['OPERACIONES']},sedeSeleccionada:'Cartago'};
  app.use((req,res,next)=>{req.session=session;next();});app.use(controlarAccesoPorDepartamento);
  app.use('/operaciones',require('../src/routes/operaciones.routes'));
  app.use('/reportes-supervisores',require('../src/routes/reportesSupervisores.routes'));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
    const base=`http://127.0.0.1:${server.address().port}`;
    fs.mkdirSync(path.join(__dirname,'../tmp'),{recursive:true});
    for(const [nombre,width,height] of [['desktop',1440,960],['mobile',390,844]]){
      await page.setViewportSize({width,height});await page.goto(base+'/operaciones',{waitUntil:'domcontentloaded'});
      assert.equal(await page.getByRole('link',{name:'Crear reporte de Taller'}).count(),2);
      await page.screenshot({path:path.join(__dirname,`../tmp/operaciones-${nombre}.png`),fullPage:true});
      await page.getByRole('link',{name:'Crear reporte de Taller'}).first().click();
      assert.equal(await page.getByRole('combobox',{name:'Unidad de Operaciones'}).inputValue(),'1');
      assert.equal(await page.getByRole('link',{name:'Rutas y choferes'}).count(),0);
      await page.locator('[name="descripcion_original"]').fill('Revisar frenos de la unidad');
      await page.screenshot({path:path.join(__dirname,`../tmp/operaciones-reporte-${nombre}.png`),fullPage:true});
      if(nombre==='desktop'){
        await page.getByRole('button',{name:'Guardar',exact:true}).click();
        await page.getByText('Reporte registrado para TEC101.',{exact:false}).waitFor();
        assert.equal(reportes.length,1);assert.equal(reportes[0].sede,'Tecnicos');
      }
    }
    console.log('Operaciones y reporte a Taller verificados en escritorio y móvil.');
  }finally{pool.query=original;if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
