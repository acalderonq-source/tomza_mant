const fs=require('fs');const path=require('path');const JSZip=require('jszip');
const pool=require('../db');const {prepararArchivos,prepararCarga,cargarLote}=require('../utils/presupuestoCargaCompleta');
async function main(){
  const args=process.argv.slice(2),archivo=args.find(a=>!a.startsWith('--'));
  const periodo=args.find(a=>a.startsWith('--periodo='))?.split('=')[1];
  if(!archivo||!periodo)throw new Error('Uso: node src/scripts/cargarFlujosCompletos.js FLUJOS.zip --periodo=2026-09 [--aplicar]');
  const zip=await JSZip.loadAsync(fs.readFileSync(path.resolve(archivo)));
  const entradas=Object.values(zip.files).filter(f=>!f.dir&&/^\d+-Presupuesto.*\.xlsx$/i.test(path.basename(f.name))).sort((a,b)=>a.name.localeCompare(b.name));
  if(entradas.length!==8)throw new Error('Se esperaban exactamente los ocho presupuestos individuales.');
  const cargas=[];
  for(const f of entradas)cargas.push(await prepararCarga(path.basename(f.name),await f.async('nodebuffer'),periodo));
  if(new Set(cargas.map(c=>c.empresa)).size!==8)throw new Error('Las empresas de los ocho presupuestos deben ser distintas.');
  console.log(JSON.stringify({periodo,aplicar:args.includes('--aplicar'),archivos:cargas.map(c=>({empresa:c.empresa,nombre:c.nombre,periodoInterno:c.libro.periodoOriginal,hojas:c.libro.hojas.length,partidas:c.presupuesto.filas.length,totalCRC:c.presupuesto.totalImportado,erroresReferencia:c.libro.errores,sinResultado:c.libro.sinResultado})),totalCRC:cargas.reduce((s,c)=>s+Math.round(c.presupuesto.totalImportado*100),0)/100},null,2));
  if(!args.includes('--aplicar'))return;
  await prepararArchivos(pool);
  const db=await pool.getConnection();
  try{await db.beginTransaction();const resultados=await cargarLote(db,cargas,0);await db.commit();console.log('CARGA CONFIRMADA',JSON.stringify(resultados));}
  catch(e){await db.rollback();throw e;}finally{db.release();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
