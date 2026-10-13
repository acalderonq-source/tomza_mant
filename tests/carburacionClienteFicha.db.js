// Prueba optativa en tablas aisladas; nunca escribe clientes reales.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const express=require('express');const pool=require('../src/db');
test('fichas: migración, creación, edición, historial, conflictos y permisos HTTP',{skip:process.env.CARBURACION_DB_TEST!=='1',timeout:120000},async()=>{
  const original=pool.query,originalConnection=pool.getConnection;const suffix=crypto.randomBytes(5).toString('hex');
  const names=['carburacion_clientes','carburacion_cliente_editores','carburacion_clientes_historial'];
  const mapping=Object.fromEntries(names.map(n=>[n,`it_${suffix}_${n}`]));
  const rewrite=sql=>sql.replace(/\bcarburacion_[a-z_]+\b/g,n=>{if(!mapping[n])throw Error(`Tabla no aislada: ${n}`);return mapping[n];});
  const query=(sql,args)=>original.call(pool,rewrite(sql),args);let listener;
  try{
    const base=fs.readFileSync(path.join(__dirname,'../migrations/202610130003_carburacion_clientes.sql'),'utf8').split(';')[0];await query(base);
    for(const sql of fs.readFileSync(path.join(__dirname,'../migrations/202610130006_carburacion_fichas_clientes.sql'),'utf8').split(';').map(s=>s.trim()).filter(Boolean)){
      if(sql.startsWith('INSERT IGNORE'))await query("INSERT INTO carburacion_cliente_editores (usuario_id,motivo) VALUES (34,'Prueba aislada')");else await query(sql);
    }
    pool.query=query;pool.getConnection=async()=>{const c=await originalConnection.call(pool);const q=c.query,release=c.release.bind(c);c.query=(sql,args)=>q.call(c,rewrite(sql),args);c.release=()=>{c.query=q;c.release=release;release();};return c;};
    const {guardarFicha}=require('../src/utils/carburacionClienteFicha');const user={id:34,nombre:'Emily',departamentoActivo:'CARBURACION',departamentos:['CARBURACION']};
    const id=await guardarFicha(null,{nombre:'Estación de prueba',cedula_juridica:'3101895580'},user);
    await guardarFicha(id,{nombre:'Nombre actualizado',version:'1',cedula_juridica:'3101895580',direccion:'Dirección de prueba',provincia:'Cartago',canton:'Cartago',distrito:'Occidental',correo_notificacion:'test@example.com'},user);
    const [[row]]=await query('SELECT * FROM carburacion_clientes WHERE id=?',[id]);assert.equal(row.id,id);assert.equal(row.version,2);assert.equal(row.nombre,'Nombre actualizado');assert.equal(row.codigo_minae,null);
    await assert.rejects(guardarFicha(id,{nombre:'Cambio desactualizado',version:'1'},user),e=>e.status===409);
    await assert.rejects(guardarFicha(null,{nombre:'Nombre actualizado'},user),e=>e.status===409);
    await guardarFicha(null,{nombre:'Otra estación',cedula_juridica:'3101895580'},user);
    const [[hist]]=await query('SELECT COUNT(*) cantidad FROM carburacion_clientes_historial WHERE cliente_id=?',[id]);assert.equal(hist.cantidad,2);
    const app=express();app.set('views',path.join(__dirname,'../src/views'));app.set('view engine','ejs');app.use(express.urlencoded({extended:true}));app.use((req,res,next)=>{req.session={user:{...user,id:req.headers['x-readonly']?2:34}};res.locals.user=req.session.user;res.locals.carburacionPath='/carburacion/clientes';next();});app.use('/carburacion/clientes',require('../src/routes/carburacionClientes.routes'));
    listener=app.listen(0,'127.0.0.1');await new Promise(r=>listener.once('listening',r));const url=`http://127.0.0.1:${listener.address().port}/carburacion/clientes`;
    for(const route of ['',`/${id}`,`/${id}/editar`,'/nuevo']){const response=await fetch(url+route);assert.equal(response.status,200,route);assert.match(await response.text(),route===`/${id}`?/Código MINAE/:/Carburación/);}
    const readonly=await fetch(url+`/${id}`,{headers:{'x-readonly':'1'}});assert.equal(readonly.status,200);assert.doesNotMatch(await readonly.text(),/Editar información/);
    for(const route of ['/nuevo',`/${id}/editar`])assert.equal((await fetch(url+route,{headers:{'x-readonly':'1'}})).status,403);
    assert.equal((await fetch(url,{method:'POST',headers:{'x-readonly':'1','content-type':'application/x-www-form-urlencoded'},body:'nombre=No+permitido'})).status,403);
    const post=await fetch(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'nombre=Creado+por+formulario',redirect:'manual'});assert.equal(post.status,302);
  }finally{if(listener)await new Promise(r=>listener.close(r));pool.query=original;pool.getConnection=originalConnection;for(const name of [...names].reverse())await original.call(pool,`DROP TABLE IF EXISTS \`${mapping[name]}\``);await pool.end();}
});
