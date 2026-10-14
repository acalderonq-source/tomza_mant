const test=require('node:test');const assert=require('node:assert/strict');const ExcelJS=require('exceljs');
const {leerLibroCompleto}=require('../src/utils/presupuestoLibroCompleto');
const {prepararCarga,cargarLote}=require('../src/utils/presupuestoCargaCompleta');
async function archivo(periodo='SETIEMBRE 2026'){
  const w=new ExcelJS.Workbook();const principal=w.addWorksheet('Gas Tomza');principal.getCell('B3').value=periodo;
  const presupuesto=w.addWorksheet('Ordinarios Gas Tomza');presupuesto.getCell('A1').value='GAS TOMZA DE COSTA RICA S.A.';presupuesto.getCell('B13').value='Planilla';presupuesto.getCell('B14').value='Sueldos';presupuesto.getCell('D14').value=100;presupuesto.getCell('B80').value='GRAN TOTAL PRESUPUESTO - Colones';presupuesto.getCell('D80').value=100;
  const oculta=w.addWorksheet('Detalle',{state:'hidden'});oculta.getCell('A1').value='Detalle conservado';oculta.getCell('B2').value={formula:'0+0',result:0};oculta.getCell('C2').value={formula:'1/0',result:{error:'#DIV/0!'}};oculta.getCell('D2').value={formula:'2+3'};
  return Buffer.from(await w.xlsx.writeBuffer());
}
test('lectura completa conserva todas las hojas, ocultas, fórmulas y ceros, sin esconder errores',async()=>{
  const r=await leerLibroCompleto(await archivo());assert.equal(r.hojas.length,3);assert.equal(r.hojas[2].oculta,true);assert.equal(r.errores,1);assert.equal(r.sinResultado,1);
  const c=r.hojas[2].filas.flatMap(f=>f.celdas);assert.equal(c.find(c=>c.direccion==='B2').valor,0);assert.equal(c.find(c=>c.direccion==='C2').valor,'#DIV/0!');assert.equal(c.find(c=>c.direccion==='D2').valor,null);
});
test('la carga valida el período interno y no convierte los errores de respaldo en presupuesto',async()=>{
  const c=await prepararCarga('Gas Tomza.xlsx',await archivo(),'2026-09');assert.equal(c.empresa,'GAS TOMZA');assert.equal(c.presupuesto.totalImportado,100);assert.equal(c.libro.errores,1);
  await assert.rejects(prepararCarga('Gas Tomza.xlsx',await archivo('AGOSTO 2026'),'2026-09'),/no coincide/);
});
test('la carga guarda el libro íntegro y partidas generales, sin sumar el detalle duplicado',async()=>{
  const c=await prepararCarga('Gas Tomza.xlsx',await archivo(),'2026-09'),consultas=[];
  const db={query:async(sql,params)=>{consultas.push({sql,params});return sql.startsWith('INSERT INTO cont_presupuesto_archivos')?[{insertId:5}]:[[]];}};
  const r=await cargarLote(db,[c]);assert.equal(r[0].id,5);assert.equal(r[0].hojas,3);assert.equal(r[0].totalCRC,100);
  const archivoInsert=consultas.find(c=>c.sql.startsWith('INSERT INTO cont_presupuesto_archivos'));assert.equal(JSON.parse(archivoInsert.params[5]).hojas.length,3);
  const partidas=consultas.filter(c=>c.sql.startsWith('INSERT INTO cont_presupuestos '));assert.equal(partidas.length,1);assert.equal(partidas[0].params[3],'GENERAL');assert.equal(partidas[0].params[6],100);
});
test('repetir un archivo no duplica y una partida existente no se sobrescribe',async()=>{
  const c=await prepararCarga('Gas Tomza.xlsx',await archivo(),'2026-09');let escrituras=0;
  const repetido={query:async sql=>{if(sql.startsWith('INSERT'))escrituras++;return [[{id:5}]];}};
  assert.equal((await cargarLote(repetido,[c]))[0].omitido,true);assert.equal(escrituras,0);
  const conflicto={query:async sql=>{if(sql.startsWith('INSERT'))escrituras++;return sql.includes('FROM cont_presupuestos WHERE')?[[{id:10}]]:[[]];}};
  await assert.rejects(cargarLote(conflicto,[c]),/No se sobrescribirá/);assert.equal(escrituras,0);
});
