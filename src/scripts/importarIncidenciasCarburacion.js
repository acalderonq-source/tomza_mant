const fs=require('node:fs');const pool=require('../db');
const {fechaValida}=require('../utils/carburacionFinanzas');
function normalizar(value){return String(value||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');}
function fechaOrigen(value){
 const raw=String(value||'').trim();let fecha=raw.slice(0,10);
 const compact=/^(\d{2})\/(\d{2})(\d{4})$/.exec(raw);
 const comun=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
 const m=compact || comun;if(m)fecha=`${m[3]}-${m[2]}-${m[1]}`;
 if(!fechaValida(fecha))throw Error(`Fecha de incidencia inválida: ${raw}`);return fecha;
}
function estadoOrigen(solucion){
 const texto=normalizar(solucion).replace(/\bserivcio\b/g,'servicio');
 if(!texto || ['no indica','pendiente','no indicado','sin solucion'].includes(texto))return 'ABIERTA';
 if(/\b(pendiente|se va a|se hara|por entregar|por cambiar|sin atender|no se ha)\b/.test(texto))return 'EN_SEGUIMIENTO';
 const resuelto=/\b(servicio restablecido|se restablece (?:el )?servicio|se restablecio (?:el )?servicio|se establecio el correcto funcionamiento|ya estan trabajando con normalidad|ya esta trabajando con normalidad|servicio realizado|trabajos realizados|mantenimiento realizado|sensor instalado|unidad(?:es)? (?:entregada|entregadas|cambiada|cambiadas|colocada)|entregado|entregada|entregados|entregadas)\b/;
 return resuelto.test(texto)?'RESUELTA':'EN_SEGUIMIENTO';
}
function prepararFila(source,row){
 if(!row.cliente_id)return null;
 if(!Number.isSafeInteger(row.cliente_id) || row.cliente_id<1 || !Number.isSafeInteger(row.fila) || row.fila<2)throw Error('Cliente o fila de origen inválidos.');
 const [fecha,hora,estacion,problema,solucion,mes,...extras]=row.valores;
 const fechaCorregida=source.correcciones_fecha_aprobadas?.[row.fila];
 if(fechaCorregida && !fechaValida(fechaCorregida))throw Error(`Corrección de fecha inválida en la fila ${row.fila}.`);
 if(!String(estacion||'').trim() || !String(problema||'').trim())throw Error(`Falta estación o problema en la fila ${row.fila}.`);
 const identidad=`Origen de importación: ${source.archivo} | hoja: ${source.hoja} | fila: ${row.fila}`;
 const descripcion=[`Estación en el archivo: ${estacion}`,`Fecha original: ${fecha}`,...(fechaCorregida?[`Fecha corregida con confirmación: ${fechaCorregida}`]:[]),`Hora reportada: ${hora || 'No indicada'}`,`Problema: ${problema}`,`Solución / atención reportada: ${solucion || 'No indicada'}`,`Mes del reporte: ${mes || 'No indicado'}`,
 ...extras.flatMap((v,i)=>v==null || v===''?[]:[`Nota de columna ${String.fromCharCode(71+i)}: ${v}`]),identidad].join('\n');
 if(descripcion.length>10000)throw Error(`La fila ${row.fila} supera el límite de descripción.`);
 const titulo=String(problema).trim().replace(/\s+/g,' ');
 return {cliente_id:row.cliente_id,fecha:fechaCorregida || fechaOrigen(fecha),titulo:titulo.length>150?titulo.slice(0,149)+'…':titulo,descripcion,estado:estadoOrigen(solucion),identidad,fila:row.fila};
}
async function importarIncidencias(source,user,options={}){
 if(!source?.archivo || !source.hoja || !Array.isArray(source.filas))throw Error('Origen de incidencias inválido.');
 const rows=source.filas.map(r=>prepararFila(source,r)).filter(Boolean);
 if(new Set(rows.map(r=>r.identidad)).size!==rows.length)throw Error('Hay filas de origen repetidas en la importación.');
 const resultado={leidas:source.filas.length,insertadas:0,existentes:0,corregidas:0,pendientes:source.filas.filter(r=>!r.cliente_id).map(r=>({fila:r.fila,estacion:r.valores[2]})),conflictos:[],porCliente:{}};
 if(!rows.length)return resultado;
 const c=await pool.getConnection();try{
  await c.beginTransaction();
  const ids=[...new Set(rows.map(r=>r.cliente_id))].sort((a,b)=>a-b);
  const [clientes]=await c.query('SELECT id FROM carburacion_clientes WHERE id IN (?) ORDER BY id FOR UPDATE',[ids]);
  if(clientes.length!==ids.length)throw Error('Un cliente de la importación no existe.');
  const [anteriores]=await c.query("SELECT id,cliente_id,descripcion FROM carburacion_cliente_incidencias WHERE descripcion LIKE '%Origen de importación:%' FOR UPDATE");
  const anterioresPorOrigen=new Map();for(const i of anteriores){const index=i.descripcion.lastIndexOf('Origen de importación:');if(index>=0)anterioresPorOrigen.set(i.descripcion.slice(index),i);}
  const nuevos=[];
  for(const row of rows){const anterior=anterioresPorOrigen.get(row.identidad);
   if(anterior){
    const original=source.correcciones_fecha_aprobadas?.[row.fila]?prepararFila({...source,correcciones_fecha_aprobadas:undefined},source.filas.find(r=>r.fila===row.fila)):null;
    if(anterior.cliente_id===row.cliente_id && original && anterior.descripcion===original.descripcion){
     await c.query('UPDATE carburacion_cliente_incidencias SET fecha=?,descripcion=?,version=version+1,actualizado_por=?,actualizado_en=CURRENT_TIMESTAMP WHERE id=?',[row.fecha,row.descripcion,user.id,anterior.id]);resultado.corregidas++;
    }else if(anterior.cliente_id!==row.cliente_id || anterior.descripcion!==row.descripcion)resultado.conflictos.push(row.fila);else resultado.existentes++;
    continue;
   }
   nuevos.push([row.cliente_id,row.titulo,row.descripcion,row.fecha,row.estado,user.id,String(user.nombre || 'Importación de Excel').slice(0,160)]);
   resultado.porCliente[row.cliente_id]=(resultado.porCliente[row.cliente_id] || 0)+1;
  }
  for(let i=0;i<nuevos.length;i+=200)await c.query('INSERT INTO carburacion_cliente_incidencias (cliente_id,titulo,descripcion,fecha,estado,creado_por,creado_nombre) VALUES ?',[nuevos.slice(i,i+200)]);
  if(options.dryRun)await c.rollback();else await c.commit();resultado.insertadas=nuevos.length;if(options.dryRun)resultado.simulacion=true;return resultado;
 }catch(error){await c.rollback();throw error;}finally{c.release();}
}
module.exports={fechaOrigen,estadoOrigen,prepararFila,importarIncidencias};
if(require.main===module){
 const archivo=process.argv[2];if(!archivo){console.error('Indique el JSON de filas verificadas y vinculadas a clientes.');process.exitCode=1;pool.end();}
 else (async()=>{const [[admin]]=await pool.query("SELECT id FROM usuarios WHERE id=1 AND rol='ADMIN'");if(!admin)throw Error('No se encontró al administrador responsable.');const resultado=await importarIncidencias(JSON.parse(fs.readFileSync(archivo,'utf8')),{id:admin.id,nombre:'Importación de Excel'},{dryRun:process.argv.includes('--dry-run')});console.log(JSON.stringify(resultado));})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
}
