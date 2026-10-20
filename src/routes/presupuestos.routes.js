const router=require('express').Router();
const pool=require('../db');
const fs=require('fs');
const path=require('path');
const {leerPresupuestoExcel}=require('../utils/presupuestoImportacion');
const {DEPARTAMENTOS}=require('../utils/departamentos');
const {TODAS_SEDES}=require('../utils/sedes');
const {fechaActualCostaRica}=require('../utils/fechaCostaRica');
const P=require('../utils/presupuestosContabilidad');
const {EMPRESAS_BASE,GRUPOS_OPERATIVOS,normalizarEmpresa}=require('../utils/empresasContabilidad');
const {prepararArchivos}=require('../utils/presupuestoCargaCompleta');
const {prepararPlanilla}=require('../utils/planillaContabilidad');
const {prepararControles,rubroDeHoja}=require('../utils/controlesRubros');
const DEPARTAMENTOS_PRESUPUESTO=[{key:'GENERAL',nombre:'General de la empresa'},...DEPARTAMENTOS.filter(d=>d.key!=='ADMINISTRACION')];
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
let preparando;
async function preparar(){
  if(!preparando)preparando=(async()=>{
    const sql=fs.readFileSync(path.join(__dirname,'../../migrations/202610140005_presupuestos_contabilidad.sql'),'utf8');
    for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await pool.query(statement);
    for(const tabla of ['cont_presupuestos','cont_clasificaciones']){
      const [columnas]=await pool.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[tabla,'empresa']);
      if(!columnas.length){try{await pool.query(`ALTER TABLE ${tabla} ADD COLUMN empresa VARCHAR(120) NOT NULL DEFAULT ''`);}catch(e){if(e.code!=='ER_DUP_FIELDNAME')throw e;}}
    }
    const [indice]=await pool.query("SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_presupuestos' AND INDEX_NAME='uq_cont_presupuesto' AND COLUMN_NAME='empresa'");
    if(!indice.length)await pool.query('ALTER TABLE cont_presupuestos DROP INDEX uq_cont_presupuesto, ADD UNIQUE KEY uq_cont_presupuesto (periodo,empresa,sede,departamento,moneda,rubro)');
    await prepararArchivos(pool);
    await prepararPlanilla(pool);
    await prepararControles(pool);
  })().catch(e=>{preparando=null;throw e;});
  return preparando;
}
router.use((req,res,next)=>{
  if(!req.session?.user)return res.redirect('/login');
  if(!['ADMIN','CONTABILIDAD'].includes(req.session.user.rol))return res.status(403).send('Solo Contabilidad y Administración pueden gestionar presupuestos.');
  res.set('Cache-Control','no-store');next();
});
for(const ruta of ['/planilla','/modulos','/rubros','/archivos'])router.use(ruta,require('../middleware/finanzasAdministracion'));
router.use(wrap(async(_req,_res,next)=>{await preparar();next();}));
router.get('/modulos/:rubro',wrap(async(req,res)=>{
  const rubro=P.RUBROS.find(r=>r.key===req.params.rubro&&r.key!=='PLANILLA');
  if(!rubro)return res.status(404).send('Módulo no encontrado.');
  const [meses]=await pool.query('SELECT periodo FROM cont_rubro_conceptos WHERE rubro=? UNION SELECT periodo FROM cont_presupuesto_archivos ORDER BY periodo DESC LIMIT 1',[rubro.key]);
  const periodo=req.query.periodo||meses[0]?.periodo||fechaActualCostaRica().slice(0,7);
  res.redirect('/contabilidad/presupuestos/rubros/'+rubro.key+'?'+new URLSearchParams(filtros({...req.query,periodo})));
}));
router.use('/planilla',require('./planillaContabilidad.routes'));
router.use('/rubros/:rubro',require('./controlesRubros.routes'));
router.get('/resumen-ejecutivo',wrap(async(req,res)=>{
  let periodo=req.query.periodo;
  if(!periodo){const [meses]=await pool.query('SELECT MAX(periodo) periodo FROM cont_presupuestos');periodo=meses[0]?.periodo||fechaActualCostaRica().slice(0,7);}
  const f=filtros({...req.query,periodo});
  const meses=require('../utils/dashboardPresupuestos').mesesHasta(f.periodo);
  const [{docs,advertencias},[presupuestos],[clasificaciones]]=await Promise.all([P.cargarDocumentos(pool),pool.query('SELECT * FROM cont_presupuestos WHERE periodo BETWEEN ? AND ?',[meses[0],f.periodo]),pool.query('SELECT * FROM cont_clasificaciones')]);
  const datos=require('../utils/dashboardPresupuestos').construir({docs,clasificaciones,presupuestos,f});
  const sedes=[...new Set([...TODAS_SEDES,...presupuestos.map(p=>p.sede),...docs.map(d=>d.sede),...clasificaciones.map(c=>c.sede)].filter(Boolean))].sort();
  res.render('contabilidad/dashboard_presupuesto',{user:req.session.user,f,...datos,sedes,departamentos:DEPARTAMENTOS_PRESUPUESTO,advertencias:[...new Set(advertencias)]});
}));
function filtros(q){
  const periodo=String(q.periodo||fechaActualCostaRica().slice(0,7));P.exigir(P.periodoValido(periodo),'Seleccione un mes válido.');
  const moneda=String(q.moneda||'CRC');P.exigir(P.MONEDAS.includes(moneda),'Moneda inválida.');
  const sede=String(q.sede||'').trim(),departamento=String(q.departamento||'');
  P.exigir(sede.length<=120,'Sede inválida.');
  P.exigir(!departamento||DEPARTAMENTOS_PRESUPUESTO.some(d=>d.key===departamento),'Departamento inválido.');
  const empresa=normalizarEmpresa(q.empresa);P.exigir(empresa.length<=120,'Empresa inválida.');
  return {periodo,moneda,sede,departamento,empresa};
}
function dimensiones(body){
  const sede=String(body.sede||'').trim(),departamento=String(body.departamento||''),rubro=String(body.rubro||''),moneda=String(body.moneda||'');
  P.exigir(sede&&sede.length<=120&&sede!=='TODAS','Indique una sede específica.');
  P.exigir(DEPARTAMENTOS_PRESUPUESTO.some(d=>d.key===departamento),'Seleccione un departamento.');
  P.exigir(P.RUBROS.some(r=>r.key===rubro),'Seleccione un rubro.');
  P.exigir(P.MONEDAS.includes(moneda),'Seleccione CRC o USD.');
  const empresa=normalizarEmpresa(body.empresa);
  P.exigir(empresa&&empresa.length<=120&&empresa!=='__SIN_EMPRESA__','Indique la empresa destinataria.');
  return {sede,departamento,rubro,moneda,empresa};
}
async function transaccion(fn){const db=await pool.getConnection();try{await db.beginTransaction();const r=await fn(db);await db.commit();return r;}catch(e){await db.rollback();throw e;}finally{db.release();}}
async function auditoria(db,actor,accion,referencia,antes,despues){await db.query('INSERT INTO cont_presupuesto_auditoria (actor,accion,referencia,antes,despues) VALUES (?,?,?,?,?)',[actor,accion,referencia,antes?JSON.stringify(antes):null,JSON.stringify(despues)]);}
async function guardarPresupuesto(db,b,actor,version,id=null){
  const params=[b.periodo,b.empresa,b.sede,b.departamento,b.moneda,b.rubro];
  const [rows]=await db.query(id?'SELECT * FROM cont_presupuestos WHERE id=? FOR UPDATE':'SELECT * FROM cont_presupuestos WHERE periodo=? AND empresa=? AND sede=? AND departamento=? AND moneda=? AND rubro=? FOR UPDATE',id?[id]:params);
  const antes=rows[0];
  if(id)P.exigir(antes&&['periodo','sede','departamento','moneda','rubro'].every(k=>antes[k]===b[k]),'La partida cambió. Recargue la pantalla.');
  if(version!=null&&Number(version)!==Number(antes?.version||0))throw Object.assign(new Error('El presupuesto cambió. Recargue la pantalla antes de guardar.'),{status:409});
  if(antes)await db.query('UPDATE cont_presupuestos SET empresa=?,monto=?,observacion=?,version=version+1,actualizado_por=? WHERE id=?',[b.empresa,b.monto,b.observacion,actor,antes.id]);
  else await db.query('INSERT INTO cont_presupuestos (periodo,empresa,sede,departamento,moneda,rubro,monto,observacion,actualizado_por) VALUES (?,?,?,?,?,?,?,?,?)',[...params,b.monto,b.observacion,actor]);
  await auditoria(db,actor,antes?'AJUSTE_PRESUPUESTO':'NUEVO_PRESUPUESTO',params.join(' / '),antes,b);
}
function volver(req,res){const f=filtros(req.body);res.redirect('/contabilidad/presupuestos?'+new URLSearchParams(f));}
router.get('/',wrap(async(req,res)=>{
  let periodo=req.query.periodo;
  if(!periodo){const [meses]=await pool.query('SELECT MAX(periodo) periodo FROM cont_presupuestos');periodo=meses[0]?.periodo||fechaActualCostaRica().slice(0,7);}
  const f=filtros({...req.query,periodo});
  const estadoDocumento=String(req.query.estado_documento||'todos'),fuenteDocumento=String(req.query.fuente_documento||'');
  P.exigir(['todos','pendientes','incluidos'].includes(estadoDocumento)&&(!fuenteDocumento||[...P.FUENTES,'PLANILLA','CONTROL_RUBRO'].includes(fuenteDocumento)),'Filtro de documentos inválido.');
  Object.assign(f,{estado_documento:estadoDocumento,fuente_documento:fuenteDocumento});
  const [{docs,advertencias},[presupuestos],[clasificaciones],[historial]]=await Promise.all([
    P.cargarDocumentos(pool),pool.query('SELECT * FROM cont_presupuestos WHERE periodo=?',[f.periodo]),
    pool.query('SELECT * FROM cont_clasificaciones'),
    pool.query('SELECT a.actor,a.accion,a.referencia,a.creado_en,u.usuario FROM cont_presupuesto_auditoria a LEFT JOIN usuarios u ON u.id=a.actor ORDER BY a.id DESC LIMIT 20')
  ]);
  const sedes=[...new Set([...TODAS_SEDES,...docs.map(d=>d.sede),...presupuestos.map(b=>b.sede),...clasificaciones.map(c=>c.sede)].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  const [empresasGuardadas]=await pool.query("SELECT DISTINCT empresa FROM cont_presupuestos WHERE empresa<>'' UNION SELECT DISTINCT empresa FROM cont_clasificaciones WHERE empresa<>''");
  const empresas=[...new Set([...EMPRESAS_BASE,...docs.map(d=>d.empresa),...empresasGuardadas.map(b=>b.empresa),...presupuestos.map(b=>b.empresa)].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  const resultado=P.resumen({docs,clasificaciones,presupuestos,...f});
  const resumenEmpresas=empresas.filter(e=>!f.empresa||e===f.empresa).map(empresa=>{
    const r=P.resumen({docs,clasificaciones,presupuestos,...f,empresa});
    return r.filas.reduce((total,fila)=>{for(const k of ['presupuesto','facturado','pagado','disponible'])total[k]+=fila[k];return total;},{empresa,presupuesto:0,facturado:0,pagado:0,disponible:0,pendientes:r.pendientes});
  });
  const pendientesGlobales=P.resumen({docs,clasificaciones,presupuestos:[],periodo:f.periodo,moneda:f.moneda}).pendientes;
  const documentosTotal=resultado.documentos.length;
  resultado.documentos=resultado.documentos.filter(d=>(estadoDocumento==='todos'||(estadoDocumento==='incluidos'?d.incluido:!d.incluido))&&(!fuenteDocumento||d.fuente===fuenteDocumento)).sort((a,b)=>String(b.fechaFactura||b.fechaOrden||'').localeCompare(String(a.fechaFactura||a.fechaOrden||''))||b.id-a.id);
  const pagina=Math.max(1,Math.min(Math.ceil(resultado.documentos.length/50)||1,Number.parseInt(req.query.pagina,10)||1));
  const mensaje=req.session.presupuestoMensaje;delete req.session.presupuestoMensaje;
  const [archivos]=await pool.query('SELECT id,empresa,nombre,total_crc,JSON_LENGTH(datos,\'$.hojas\') hojas,JSON_EXTRACT(datos,\'$.errores\') errores FROM cont_presupuesto_archivos WHERE periodo=? ORDER BY empresa',[f.periodo]);
  res.render('contabilidad/presupuestos',{user:req.session.user,f,empresas,resumenEmpresas,sedes,pagina,documentosTotal,pendientesGlobales,archivos:archivos.filter(a=>!f.empresa||a.empresa===f.empresa),departamentos:DEPARTAMENTOS_PRESUPUESTO,rubros:P.RUBROS,...resultado,presupuestos,advertencias:[...new Set(advertencias)],historial,mensaje,importacion:req.session.presupuestoImportacion||null});
}));
router.get('/archivos/:id',wrap(async(req,res)=>{
  const id=Number(req.params.id);P.exigir(Number.isSafeInteger(id)&&id>0,'Archivo inválido.');
  const [rows]=await pool.query('SELECT id,periodo,empresa,nombre,datos,total_crc,creado_en FROM cont_presupuesto_archivos WHERE id=?',[id]);
  if(!rows.length)return res.status(404).send('Archivo no encontrado.');
  const archivo=rows[0],datos=typeof archivo.datos==='string'?JSON.parse(archivo.datos):archivo.datos;
  const indice=Number(req.query.hoja||0);P.exigir(Number.isInteger(indice)&&indice>=0&&indice<datos.hojas.length,'Hoja inválida.');
  const hoja=datos.hojas[indice],paginas=Math.max(1,Math.ceil(hoja.filas.length/60)),pagina=Math.max(1,Math.min(paginas,Number.parseInt(req.query.pagina,10)||1));
  if(/planilla/i.test(hoja.nombre))return res.redirect('/contabilidad/presupuestos/planilla?'+new URLSearchParams({periodo:archivo.periodo,empresa:archivo.empresa,moneda:'CRC'}));
  const control=rubroDeHoja(hoja.nombre);
  if(control)return res.redirect('/contabilidad/presupuestos/rubros/'+control+'?'+new URLSearchParams({periodo:archivo.periodo,empresa:archivo.empresa,moneda:'CRC'}));
  const columnas=[...new Set(hoja.filas.flatMap(r=>r.celdas.map(c=>c.direccion.replace(/\d/g,''))))].sort((a,b)=>a.length-b.length||a.localeCompare(b));
  const urlHoja=(h,i)=>/planilla/i.test(h.nombre)?'/contabilidad/presupuestos/planilla?'+new URLSearchParams({periodo:archivo.periodo,empresa:archivo.empresa,moneda:'CRC'}):rubroDeHoja(h.nombre)?'/contabilidad/presupuestos/rubros/'+rubroDeHoja(h.nombre)+'?'+new URLSearchParams({periodo:archivo.periodo,empresa:archivo.empresa,moneda:'CRC'}):'?hoja='+i;
  res.render('contabilidad/archivo_excel',{user:req.session.user,archivo,datos,hoja,indice,pagina,paginas,columnas,urlHoja,filas:hoja.filas.slice((pagina-1)*60,pagina*60)});
}));
router.get('/archivos/:id/original',wrap(async(req,res)=>{
  const id=Number(req.params.id);P.exigir(Number.isSafeInteger(id)&&id>0,'Archivo inválido.');
  const [rows]=await pool.query('SELECT nombre,contenido FROM cont_presupuesto_archivos WHERE id=?',[id]);
  if(!rows.length)return res.status(404).send('Archivo no encontrado.');
  res.attachment(rows[0].nombre).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(rows[0].contenido);
}));
router.get('/reporte.csv',wrap(async(req,res)=>{
  const f=filtros(req.query);
  const [{docs,advertencias},[presupuestos],[clasificaciones]]=await Promise.all([P.cargarDocumentos(pool),pool.query('SELECT * FROM cont_presupuestos WHERE periodo=?',[f.periodo]),pool.query('SELECT * FROM cont_clasificaciones')]);
  const r=P.resumen({docs,clasificaciones,presupuestos,...f});
  const celda=v=>{let s=String(v??'');if(/^\s*[=+@\-]/.test(s)&&!/^\-?\d+(\.\d+)?$/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const rows=[['Presupuesto y ejecución',f.periodo,f.moneda,f.empresa||'Todas las empresas',f.sede||'Todas las sedes',f.departamento||'Todos los departamentos'],['Documentos pendientes excluidos',r.pendientes],...advertencias.map(a=>['Advertencia',a]),[],['Rubro','Presupuesto','Ordenado','Por facturar','Ejecutado / facturado','Pagado','Disponible'],...r.filas.map(x=>[x.nombre,...['presupuesto','ordenado','compromiso','facturado','pagado','disponible'].map(k=>(x[k]/100).toFixed(2))]),[],['Fuente','Documento','Proveedor','Empresa','Sede','Departamento','Moneda','Rubro','Incluido en resumen','Motivo de exclusión','Ordenado','Ejecutado / facturado','Pagado'],...r.documentos.map(d=>[d.fuente,d.referencia,d.proveedor,d.empresa||'Sin empresa asignada',d.sede,d.departamento,d.moneda,d.rubro||'',d.incluido?'Sí':'No',d.motivoExclusion,d.ordenMes/100,d.facturaMes/100,d.pagoMes/100])];
  res.attachment(`presupuestos-${f.periodo}-${f.moneda}.csv`).type('text/csv; charset=utf-8').send('\uFEFF'+rows.map(row=>row.map(celda).join(';')).join('\r\n'));
}));
router.post('/guardar',wrap(async(req,res)=>{
  const b={...dimensiones(req.body),periodo:String(req.body.periodo||''),monto:P.montoValido(req.body.monto),observacion:String(req.body.observacion||'').trim()};
  P.exigir(P.periodoValido(b.periodo),'Mes inválido.');P.exigir(b.observacion.length<=500,'Observación demasiado larga.');
  P.exigir(/^\d+$/.test(String(req.body.version)),'Versión inválida.');
  const id=req.body.id?Number(req.body.id):null;P.exigir(!req.body.id||(Number.isSafeInteger(id)&&id>0),'Partida inválida.');
  await transaccion(db=>guardarPresupuesto(db,b,req.session.user.id,req.body.version,id));
  req.session.presupuestoMensaje='Presupuesto guardado. El cambio quedó en el historial.';volver(req,res);
}));
router.post('/clasificar',wrap(async(req,res)=>{
  const c=dimensiones(req.body),fuente=String(req.body.fuente),id=Number(req.body.documento_id);
  P.exigir(P.FUENTES.includes(fuente)&&Number.isSafeInteger(id)&&id>0,'Documento inválido.');
  const {docs}=await P.cargarDocumentos(pool),doc=docs.find(d=>d.fuente===fuente&&d.id===id);
  P.exigir(doc,'Documento no encontrado.');P.exigir(!doc.moneda||doc.moneda===c.moneda,'La moneda debe coincidir con el documento original.');
  P.exigir(!doc.empresa||doc.empresa===c.empresa||GRUPOS_OPERATIVOS.includes(c.empresa),'La empresa debe coincidir con el documento original o ser una de las unidades de presupuesto.');
  await transaccion(async db=>{
    const [rows]=await db.query('SELECT * FROM cont_clasificaciones WHERE fuente=? AND documento_id=? FOR UPDATE',[fuente,id]);
    await db.query('INSERT INTO cont_clasificaciones (fuente,documento_id,empresa,sede,departamento,rubro,moneda,actualizado_por) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE empresa=VALUES(empresa),sede=VALUES(sede),departamento=VALUES(departamento),rubro=VALUES(rubro),moneda=VALUES(moneda),actualizado_por=VALUES(actualizado_por)',[fuente,id,c.empresa,c.sede,c.departamento,c.rubro,c.moneda,req.session.user.id]);
    await auditoria(db,req.session.user.id,'CLASIFICACION',`${fuente}:${id}`,rows[0],c);
  });
  req.session.presupuestoMensaje='Clasificación guardada. Se aplica a la orden, factura y sus pagos relacionados.';volver(req,res);
}));
router.post('/copiar',wrap(async(req,res)=>{
  const destino=filtros(req.body),origen=String(req.body.origen||'');
  P.exigir(P.periodoValido(origen)&&origen!==destino.periodo,'Seleccione un mes de origen diferente.');
  let copiados=0;
  await transaccion(async db=>{
    const [rows]=await db.query('SELECT * FROM cont_presupuestos WHERE periodo=?',[origen]);
    for(const b of rows.filter(b=>b.empresa&&(!destino.empresa||b.empresa===destino.empresa)&&(!destino.sede||b.sede===destino.sede)&&(!destino.departamento||b.departamento===destino.departamento)&&b.moneda===destino.moneda)){
      const [existe]=await db.query('SELECT id FROM cont_presupuestos WHERE periodo=? AND empresa=? AND sede=? AND departamento=? AND moneda=? AND rubro=? FOR UPDATE',[destino.periodo,b.empresa,b.sede,b.departamento,b.moneda,b.rubro]);
      if(existe.length)continue;
      await guardarPresupuesto(db,{...b,periodo:destino.periodo,observacion:'Copiado de '+origen},req.session.user.id,0);copiados++;
    }
  });
  req.session.presupuestoMensaje=`Se copiaron ${copiados} partidas. Las que ya existían se conservaron.`;volver(req,res);
}));
router.post('/importar/preview',wrap(async(req,res)=>{
  const contexto={...dimensiones({...req.body,rubro:'GASTOS_GENERALES'}),periodo:String(req.body.periodo)};
  P.exigir(P.periodoValido(contexto.periodo),'Mes inválido.');
  const archivo=String(req.body.archivo||'');P.exigir(archivo&&archivo.length<7100000,'Seleccione un Excel de hasta 5 MB.');
  P.exigir(contexto.moneda==='CRC','Las hojas Ordinarios se importan desde la columna D en colones (CRC).');
  let vista;
  try{vista=await leerPresupuestoExcel(Buffer.from(archivo,'base64'));}
  catch(e){if(e.status)throw e;throw Object.assign(new Error('No se pudo leer el Excel. Seleccione un archivo .xlsx válido.'),{status:400});}
  P.exigir(!vista.empresaArchivo||vista.empresaArchivo===contexto.empresa,`El Excel corresponde a ${vista.empresaArchivo}. Seleccione esa empresa para importarlo.`);
  req.session.presupuestoImportacion={...contexto,...vista,token:require('crypto').randomUUID()};
  req.session.presupuestoMensaje='Vista previa preparada. Revise el período y las partidas antes de confirmar.';volver(req,res);
}));
router.post('/importar/confirmar',wrap(async(req,res)=>{
  const vista=req.session.presupuestoImportacion;
  P.exigir(vista&&vista.token===req.body.token,'La vista previa venció. Vuelva a cargar el archivo.');
  P.exigir(vista.empresa,'La vista previa no tiene empresa. Vuelva a preparar la importación.');
  P.exigir(!vista.errores.length,'El archivo tiene errores. Corríjalos antes de importar.');
  await transaccion(async db=>{
    const totales=new Map();for(const f of vista.filas)totales.set(f.rubro,(totales.get(f.rubro)||0)+P.centavos(f.monto));
    for(const [rubro,monto] of totales)await guardarPresupuesto(db,{periodo:vista.periodo,empresa:vista.empresa,sede:vista.sede,departamento:vista.departamento,moneda:vista.moneda,rubro,monto:monto/100,observacion:`Importación: ${vista.hoja}`},req.session.user.id,0);
  });
  delete req.session.presupuestoImportacion;req.session.presupuestoMensaje='Presupuesto importado. No se sobrescribieron partidas existentes.';
  res.redirect('/contabilidad/presupuestos?'+new URLSearchParams({periodo:vista.periodo,empresa:vista.empresa,sede:vista.sede,departamento:vista.departamento,moneda:vista.moneda}));
}));
router.post('/importar/cancelar',(req,res)=>{delete req.session.presupuestoImportacion;volver(req,res);});
router.use((err,req,res,_next)=>{
  console.error('Presupuestos:',err.code||err.message);
  const status=err.status||((err.code==='ER_DUP_ENTRY'||err.code==='ER_LOCK_DEADLOCK')?409:500);
  const mensaje=err.code==='ER_DUP_ENTRY'?'Ya existe esa partida o referencia de pago. Revise el registro antes de volver a guardar.':err.code==='ER_LOCK_DEADLOCK'?'Otro usuario está actualizando este registro. Recargue la pantalla y vuelva a intentar.':status<500?err.message:'No se pudo completar la operación. Revise la conexión y vuelva a intentar.';
  res.status(status).render('contabilidad/error',{mensaje});
});
module.exports=router;
