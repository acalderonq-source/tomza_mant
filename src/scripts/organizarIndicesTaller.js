const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const pool=require('../db');
const archivo='202610170001_indices_taller_erp.sql';
const plan=[
 {tabla:'mantenimientos',indice:'idx_mant_estado_fecha_unidad',columnas:['estado','fecha_programada','unidad_id']},
 {tabla:'ordenes_compra',indice:'idx_ordenes_pagadas_fecha_pago',columnas:['facturada','pagada','fecha_pago']},
 {tabla:'facturas',indice:'idx_facturas_pagadas_fecha_pago',columnas:['pagada','fecha_pago']}
];
async function organizar(db,aplicar=false,guardarRespaldo){
 const connection=await db.getConnection();
 const resultados=[];
 try {
  await connection.query('SET SESSION lock_wait_timeout = 5');
  const respaldo=[];
  for(const item of plan){
   const [ddl]=await connection.query('SHOW CREATE TABLE `'+item.tabla+'`');
   respaldo.push({tabla:item.tabla,ddl:ddl[0]['Create Table']});
  }
  if(aplicar){if(!guardarRespaldo)throw Error('Debe guardar la estructura previa antes de aplicar indices.');await guardarRespaldo(respaldo);}
  for(const item of plan){
   const [indices]=await connection.query('SELECT COLUMN_NAME columna FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? ORDER BY SEQ_IN_INDEX',[item.tabla,item.indice]);
   if(indices.length){
    if(JSON.stringify(indices.map(i=>i.columna))!==JSON.stringify(item.columnas))throw Error('El indice existente tiene otra estructura: '+item.indice);
    resultados.push({...item,estado:'ya existente'});continue;
   }
   if(aplicar)await connection.query(`ALTER TABLE \`${item.tabla}\` ADD INDEX \`${item.indice}\` (${item.columnas.map(c=>'`'+c+'`').join(',')}), ALGORITHM=INPLACE, LOCK=NONE`);
   resultados.push({...item,estado:aplicar?'creado':'propuesto'});
  }
  if(aplicar){
   const content=fs.readFileSync(path.join(__dirname,'../../migrations',archivo),'utf8');
   const checksum=crypto.createHash('sha256').update(content).digest('hex');
   const [existing]=await connection.query('SELECT checksum FROM schema_migrations WHERE filename=?',[archivo]);
   if(existing.length&&existing[0].checksum!==checksum)throw Error('La migracion registrada no coincide.');
   if(!existing.length)await connection.query('INSERT INTO schema_migrations (filename,checksum) VALUES (?,?)',[archivo,checksum]);
  }
  return resultados;
 }finally{connection.release();}
}
if(require.main===module){
 const aplicar=process.argv.includes('--aplicar');
 organizar(pool,aplicar,async estructura=>{
  const destino=path.resolve('tmp','estructura-previa-indices-'+Date.now()+'.json');
  fs.mkdirSync(path.dirname(destino),{recursive:true});
  fs.writeFileSync(destino,JSON.stringify(estructura,null,2),{flag:'wx'});
  console.log('Estructura previa guardada:',destino);
 }).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error('Organizacion SQL:',e.code||e.name,e.message);process.exitCode=1;}).finally(()=>pool.end());
}
module.exports={organizar,plan};
