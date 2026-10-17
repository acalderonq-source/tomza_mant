const fs = require('node:fs');
const path = require('node:path');
const pool = require('../db');

async function auditar(db) {
  const [tablas] = await db.query(`SELECT TABLE_NAME nombre,ENGINE motor,TABLE_ROWS filas_estimadas,
    TABLE_COLLATION cotejamiento,DATA_LENGTH datos_bytes,INDEX_LENGTH indices_bytes
    FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`);
  const [columnas] = await db.query(`SELECT TABLE_NAME tabla,COLUMN_NAME columna,COLUMN_TYPE tipo,IS_NULLABLE permite_nulos
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION`);
  const [indices] = await db.query(`SELECT TABLE_NAME tabla,INDEX_NAME nombre,NON_UNIQUE no_unico,SEQ_IN_INDEX posicion,COLUMN_NAME columna
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`);
  const [relaciones] = await db.query(`SELECT TABLE_NAME tabla,COLUMN_NAME columna,REFERENCED_TABLE_NAME tabla_destino,REFERENCED_COLUMN_NAME columna_destino
    FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`);
  const nombres = new Set(tablas.map(t=>t.nombre));
  const comprobaciones = [];
  const verificar = async (nombre, requeridas, sql) => {
    if (!requeridas.every(t=>nombres.has(t))) return;
    const [[row]] = await db.query(sql);
    comprobaciones.push({nombre,cantidad:Number(row.cantidad)});
  };
  await verificar('Proveedores con nombre repetido', ['proveedores'], `SELECT COUNT(*) cantidad FROM (SELECT UPPER(TRIM(nombre)) n FROM proveedores GROUP BY n HAVING COUNT(*)>1) d`);
  await verificar('Placas repetidas', ['unidades'], `SELECT COUNT(*) cantidad FROM (SELECT UPPER(REPLACE(TRIM(placa),' ','')) n FROM unidades WHERE TRIM(COALESCE(placa,''))<>'' GROUP BY n HAVING COUNT(*)>1) d`);
  await verificar('Facturas independientes repetidas por proveedor y numero', ['facturas'], `SELECT COUNT(*) cantidad FROM (SELECT proveedor_id,UPPER(TRIM(numero_factura)) n FROM facturas WHERE proveedor_id IS NOT NULL GROUP BY proveedor_id,n HAVING COUNT(*)>1) d`);
  await verificar('Ordenes sin proveedor existente', ['ordenes_compra','proveedores'], `SELECT COUNT(*) cantidad FROM ordenes_compra o LEFT JOIN proveedores p ON p.id=o.proveedor_id WHERE p.id IS NULL`);
  await verificar('Lineas sin orden existente', ['ordenes_compra_detalle','ordenes_compra'], `SELECT COUNT(*) cantidad FROM ordenes_compra_detalle d LEFT JOIN ordenes_compra o ON o.id=d.orden_compra_id WHERE o.id IS NULL`);
  await verificar('Mantenimientos sin unidad existente', ['mantenimientos','unidades'], `SELECT COUNT(*) cantidad FROM mantenimientos m LEFT JOIN unidades u ON u.id=m.unidad_id WHERE u.id IS NULL`);
  const sinPrimaria=tablas.filter(t=>!indices.some(i=>i.tabla===t.nombre&&i.nombre==='PRIMARY')).map(t=>t.nombre);
  return {generado:new Date().toISOString(),soloLectura:true,tablas,columnas,indices,relaciones,sinPrimaria,comprobaciones};
}

function diccionario(informe) {
  const lineas=['# Diccionario SQL de Gas Tomza','',`Generado: ${informe.generado}`,'','No contiene datos de trabajadores, proveedores, facturas ni credenciales. Las cantidades de filas son estimaciones de MySQL.','',`Tablas: ${informe.tablas.length}. Relaciones declaradas: ${informe.relaciones.length}.`,'','## Comprobaciones',''];
  for(const c of informe.comprobaciones)lineas.push(`- ${c.nombre}: ${c.cantidad}.`);
  lineas.push('','## Tablas sin clave primaria','',...informe.sinPrimaria.map(t=>' - `'+t+'`'),'','Son tablas auxiliares o historicas por revisar; no se han eliminado ni modificado.');
  for(const tabla of informe.tablas) {
    lineas.push('',`## ${tabla.nombre}`,'',`Motor: ${tabla.motor}. Cotejamiento: ${tabla.cotejamiento}. Filas estimadas: ${tabla.filas_estimadas}.`,'','| Columna | Tipo SQL | Permite nulos |','|---|---|---|');
    for(const c of informe.columnas.filter(c=>c.tabla===tabla.nombre))lineas.push(`| ${c.columna} | ${String(c.tipo).replace(/\|/g,'\\|')} | ${c.permite_nulos} |`);
    const grupos=new Map();
    for(const i of informe.indices.filter(i=>i.tabla===tabla.nombre)){
      if(!grupos.has(i.nombre))grupos.set(i.nombre,[]);grupos.get(i.nombre).push(i);
    }
    lineas.push('','Indices:');
    for(const [nombre,items] of grupos)lineas.push(`- ${nombre}: (${items.sort((a,b)=>a.posicion-b.posicion).map(i=>i.columna).join(', ')})${Number(items[0].no_unico)===0?' UNIQUE':''}.`);
    for(const r of informe.relaciones.filter(r=>r.tabla===tabla.nombre))lineas.push(`- Relacion: ${r.columna} -> ${r.tabla_destino}.${r.columna_destino}.`);
  }
  return lineas.join('\n')+'\n';
}

if(require.main===module) {
  auditar(pool).then(informe=>{
    const destino=process.argv[2];
    if(destino) { const archivo=path.resolve(destino);fs.mkdirSync(path.dirname(archivo),{recursive:true});fs.writeFileSync(archivo,JSON.stringify(informe,null,2)); }
    if(process.argv[3]) { const archivo=path.resolve(process.argv[3]);fs.mkdirSync(path.dirname(archivo),{recursive:true});fs.writeFileSync(archivo,diccionario(informe)); }
    console.log(JSON.stringify({tablas:informe.tablas.length,indices:informe.indices.length,relaciones:informe.relaciones.length,sinPrimaria:informe.sinPrimaria,comprobaciones:informe.comprobaciones,archivo:destino||null},null,2));
  }).catch(e=>{console.error('No se pudo auditar:',e.code||e.name,e.message);process.exitCode=1;}).finally(()=>pool.end());
}
module.exports={auditar,diccionario};
