const fs=require('fs'),path=require('path');
const P=require('./presupuestosContabilidad');
async function prepararControles(db){
 const sql=fs.readFileSync(path.join(__dirname,'../../migrations/202610140009_controles_rubros.sql'),'utf8');
 for(const s of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.query(s);
 const [columnas]=await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_rubro_registros'");
 const existentes=new Set(columnas.map(c=>c.COLUMN_NAME));
 for(const [nombre,tipo] of [['proveedor',"VARCHAR(180) NOT NULL DEFAULT ''"],['documento',"VARCHAR(120) NOT NULL DEFAULT ''"],['vencimiento','DATE NULL']])if(!existentes.has(nombre)){
  try{await db.query(`ALTER TABLE cont_rubro_registros ADD COLUMN ${nombre} ${tipo}`);}catch(e){if(e.code!=='ER_DUP_FIELDNAME')throw e;}
 }
 const [origen]=await db.query("SELECT CHARACTER_MAXIMUM_LENGTH longitud FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_rubro_conceptos' AND COLUMN_NAME='celda_origen'");
 if(origen[0]&&Number(origen[0].longitud)<120)await db.query('ALTER TABLE cont_rubro_conceptos MODIFY COLUMN celda_origen VARCHAR(120) NULL');
}
function extraerConceptos(datos,rubro,detalle=true){
 const fallback=(datos.partidas||[]).filter(p=>p.rubro===rubro);
 if(!detalle)return fallback;
 if(['EXTRAORDINARIOS','INVERSIONES','PRESTAMOS','PROVISIONES'].includes(rubro)){
  let bloque='';const conceptos=[];const hoja=datos.hojas?.[0];
  for(const fila of hoja?.filas||[]){
   const c=Object.fromEntries(fila.celdas.map(c=>[c.direccion.replace(/\d/g,''),c]));
   const nombre=typeof c.B?.valor==='string'?c.B.valor.trim():'';if(!nombre)continue;
   const normal=nombre.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/:$/,'');
   const encabezado=/^EXTRAORDINARIOS$/.test(normal)?'EXTRAORDINARIOS':/^INVERSIONES?$/.test(normal)?'INVERSIONES':/^PASIVOS BANCARIOS$/.test(normal)?'PRESTAMOS':/^PROVISIONES(\s|$)/.test(normal)?'PROVISIONES':'';
   if(encabezado&&c.D?.tipo!=='numero'&&c.E?.tipo!=='numero'){bloque=encabezado;continue;}
   if(/^(TOTAL|GRAN TOTAL|SUB.?TOTAL|FOINVER|TRAMITES|PRESUPUESTOS|PAGOS CORPORATIVOS|EFECTIVO|DIFERENCIA)/.test(normal)){bloque='';continue;}
   if(bloque!==rubro||(!c.D&&!c.E))continue;
   const monto=c.D?.tipo==='numero'&&c.D.valor>=0?P.centavos(c.D.valor)/100:null;
   if(c.D?.tipo!=='numero'&&c.E?.tipo!=='numero'&&c.D?.tipo!=='error'&&c.E?.tipo!=='error')continue;
   conceptos.push({concepto:nombre,rubro,celda:hoja.nombre.trim()+'!'+(c.D?.direccion||c.E.direccion),monto});
  }
  return conceptos.length?conceptos:fallback;
 }
 const hojas=(datos.hojas||[]).filter(h=>/^(servicios|gastos generales|gastos operativos tiendas|mantenimientos?)$/i.test(h.nombre.trim()));
 const filas=[];
 for(const h of hojas){
  const tipo=/^servicios$/i.test(h.nombre.trim())?'SERVICIOS':/^mantenimientos?$/i.test(h.nombre.trim())?'MANTENIMIENTO':'GASTOS_GENERALES';
  let seccion='',columna='',combustible=false;
  for(const row of h.filas){
   const c=Object.fromEntries(row.celdas.map(c=>[c.direccion.replace(/\d/g,''),c]));
   if(c.B?.tipo==='texto'&&c.B.valor)seccion=String(c.B.valor).trim();
   const cabecera=row.celdas.find(c=>c.tipo==='texto'&&/^COLONES$/i.test(String(c.valor).trim()));
   if(cabecera){columna=cabecera.direccion.replace(/\d/g,'');combustible=tipo==='GASTOS_GENERALES'&&(/combustible|diesel/i.test(seccion)||row.celdas.some(c=>c.tipo==='texto'&&/\bLITROS\b/i.test(String(c.valor))));continue;}
   const nombre=c.C?.tipo==='texto'?String(c.C.valor).trim():c.D?.tipo==='texto'?String(c.D.valor).trim():'';
   if(!columna||!nombre||/^(total|gran total|sub.?total|cantidad|unitario|colones|dolares)\b/i.test(nombre))continue;
   const clas=tipo==='GASTOS_GENERALES'&&combustible?'COMBUSTIBLE':tipo==='MANTENIMIENTO'&&/^(alquiler|renta)\b/i.test(nombre)?'SERVICIOS':tipo;
   if(clas!==rubro||(tipo==='GASTOS_GENERALES'&&/comisiones/i.test(seccion)))continue;
   const importe=c[columna];if(!importe)continue;
   const monto=importe.tipo==='numero'&&importe.valor>=0?P.centavos(importe.valor)/100:null;
   if(importe.tipo!=='numero'&&!Object.hasOwn(importe,'formula')&&importe.tipo!=='error')continue;
   filas.push({concepto:(combustible?'Combustible · ':seccion?seccion+' · ':'')+nombre,rubro,celda:h.nombre.trim()+'!'+importe.direccion,monto});
  }
 }
 return filas.length?filas:fallback;
}
async function sincronizarConceptos(db,periodo,rubro){
 const [existentes]=await db.query('SELECT archivo_id,celda_origen FROM cont_rubro_conceptos WHERE periodo=? AND rubro=? AND archivo_id IS NOT NULL',[periodo,rubro]);
 const keys=new Set(existentes.map(c=>`${c.archivo_id}:${c.celda_origen}`));
 const [archivos]=await db.query('SELECT id,empresa,datos FROM cont_presupuesto_archivos WHERE periodo=?',[periodo]);
 for(const a of archivos){
  const datos=typeof a.datos==='string'?JSON.parse(a.datos):a.datos;
  // Una referencia ya usada se conserva, incluso si procede del resumen antiguo.
  const tieneResumen=(datos.partidas||[]).some(p=>p.rubro===rubro&&keys.has(`${a.id}:${p.celda}`));
  const filas=extraerConceptos(datos,rubro,!tieneResumen).filter(p=>!keys.has(`${a.id}:${p.celda}`));
  for(let i=0;i<filas.length;i+=100){const lote=filas.slice(i,i+100);
   await db.query(`INSERT INTO cont_rubro_conceptos (periodo,empresa,rubro,concepto,presupuesto,archivo_id,celda_origen,actualizado_por) VALUES ${lote.map(()=>'(?,?,?,?,?,?,?,0)').join(',')} ON DUPLICATE KEY UPDATE id=id`,lote.flatMap(p=>[periodo,a.empresa,rubro,p.concepto.slice(0,200),p.monto,a.id,p.celda]));
  }
 }
}
function saldo(monto,pagado=0){
 const registrado=P.centavos(monto),pago=P.centavos(pagado);
 P.exigir(registrado>=0&&pago>=0&&pago<=registrado,'El importe no puede ser menor que los pagos registrados.');
 return {registrado,pagado:pago,pendiente:registrado-pago};
}
function etiquetaRegistro(rubro){return {INVERSIONES:'Inversión registrada',PRESTAMOS:'Cuota / obligación registrada',PROVISIONES:'Reserva registrada'}[rubro]||'Gasto real registrado';}
function rubroDeHoja(nombre){const n=String(nombre||'').trim().toLowerCase();return /^servicios$/.test(n)?'SERVICIOS':/^(gastos generales|gastos operativos tiendas)$/.test(n)?'GASTOS_GENERALES':/^mantenimientos?$/.test(n)?'MANTENIMIENTO':'';}
module.exports={prepararControles,extraerConceptos,sincronizarConceptos,saldo,etiquetaRegistro,rubroDeHoja};
