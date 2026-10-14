const crypto=require('crypto');
const fs=require('fs');const path=require('path');
const {leerPresupuestoExcel}=require('./presupuestoImportacion');
const {leerLibroCompleto}=require('./presupuestoLibroCompleto');
const {exigir,periodoValido,centavos}=require('./presupuestosContabilidad');
async function prepararArchivos(db){
  const sql=fs.readFileSync(path.join(__dirname,'../../migrations/202610140007_presupuestos_excel_completos.sql'),'utf8');
  for(const s of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.query(s);
}
async function prepararCarga(nombre,buffer,periodo){
  exigir(periodoValido(periodo),'Período inválido.');
  const [presupuesto,libro]=await Promise.all([leerPresupuestoExcel(buffer),leerLibroCompleto(buffer)]);
  exigir(presupuesto.empresaArchivo,'No se identificó la empresa del archivo '+nombre);
  exigir(!presupuesto.errores.length,'El presupuesto no cuadra: '+nombre+' '+presupuesto.errores.join('; '));
  const meses={ENERO:'01',FEBRERO:'02',MARZO:'03',ABRIL:'04',MAYO:'05',JUNIO:'06',JULIO:'07',AGOSTO:'08',SETIEMBRE:'09',SEPTIEMBRE:'09',OCTUBRE:'10',NOVIEMBRE:'11',DICIEMBRE:'12'};
  const match=String(libro.periodoOriginal).trim().toUpperCase().match(/^([A-Z]+)\s+(20\d{2})$/);
  exigir(match&&`${match[2]}-${meses[match[1]]}`===periodo,`El período interno de ${nombre} es ${libro.periodoOriginal}; no coincide con ${periodo}.`);
  return {nombre,buffer,periodo,empresa:presupuesto.empresaArchivo,sha256:crypto.createHash('sha256').update(buffer).digest('hex'),presupuesto,libro};
}
async function cargarLote(db,cargas,actor=0){
  const resultados=[];
  for(const c of cargas){
    const [previos]=await db.query('SELECT id FROM cont_presupuesto_archivos WHERE periodo=? AND empresa=? AND sha256=? FOR UPDATE',[c.periodo,c.empresa,c.sha256]);
    if(previos.length){resultados.push({empresa:c.empresa,id:previos[0].id,omitido:true});continue;}
    const totales=new Map();for(const p of c.presupuesto.filas)totales.set(p.rubro,(totales.get(p.rubro)||0)+centavos(p.monto));
    for(const rubro of totales.keys()){
      const [existe]=await db.query('SELECT id FROM cont_presupuestos WHERE periodo=? AND empresa=? AND sede=? AND departamento=? AND moneda=? AND rubro=? FOR UPDATE',[c.periodo,c.empresa,'General de la empresa','GENERAL','CRC',rubro]);
      exigir(!existe.length,'Ya existe presupuesto para '+c.empresa+' / '+rubro+'. No se sobrescribirá.');
    }
    const datos={...c.libro,partidas:c.presupuesto.filas,hojaPresupuesto:c.presupuesto.hoja,totalControl:c.presupuesto.totalControl};
    const [archivo]=await db.query('INSERT INTO cont_presupuesto_archivos (periodo,empresa,nombre,sha256,contenido,datos,total_crc,actor) VALUES (?,?,?,?,?,?,?,?)',[c.periodo,c.empresa,c.nombre,c.sha256,c.buffer,JSON.stringify(datos),c.presupuesto.totalImportado,actor]);
    for(const [rubro,monto] of totales){
      await db.query('INSERT INTO cont_presupuestos (periodo,empresa,sede,departamento,moneda,rubro,monto,observacion,actualizado_por) VALUES (?,?,?,?,?,?,?,?,?)',[c.periodo,c.empresa,'General de la empresa','GENERAL','CRC',rubro,monto/100,`Excel completo #${archivo.insertId}: ${c.presupuesto.hoja}`,actor]);
    }
    await db.query('INSERT INTO cont_presupuesto_auditoria (actor,accion,referencia,antes,despues) VALUES (?,?,?,?,?)',[actor,'IMPORTACION_EXCEL_COMPLETO',`${c.periodo} / ${c.empresa}`,null,JSON.stringify({archivoId:archivo.insertId,nombre:c.nombre,sha256:c.sha256,hojas:c.libro.hojas.length,partidas:c.presupuesto.filas.length,totalCRC:c.presupuesto.totalImportado,erroresReferencia:c.libro.errores})]);
    resultados.push({empresa:c.empresa,id:archivo.insertId,hojas:c.libro.hojas.length,totalCRC:c.presupuesto.totalImportado,partidas:c.presupuesto.filas.length,errores:c.libro.errores});
  }
  return resultados;
}
module.exports={prepararArchivos,prepararCarga,cargarLote};
