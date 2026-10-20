const express=require('express');
const pool=require('../db');
const ExcelJS=require('exceljs');
const servicio=require('../utils/contabilidadDocumentos');
const {EMPRESAS_BASE}=require('../utils/empresasContabilidad');
const router=express.Router();
router.use((req,res,next)=>{
  if(!req.session?.user)return res.redirect('/login');
  if(!['ADMIN','CONTABILIDAD'].includes(req.session.user.rol))return res.status(403).send('Solo Contabilidad y Administración.');
  res.set('Cache-Control','no-store');res.locals.user=req.session.user;next();
});
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
router.get('/descargas-pdf',wrap(async(req,res)=>{
  const pdf={...require('../utils/pasivosPdf'),...require('../utils/pasivosPdfOutlook')};
  let f={desde:'',hasta:''},filas=[],mensaje='';
  if(req.query.desde||req.query.hasta){
    try{f={...pdf.fechas(req.query),empresa:['GAS TOMZA','SUPER GAS'].includes(req.query.empresa)?req.query.empresa:'',grupo:['OTROS','TALLER'].includes(req.query.grupo)?req.query.grupo:''};}catch(e){return res.status(400).render('contabilidad/descargas_pdf',{f,filas,mensaje:e.message});}
    try{filas=await pdf.cargar(pool,f);}catch(e){console.error('Descargas Outlook:',e.errorCode||e.code||e.status||'ERROR',e.message);mensaje=pdf.mensajeError(e);}
  }
  if(req.query.descargar==='1'&&!mensaje){
    const zip=new (require('jszip'))(),usados=new Set();
    let cantidad=0,totalBytes=0;
    const disponibles=filas.filter(r=>r.xmlBuffer);
    for(let inicio=0;inicio<disponibles.length;inicio+=2){
    const lote=await pdf.paralelo(disponibles.slice(inicio,inicio+2),async r=>{
      try{return {r,buffer:r.disponible?await pdf.contenido(pool,r):null,xml:await pdf.xml(pool,r)};}catch(e){return {r,error:e};}
    });
    for(const item of lote){
      const {r}=item;
      if(item.error){r.disponible=false;r.error='No se pudo descargar el PDF. Volvé a intentar.';continue;}
      const buffer=item.buffer;totalBytes+=(buffer?.length||0)+item.xml.length;
      if(totalBytes>100*1024*1024){mensaje='La descarga supera 100 MB. Seleccioná un período menor.';break;}
      const base=pdf.nombre(r.proveedor_nombre)+'_'+pdf.nombre(r.numero_factura);
      let archivo=base,n=2;while(usados.has(archivo.toLowerCase()))archivo=base+'_'+n++;
      usados.add(archivo.toLowerCase());if(buffer)zip.file(archivo+'.pdf',buffer);zip.file(archivo+'.xml',item.xml);cantidad++;
    }
    if(mensaje)break;
    }
    // Presentar cualquier faltante antes de entregar una descarga parcial.
    if(filas.some(r=>r.error))mensaje='Hay PDF ausentes o inválidos. Revisá los adjuntos indicados antes de descargar.';
    else if(cantidad&&!mensaje){res.type('application/zip').attachment(`Facturas_pasivos_${f.desde}_${f.hasta}.zip`);return zip.generateNodeStream({streamFiles:true,compression:'STORE'}).on('error',e=>res.destroy(e)).pipe(res);}
    else if(!mensaje)mensaje='No hay facturas PDF o XML disponibles en este período.';
  }
  res.render('contabilidad/descargas_pdf',{f,filas,mensaje});
}));
function filtros(q){return Object.fromEntries(['tipo','origen','estado','empresa','desde','hasta','q','pago','proveedor'].map(k=>[k,String(q[k]||'').slice(0,180)]));}
router.get('/',wrap(async(req,res)=>{
  const {docs,advertencias}=await servicio.cargar(pool),f=filtros(req.query),filas=servicio.filtrar(docs,f);
  const pagina=Math.max(1,Math.min(Math.ceil(filas.length/75)||1,parseInt(req.query.pagina,10)||1));
  res.render('contabilidad/documentos',{docs:filas.slice((pagina-1)*75,pagina*75),total:filas.length,pagina,paginas:Math.ceil(filas.length/75)||1,filtros:f,advertencias,empresas:EMPRESAS_BASE,resumen:servicio.resumen(filas),proveedores:servicio.porProveedor(filas),pendientesPortal:filas.filter(d=>d.portal&&d.estado==='PENDIENTE')});
}));
router.post('/portal/:id/aceptar',wrap(async(req,res)=>{
  if(!/^[1-9]\d*$/.test(req.params.id))return res.sendStatus(400);
  const db=await pool.getConnection();
  try{
    await db.beginTransaction();
    await require('../utils/portalAprobacionContable').aprobar(db,Number(req.params.id),req.session.user.id,req.body.versionPortal);
    await db.commit();
    res.redirect('/contabilidad/documentos?tipo=factura');
  }catch(e){await db.rollback();throw e;}finally{db.release();}
}));
router.get('/exportar',wrap(async(req,res)=>{
  const {docs,advertencias}=await servicio.cargar(pool),filas=servicio.filtrar(docs,filtros(req.query));
  const w=new ExcelJS.Workbook(),s=w.addWorksheet('Documentos');
  const columns=[['Origen','origen'],['Tipo','tipo'],['Referencia OC','referencia'],['Factura','numero'],['Fecha','fecha'],['Proveedor','proveedor'],['Empresa','empresa'],['Moneda','moneda'],['Total neto','total'],['Pagado','pagado'],['Saldo','saldo'],['Estado de origen / portal','estado'],['Estado de pago','estadoPago'],['Vencimiento','vencimiento'],['Días vencidos','diasVencidos'],['Antigüedad','tramoVencimiento'],['Incluido en pasivos','incluido'],['Pendientes','motivos'],['Clave','clave']];
  s.columns=columns.map(([header,key])=>({header,key,width:24}));
  for(const d of filas)s.addRow({...d,total:d.total/100,pagado:d.pagado/100,saldo:d.saldo/100,incluido:d.incluido?'Sí':'No',motivos:d.motivos.join('; ')});
  const p=w.addWorksheet('Cuentas por pagar');p.columns=[{header:'Moneda',key:'moneda',width:20},{header:'Saldo pendiente actual',key:'saldo',width:30},{header:'Saldo vencido',key:'vencido',width:24},{header:'Saldo excluido por pendientes',key:'excluido',width:32}];
  for(const r of servicio.resumen(filas))p.addRow({...r,saldo:r.saldo/100,vencido:r.vencido/100,excluido:r.excluido/100});
  const proveedores=w.addWorksheet('Por proveedor');proveedores.columns=[['Proveedor','proveedor',40],['Empresa','empresa',30],['Moneda','moneda',14],['Facturas con saldo','facturas',20],['Total neto','total',22],['Pagado','pagado',22],['Saldo pendiente','saldo',22],['Saldo vencido','vencido',22],['Por vencer','porVencer',22],['Sin vencimiento','sinVencimiento',22]].map(([header,key,width])=>({header,key,width}));
  for(const r of servicio.porProveedor(filas)){const fila={...r};for(const k of ['total','pagado','saldo','vencido','porVencer','sinVencimiento'])fila[k]/=100;proveedores.addRow(fila);}
  proveedores.getRow(1).font={bold:true};proveedores.views=[{state:'frozen',ySplit:1}];proveedores.autoFilter=`A1:J${Math.max(1,proveedores.rowCount)}`;
  for(const k of ['total','pagado','saldo','vencido','porVencer','sinVencimiento'])proveedores.getColumn(k).numFmt='#,##0.00';
  const antiguedad=w.addWorksheet('Antigüedad de saldos');antiguedad.columns=[{header:'Moneda',key:'moneda',width:14},{header:'Antigüedad',key:'tramo',width:24},{header:'Facturas',key:'cantidad',width:14},{header:'Saldo confirmado',key:'saldo',width:24}];
  for(const moneda of ['CRC','USD'])for(const tramo of ['Sin vencimiento','Por vencer','1–30 días','31–60 días','61–90 días','Más de 90 días']){
    const grupo=filas.filter(d=>d.incluido&&d.saldo>0&&d.moneda===moneda&&d.tramoVencimiento===tramo);antiguedad.addRow({moneda,tramo,cantidad:grupo.length,saldo:grupo.reduce((s,d)=>s+d.saldo,0)/100});
  }
  const notas=w.addWorksheet('Alcance');notas.addRow(['Saldos actuales según los módulos de origen. Revisión y aprobación únicamente en el portal. No es un asiento registrado ni un saldo histórico al cierre.']);
  notas.addRow(['Las órdenes, caja chica pagada y documentos pendientes no se suman al saldo confirmado. Los documentos sin moneda confirmada no se agregan a totales monetarios.']);
  for(const aviso of advertencias)notas.addRow([aviso]);
  s.getRow(1).font={bold:true};s.autoFilter=`A1:S${Math.max(1,s.rowCount)}`;
  for(const key of ['total','pagado','saldo'])s.getColumn(key).numFmt='#,##0.00';
  for(const key of ['saldo','vencido','excluido'])p.getColumn(key).numFmt='#,##0.00';antiguedad.getColumn('saldo').numFmt='#,##0.00';
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('Contabilidad-documentos-y-pasivos.xlsx');await w.xlsx.write(res);res.end();
}));
router.get('/:key',wrap(async(req,res)=>{
  const {docs}=await servicio.cargar(pool),d=docs.find(d=>d.key===req.params.key);
  if(!d)return res.sendStatus(404);
  if(d.tipo==='orden'&&['TALLER','MOTOR'].includes(d.origen)){
    const tabla=d.origen==='TALLER'?'ordenes_compra_detalle':'ordenes_motor_detalle',columna=d.origen==='TALLER'?'orden_compra_id':'orden_motor_id';
    [d.lineas]=await pool.query(`SELECT * FROM ${tabla} WHERE ${columna}=? ORDER BY id`,[d.id]);
  }
  const historial=d.portal?(await pool.query('SELECT accion estado,actor actor_nombre,creado_en FROM prov_auditoria WHERE documento_id=? ORDER BY id DESC',[d.id]))[0]:[];
  res.render('contabilidad/documento',{d,historial,empresas:EMPRESAS_BASE});
}));
// Compatibilidad con formularios anteriores: nunca crea una segunda aprobación.
router.post('/:key/revision',wrap(async(req,res)=>{
  const {docs}=await servicio.cargar(pool),d=docs.find(d=>d.key===req.params.key);
  if(!d)return res.sendStatus(404);
  if(!d.portal)return res.status(403).send('La revisión y aceptación aplica únicamente a las facturas del portal.');
  return res.redirect(303,'/proveeduria/portal-proveedores/facturas#portal-factura-'+d.id);
}));
router.use((err,req,res,next)=>{console.error('Contabilidad documentos:',err.message);res.status(err.status||500).render('contabilidad/error',{mensaje:err.status?err.message:'No se pudo cargar la bandeja. Revise las migraciones y las fuentes de datos.'});});
module.exports=router;
