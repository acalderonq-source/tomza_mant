// Prueba optativa en tablas aisladas; nunca escribe clientes reales.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const express=require('express');const pool=require('../src/db');
test('fichas: migración, creación, edición, historial, conflictos y permisos HTTP',{skip:process.env.CARBURACION_DB_TEST!=='1',timeout:120000},async()=>{
  const original=pool.query,originalConnection=pool.getConnection;const suffix=crypto.randomBytes(5).toString('hex');
  const names=['carburacion_clientes','carburacion_cliente_editores','carburacion_clientes_historial','carburacion_cliente_incidencias','carburacion_cliente_documentos'];
  const mapping=Object.fromEntries(names.map(n=>[n,`it_${suffix}_${n}`]));
  const rewrite=sql=>sql.replace(/\bcarburacion_[a-z_]+\b/g,n=>{if(!mapping[n])throw Error(`Tabla no aislada: ${n}`);return mapping[n];});
  const query=(sql,args)=>original.call(pool,rewrite(sql),args);let listener;
  try{
    const base=fs.readFileSync(path.join(__dirname,'../migrations/202610130003_carburacion_clientes.sql'),'utf8').split(';')[0];await query(base);
    for(const sql of fs.readFileSync(path.join(__dirname,'../migrations/202610130006_carburacion_fichas_clientes.sql'),'utf8').split(';').map(s=>s.trim()).filter(Boolean)){
      if(sql.startsWith('INSERT IGNORE'))await query("INSERT INTO carburacion_cliente_editores (usuario_id,motivo) VALUES (34,'Prueba aislada')");else await query(sql);
    }
    for(const sql of fs.readFileSync(path.join(__dirname,'../migrations/202610190001_carburacion_expediente_incidencias.sql'),'utf8').split(';').map(s=>s.trim()).filter(Boolean))await query(sql);
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
    // La documentación legal y la ficha se guardan juntas, nunca un representante sin respaldo.
    const pdfData='data:application/pdf;base64,'+Buffer.from('%PDF-1.4\nPrueba').toString('base64');
    const legal={nombre:'Estación con representante',representante_legal:'Representante de prueba',cedula_juridica_adjunto_data:pdfData,cedula_juridica_adjunto_nombre:'cedula.pdf',poder_adjunto_data:pdfData,poder_adjunto_nombre:'poder.pdf'};
    await assert.rejects(guardarFicha(null,{nombre:legal.nombre,representante_legal:legal.representante_legal},user),/debe adjuntar/);
    const legalId=await guardarFicha(null,legal,user);
    await guardarFicha(legalId,{nombre:legal.nombre,representante_legal:legal.representante_legal,version:'1'},user);
    await assert.rejects(guardarFicha(legalId,{nombre:legal.nombre,representante_legal:'Otro representante',version:'2'},user),/debe adjuntar/);
    const [[legalDoc]]=await query("SELECT id FROM carburacion_cliente_documentos WHERE cliente_id=? AND tipo='PODER'",[legalId]);
    const archivo=await fetch(url+`/${legalId}/documentos/${legalDoc.id}`);assert.equal(archivo.status,200);assert.equal(archivo.headers.get('content-type'),'application/pdf');assert.equal((await archivo.text()).slice(0,5),'%PDF-');
    assert.equal((await fetch(url+`/${id}/documentos/${legalDoc.id}`)).status,404);
    const {guardarIncidencia,guardarDocumento}=require('../src/utils/carburacionExpediente');
    const incidenciaId=await guardarIncidencia(legalId,{titulo:'Fuga reportada',descripcion:'Descripción original de la incidencia',fecha:'2026-10-19',estado:'ABIERTA'},user);
    await guardarIncidencia(legalId,{estado:'RESUELTA',version:'1'},user,incidenciaId);
    await assert.rejects(guardarIncidencia(legalId,{estado:'ABIERTA',version:'1'},user,incidenciaId),e=>e.status===409);
    await assert.rejects(guardarIncidencia(id,{estado:'ABIERTA',version:'2'},user,incidenciaId),e=>e.status===404);
    await guardarDocumento(legalId,{tipo:'DOCUMENTO',archivo_data:pdfData,archivo_nombre:'reporte.pdf'},user);
    const ficha=await fetch(url+`/${legalId}`);const texto=await ficha.text();assert.equal(ficha.status,200);assert.match(texto,/Fuga reportada/);assert.match(texto,/Descripción original/);assert.match(texto,/Resuelta/);assert.match(texto,/poder.pdf|reporte.pdf/);
    for(const route of [`/${legalId}/incidencias`,`/${legalId}/documentos`,`/${legalId}/incidencias/${incidenciaId}/estado`])assert.equal((await fetch(url+route,{method:'POST',headers:{'x-readonly':'1'}})).status,403);
  }finally{if(listener)await new Promise(r=>listener.close(r));pool.query=original;pool.getConnection=originalConnection;for(const name of [...names].reverse())await original.call(pool,`DROP TABLE IF EXISTS \`${mapping[name]}\``);await pool.end();}
});
