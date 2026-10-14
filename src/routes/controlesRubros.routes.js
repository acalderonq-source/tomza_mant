const router=require('express').Router({mergeParams:true}),pool=require('../db');
const P=require('../utils/presupuestosContabilidad');
const {EMPRESAS_BASE,normalizarEmpresa}=require('../utils/empresasContabilidad');
const {DEPARTAMENTOS}=require('../utils/departamentos');
const {fechaActualCostaRica}=require('../utils/fechaCostaRica');
const {validarFecha}=require('../utils/planillaContabilidad');
const {sincronizarConceptos,saldo,etiquetaRegistro}=require('../utils/controlesRubros');
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
router.use((req,res,next)=>{
 const rubro=P.RUBROS.find(r=>r.key===String(req.params.rubro||'').toUpperCase()&&r.key!=='PLANILLA');
 if(!rubro)return res.status(404).send('Control no encontrado.');req.rubro=rubro;next();
});
function filtro(q){
 const f={periodo:String(q.periodo||fechaActualCostaRica().slice(0,7)),empresa:normalizarEmpresa(q.empresa),moneda:String(q.moneda||'CRC'),sede:String(q.sede||''),departamento:String(q.departamento||''),buscar:String(q.buscar||'').trim()};
 P.exigir(P.periodoValido(f.periodo)&&f.empresa.length<=120&&f.sede.length<=120&&f.buscar.length<=200&&P.MONEDAS.includes(f.moneda),'Filtros inválidos.');
 P.exigir(!f.departamento||f.departamento==='GENERAL'||DEPARTAMENTOS.some(d=>d.key===f.departamento),'Departamento inválido.');return f;
}
async function tx(fn){const db=await pool.getConnection();try{await db.beginTransaction();const r=await fn(db);await db.commit();return r;}catch(e){await db.rollback();throw e;}finally{db.release();}}
async function auditar(db,req,accion,id,antes,despues){await db.query('INSERT INTO cont_presupuesto_auditoria (actor,accion,referencia,antes,despues) VALUES (?,?,?,?,?)',[req.session.user.id,accion,`${req.rubro.nombre} / ${id}`,antes?JSON.stringify(antes):null,JSON.stringify(despues)]);}
function volver(req,res,c){const f=filtro(req.body);res.redirect('/contabilidad/presupuestos/rubros/'+req.rubro.key+'?'+new URLSearchParams({...f,empresa:c?.empresa||f.empresa}));}
async function concepto(db,req,id){
 P.exigir(Number.isSafeInteger(id)&&id>0,'Concepto inválido.');const [rows]=await db.query('SELECT * FROM cont_rubro_conceptos WHERE id=? FOR UPDATE',[id]);
 P.exigir(rows[0]&&rows[0].rubro===req.rubro.key,'Concepto no encontrado en este rubro.');return rows[0];
}
router.get('/',wrap(async(req,res)=>{
 const f=filtro(req.query);await sincronizarConceptos(pool,f.periodo,req.rubro.key);
 const [[filas],[presupuestos],{docs},[clasificaciones],[pagos]]=await Promise.all([
  pool.query(`SELECT c.*,r.id registro_id,r.fecha,r.monto,r.proveedor,r.documento,r.vencimiento,r.observacion,r.version registro_version,COALESCE(p.pagado,0) pagado FROM cont_rubro_conceptos c LEFT JOIN cont_rubro_registros r ON r.concepto_id=c.id LEFT JOIN (SELECT registro_id,SUM(monto) pagado FROM cont_rubro_pagos GROUP BY registro_id) p ON p.registro_id=r.id WHERE c.periodo=? AND c.rubro=? AND c.moneda=? ORDER BY c.empresa,c.concepto,c.id`,[f.periodo,req.rubro.key,f.moneda]),
  pool.query('SELECT * FROM cont_presupuestos WHERE periodo=? AND rubro=? AND moneda=?',[f.periodo,req.rubro.key,f.moneda]),P.cargarDocumentos(pool),pool.query('SELECT * FROM cont_clasificaciones'),
  pool.query('SELECT p.*,c.concepto,c.empresa,c.sede,c.departamento FROM cont_rubro_pagos p JOIN cont_rubro_registros r ON r.id=p.registro_id JOIN cont_rubro_conceptos c ON c.id=r.concepto_id WHERE c.periodo=? AND c.rubro=? AND c.moneda=? ORDER BY p.fecha DESC,p.id DESC',[f.periodo,req.rubro.key,f.moneda])
 ]);
 const coincide=c=>(!f.empresa||c.empresa===f.empresa)&&(!f.sede||c.sede===f.sede)&&(!f.departamento||c.departamento===f.departamento);
 const conceptos=filas.filter(coincide).map(c=>({...c,saldo:saldo(c.monto||0,c.pagado)}));
 const otros=P.resumen({docs,clasificaciones,presupuestos:[],...f}).documentos.filter(d=>d.fuente!=='CONTROL_RUBRO'&&d.rubro===req.rubro.key&&d.incluido);
 const totales=conceptos.reduce((s,c)=>{for(const k of ['registrado','pagado','pendiente'])s[k]+=c.saldo[k];s.referencia+=P.centavos(c.presupuesto);if(!c.registro_id)s.sinRegistrar++;return s;},{registrado:0,pagado:0,pendiente:0,sinRegistrar:0,referencia:0,presupuesto:presupuestos.filter(c=>c.empresa&&coincide(c)).reduce((s,c)=>s+P.centavos(c.monto),0)});
 totales.otros=otros.reduce((s,d)=>s+d.facturaMes,0);totales.compromisos=otros.reduce((s,d)=>s+d.compromisoMes,0);totales.disponible=totales.presupuesto-totales.registrado-totales.otros-totales.compromisos;
 const lista=conceptos.filter(c=>!f.buscar||c.concepto.toLocaleLowerCase('es').includes(f.buscar.toLocaleLowerCase('es'))),paginas=Math.max(1,Math.ceil(lista.length/40)),pagina=Math.max(1,Math.min(paginas,Number.parseInt(req.query.pagina,10)||1));
 const empresas=[...new Set([...EMPRESAS_BASE,...filas.map(c=>c.empresa),...presupuestos.map(c=>c.empresa)])].filter(Boolean).sort((a,b)=>a.localeCompare(b,'es'));
 const mensaje=req.session.rubroMensaje;delete req.session.rubroMensaje;
 res.render('contabilidad/control_rubro',{user:req.session.user,rubro:req.rubro,etiqueta:etiquetaRegistro(req.rubro.key),f,empresas,totales,referenciasImportadas:conceptos.some(c=>c.archivo_id),conceptos:lista.slice((pagina-1)*40,pagina*40),cantidad:lista.length,pagina,paginas,otros,pagos:pagos.filter(coincide),mensaje});
}));
router.post('/concepto',wrap(async(req,res)=>{
 const f=filtro(req.body),nombre=String(req.body.concepto||'').trim(),presupuesto=String(req.body.presupuesto??'').trim()===''?null:P.montoValido(req.body.presupuesto);
 P.exigir(f.empresa&&f.empresa!=='__SIN_EMPRESA__'&&nombre&&nombre.length<=200,'Complete empresa y concepto.');
 await tx(async db=>{const [r]=await db.query('INSERT INTO cont_rubro_conceptos (periodo,empresa,rubro,moneda,sede,departamento,concepto,presupuesto,actualizado_por) VALUES (?,?,?,?,?,?,?,?,?)',[f.periodo,f.empresa,req.rubro.key,f.moneda,f.sede||'General de la empresa',f.departamento||'GENERAL',nombre,presupuesto,req.session.user.id]);await auditar(db,req,'RUBRO_CONCEPTO',r.insertId,null,{...f,concepto:nombre,presupuesto});});
 req.session.rubroMensaje='Concepto agregado. El importe real se registra por separado.';volver(req,res);
}));
router.post('/concepto/:id/editar',wrap(async(req,res)=>{
 filtro(req.body);const id=Number(req.params.id),version=Number(req.body.version),nombre=String(req.body.concepto||'').trim(),presupuesto=String(req.body.presupuesto??'').trim()===''?null:P.montoValido(req.body.presupuesto);let c;
 P.exigir(Number.isSafeInteger(version)&&version>0&&nombre&&nombre.length<=200,'Revise los datos del concepto.');
 await tx(async db=>{c=await concepto(db,req,id);if(Number(c.version)!==version)throw Object.assign(new Error('El concepto cambió. Recargue la pantalla.'),{status:409});await db.query('UPDATE cont_rubro_conceptos SET concepto=?,presupuesto=?,version=version+1,actualizado_por=? WHERE id=?',[nombre,presupuesto,req.session.user.id,id]);await auditar(db,req,'RUBRO_CONCEPTO_EDITAR',id,c,{concepto:nombre,presupuesto});});
 req.session.rubroMensaje='Referencia actualizada. El presupuesto general del rubro se mantiene separado.';volver(req,res,c);
}));
router.post('/:id/registrar',wrap(async(req,res)=>{
 filtro(req.body);const id=Number(req.params.id),fecha=validarFecha(String(req.body.fecha||'')),monto=P.montoValido(req.body.monto),observacion=String(req.body.observacion||'').trim(),version=Number(req.body.version);let c;
 const proveedor=String(req.body.proveedor||'').trim(),documento=String(req.body.documento||'').trim(),vencimiento=req.body.vencimiento?validarFecha(String(req.body.vencimiento)):null;
 P.exigir(Number.isSafeInteger(version)&&version>=0&&observacion.length<=500,'Registro inválido.');
 P.exigir(proveedor.length<=180&&documento.length<=120,'Proveedor o documento demasiado largo.');
 await tx(async db=>{
  c=await concepto(db,req,id);P.exigir(fecha.slice(0,7)===c.periodo,'La fecha debe corresponder al mes del control.');
  const [previos]=await db.query('SELECT * FROM cont_rubro_registros WHERE concepto_id=? FOR UPDATE',[id]),antes=previos[0];
  if(Number(antes?.version||0)!==version)throw Object.assign(new Error('El registro cambió. Recargue la pantalla.'),{status:409});
  const [pagos]=antes?await db.query('SELECT COALESCE(SUM(monto),0) pagado FROM cont_rubro_pagos WHERE registro_id=?',[antes.id]):[[{pagado:0}]];saldo(monto,pagos[0].pagado);
  if(antes)await db.query('UPDATE cont_rubro_registros SET fecha=?,monto=?,proveedor=?,documento=?,vencimiento=?,observacion=?,version=version+1,actualizado_por=? WHERE id=?',[fecha,monto,proveedor,documento,vencimiento,observacion,req.session.user.id,antes.id]);
  else await db.query('INSERT INTO cont_rubro_registros (concepto_id,fecha,monto,proveedor,documento,vencimiento,observacion,actualizado_por) VALUES (?,?,?,?,?,?,?,?)',[id,fecha,monto,proveedor,documento,vencimiento,observacion,req.session.user.id]);
  await auditar(db,req,'RUBRO_REGISTRO',id,antes,{fecha,monto,proveedor,documento,vencimiento,observacion});
 });req.session.rubroMensaje='Importe real guardado. El resumen del presupuesto se actualizó.';volver(req,res,c);
}));
router.post('/:id/pago',wrap(async(req,res)=>{
 filtro(req.body);const id=Number(req.params.id),fecha=validarFecha(String(req.body.fecha||'')),referencia=String(req.body.referencia||'').trim(),monto=P.montoValido(req.body.monto);let c;
 P.exigir(referencia&&referencia.length<=120&&monto>0,'Complete referencia y monto del pago.');
 await tx(async db=>{
  c=await concepto(db,req,id);const [rows]=await db.query('SELECT * FROM cont_rubro_registros WHERE concepto_id=? FOR UPDATE',[id]);P.exigir(rows[0],'Registre primero el importe real.');
  const [pagos]=await db.query('SELECT COALESCE(SUM(monto),0) pagado FROM cont_rubro_pagos WHERE registro_id=?',[rows[0].id]);P.exigir(P.centavos(monto)<=saldo(rows[0].monto,pagos[0].pagado).pendiente,'El pago supera el importe pendiente.');
  await db.query('INSERT INTO cont_rubro_pagos (registro_id,fecha,referencia,monto,actor) VALUES (?,?,?,?,?)',[rows[0].id,fecha,referencia,monto,req.session.user.id]);await auditar(db,req,'RUBRO_PAGO',id,null,{fecha,referencia,monto});
 });req.session.rubroMensaje='Pago registrado. El saldo se actualizó.';volver(req,res,c);
}));
module.exports=router;
