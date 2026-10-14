const fs=require('fs'),path=require('path');
const P=require('./presupuestosContabilidad');
async function prepararPlanilla(db){
 const sql=fs.readFileSync(path.join(__dirname,'../../migrations/202610140008_planilla_contabilidad.sql'),'utf8');
 for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement);
}
function extraerPersonas(datos){
 const hoja=datos.hojas.find(h=>/planilla/i.test(h.nombre));if(!hoja)return [];
 const periodo=hoja.filas.flatMap(f=>f.celdas).find(c=>c.direccion==='A3')?.valor;
 const resultado=[];let grupo='';
 for(const fila of hoja.filas){
  const c=Object.fromEntries(fila.celdas.map(c=>[c.direccion.replace(/\d/g,''),c]));
  let nombre=typeof c.D?.valor==='string'?c.D.valor.trim():'',puesto=typeof c.E?.valor==='string'?c.E.valor.trim():'';
  if(!nombre&&puesto&&c.F?.tipo==='numero'&&c.F.valor>0){nombre=puesto;puesto='Concepto de planilla';}
  if(!nombre||/^(total|gran total|nombre|comision|salarios?\b|presupuesto|planilla\b)/i.test(nombre))continue;
  if(!puesto){if(!c.F||c.F.valor===null)grupo=nombre.slice(0,120);continue;}
  if(puesto==='PUESTO')continue;
  const valor=c.F?.tipo==='numero'?c.F.valor:null;
  if(valor!==null&&valor<0)continue;
  resultado.push({nombre:nombre.slice(0,180),puesto:puesto.slice(0,180),grupo,presupuesto:valor===null?null:P.centavos(valor)/100,fila:fila.numero,periodoOrigen:typeof periodo==='string'?periodo.slice(0,120):'Período sin confirmar'});
 }
 return resultado;
}
async function sincronizarPersonas(db,periodo){
 const [existentes]=await db.query('SELECT archivo_id,fila_origen FROM cont_planilla_personas WHERE periodo=? AND archivo_id IS NOT NULL',[periodo]);
 const claves=new Set(existentes.map(p=>`${p.archivo_id}:${p.fila_origen}`));
 const [archivos]=await db.query('SELECT id,empresa,datos FROM cont_presupuesto_archivos WHERE periodo=?',[periodo]);
 for(const a of archivos){
  const datos=typeof a.datos==='string'?JSON.parse(a.datos):a.datos;
  const personas=extraerPersonas(datos).filter(p=>!claves.has(`${a.id}:${p.fila}`));
  for(let i=0;i<personas.length;i+=100){
   const lote=personas.slice(i,i+100),params=lote.flatMap(p=>[periodo,a.empresa,p.nombre,p.puesto,p.grupo,p.presupuesto,a.id,p.fila,p.periodoOrigen]);
   await db.query(`INSERT INTO cont_planilla_personas (periodo,empresa,nombre,puesto,grupo,presupuesto,archivo_id,fila_origen,periodo_origen,actualizado_por) VALUES ${lote.map(()=>'(?,?,?,?,?,?,?,?,?,0)').join(',')} ON DUPLICATE KEY UPDATE id=id`,params);
  }
 }
}
function validarFecha(v){
 P.exigir(/^20\d{2}-\d{2}-\d{2}$/.test(String(v||'')),'Indique una fecha válida.');
 const d=new Date(v+'T12:00:00Z');P.exigir(Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v,'Indique una fecha válida.');return v;
}
function calcular(salario,extras,rebajos,pagado=0){
 const bruto=P.centavos(salario)+P.centavos(extras),deducciones=P.centavos(rebajos),pago=P.centavos(pagado);
 P.exigir(bruto>=0&&deducciones>=0&&deducciones<=bruto,'Los rebajos no pueden superar el salario más los extras.');
 P.exigir(pago<=bruto-deducciones,'El neto no puede ser menor que los pagos ya registrados.');
 return {bruto,rebajos:deducciones,neto:bruto-deducciones,pagado:pago,saldo:bruto-deducciones-pago};
}
module.exports={prepararPlanilla,extraerPersonas,sincronizarPersonas,validarFecha,calcular};
