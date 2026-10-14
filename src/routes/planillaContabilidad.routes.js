const router=require('express').Router(),pool=require('../db');
const P=require('../utils/presupuestosContabilidad');
const {EMPRESAS_BASE,normalizarEmpresa}=require('../utils/empresasContabilidad');
const {DEPARTAMENTOS}=require('../utils/departamentos');
const {fechaActualCostaRica}=require('../utils/fechaCostaRica');
const {sincronizarPersonas,validarFecha,calcular}=require('../utils/planillaContabilidad');
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
router.use((req,res,next)=>{
 if(!req.session?.user)return res.redirect('/login');
 if(req.session.user.rol!=='ADMIN')return res.status(403).send('Planilla disponible solo para Administración.');
 res.set('Cache-Control','no-store');next();
});
function filtro(q){
 const periodo=String(q.periodo||fechaActualCostaRica().slice(0,7)),empresa=normalizarEmpresa(q.empresa),moneda=String(q.moneda||'CRC'),sede=String(q.sede||''),departamento=String(q.departamento||''),buscar=String(q.buscar||'').trim();
 P.exigir(P.periodoValido(periodo)&&empresa.length<=120&&sede.length<=120&&buscar.length<=180&&P.MONEDAS.includes(moneda),'Filtros inválidos.');
 P.exigir(!departamento||departamento==='GENERAL'||DEPARTAMENTOS.some(d=>d.key===departamento),'Departamento inválido.');
 return {periodo,empresa,moneda,sede,departamento,buscar};
}
async function tx(fn){const db=await pool.getConnection();try{await db.beginTransaction();const r=await fn(db);await db.commit();return r;}catch(e){await db.rollback();throw e;}finally{db.release();}}
async function auditar(db,req,accion,id,antes,despues){await db.query('INSERT INTO cont_presupuesto_auditoria (actor,accion,referencia,antes,despues) VALUES (?,?,?,?,?)',[req.session.user.id,accion,'Planilla '+id,antes?JSON.stringify(antes):null,JSON.stringify(despues)]);}
function volver(req,res,persona){const f=filtro(req.body);res.redirect('/contabilidad/presupuestos/planilla?'+new URLSearchParams({...f,empresa:persona?.empresa||f.empresa}));}
router.get('/',wrap(async(req,res)=>{
 let periodo=req.query.periodo;
 if(!periodo){const [meses]=await pool.query('SELECT periodo FROM cont_planilla_personas UNION SELECT periodo FROM cont_presupuesto_archivos ORDER BY periodo DESC LIMIT 1');periodo=meses[0]?.periodo||fechaActualCostaRica().slice(0,7);}
 const f=filtro({...req.query,periodo});await sincronizarPersonas(pool,f.periodo);
 const [personas]=await pool.query(`SELECT p.*,r.id registro_id,r.fecha,r.salario,r.extras,r.rebajos,r.observacion,r.version registro_version,COALESCE(pa.pagado,0) pagado FROM cont_planilla_personas p LEFT JOIN cont_planilla_registros r ON r.persona_id=p.id LEFT JOIN (SELECT registro_id,SUM(monto) pagado FROM cont_planilla_pagos GROUP BY registro_id) pa ON pa.registro_id=r.id WHERE p.periodo=? AND p.moneda=? ORDER BY p.empresa,p.grupo,p.nombre,p.id`,[f.periodo,f.moneda]);
 const [presupuestos]=await pool.query("SELECT * FROM cont_presupuestos WHERE periodo=? AND moneda=? AND rubro='PLANILLA'",[f.periodo,f.moneda]);
 const empresas=[...new Set([...EMPRESAS_BASE,...personas.map(p=>p.empresa),...presupuestos.map(p=>p.empresa)])].sort((a,b)=>a.localeCompare(b,'es'));
 const coincide=p=>(!f.empresa||p.empresa===f.empresa)&&(!f.sede||p.sede===f.sede)&&(!f.departamento||p.departamento===f.departamento);
 const todos=personas.filter(coincide).map(p=>({...p,totales:calcular(p.salario||0,p.extras||0,p.rebajos||0,p.pagado)}));
 const totales=todos.reduce((s,p)=>{for(const k of ['bruto','neto','pagado','saldo'])s[k]+=p.totales[k];if(!p.registro_id)s.pendientes++;return s;},{bruto:0,neto:0,pagado:0,saldo:0,pendientes:0,presupuesto:presupuestos.filter(coincide).reduce((s,p)=>s+P.centavos(p.monto),0)});
 const lista=todos.filter(p=>!f.buscar||`${p.nombre} ${p.puesto} ${p.grupo}`.toLocaleLowerCase('es').includes(f.buscar.toLocaleLowerCase('es'))),paginas=Math.max(1,Math.ceil(lista.length/40)),pagina=Math.max(1,Math.min(paginas,Number.parseInt(req.query.pagina,10)||1));
 const [{docs},[clasificaciones],[pagos]]=await Promise.all([P.cargarDocumentos(pool),pool.query('SELECT * FROM cont_clasificaciones'),pool.query('SELECT pa.*,p.nombre,p.empresa,p.moneda,p.sede,p.departamento FROM cont_planilla_pagos pa JOIN cont_planilla_registros r ON r.id=pa.registro_id JOIN cont_planilla_personas p ON p.id=r.persona_id WHERE p.periodo=? AND p.moneda=? ORDER BY pa.fecha DESC,pa.id DESC',[f.periodo,f.moneda])]);
 const otrosDocumentos=P.resumen({docs,clasificaciones,presupuestos:[],...f}).documentos.filter(d=>d.fuente!=='PLANILLA'&&d.rubro==='PLANILLA'&&d.incluido);
 totales.otrosGastos=otrosDocumentos.reduce((s,d)=>s+d.facturaMes,0);totales.otrosCompromisos=otrosDocumentos.reduce((s,d)=>s+d.compromisoMes,0);
 totales.disponible=totales.presupuesto-totales.bruto-totales.otrosGastos-totales.otrosCompromisos;
 const mensaje=req.session.planillaMensaje;delete req.session.planillaMensaje;
 res.render('contabilidad/planilla',{user:req.session.user,f,empresas,totales,personas:lista.slice((pagina-1)*40,pagina*40),cantidad:lista.length,pagina,paginas,mensaje,otrosDocumentos,pagos:pagos.filter(coincide),periodosOrigen:[...new Set(todos.map(p=>p.periodo_origen).filter(Boolean))]});
}));
router.post('/persona',wrap(async(req,res)=>{
 const f=filtro(req.body),nombre=String(req.body.nombre||'').trim(),puesto=String(req.body.puesto||'').trim();
 P.exigir(f.empresa&&f.empresa!=='__SIN_EMPRESA__'&&nombre&&nombre.length<=180&&puesto.length<=180,'Complete empresa y nombre.');
 const presupuesto=String(req.body.presupuesto??'').trim()===''?null:P.montoValido(req.body.presupuesto);
 await tx(async db=>{
  const [r]=await db.query('INSERT INTO cont_planilla_personas (periodo,empresa,moneda,sede,departamento,nombre,puesto,presupuesto,actualizado_por) VALUES (?,?,?,?,?,?,?,?,?)',[f.periodo,f.empresa,f.moneda,f.sede||'General de la empresa',f.departamento||'GENERAL',nombre,puesto,presupuesto,req.session.user.id]);
  await auditar(db,req,'PLANILLA_PERSONA',r.insertId,null,{...f,nombre,puesto,presupuesto});
 });req.session.planillaMensaje='Persona agregada. Todavía no se ha registrado un gasto real.';volver(req,res);
}));
router.post('/persona/:id/editar',wrap(async(req,res)=>{
 filtro(req.body);
 const id=Number(req.params.id),version=Number(req.body.version),nombre=String(req.body.nombre||'').trim(),puesto=String(req.body.puesto||'').trim();
 P.exigir(Number.isSafeInteger(id)&&id>0&&Number.isSafeInteger(version)&&version>0&&nombre&&nombre.length<=180&&puesto.length<=180,'Revise los datos de la persona.');
 const presupuesto=String(req.body.presupuesto??'').trim()===''?null:P.montoValido(req.body.presupuesto);let persona;
 await tx(async db=>{
  const [rows]=await db.query('SELECT * FROM cont_planilla_personas WHERE id=? FOR UPDATE',[id]);persona=rows[0];P.exigir(persona,'Persona no encontrada.');
  if(Number(persona.version)!==version)throw Object.assign(new Error('La persona cambió. Recargue la planilla antes de guardar.'),{status:409});
  await db.query('UPDATE cont_planilla_personas SET nombre=?,puesto=?,presupuesto=?,version=version+1,actualizado_por=? WHERE id=?',[nombre,puesto,presupuesto,req.session.user.id,id]);
  await auditar(db,req,'PLANILLA_PERSONA_EDITAR',id,persona,{nombre,puesto,presupuesto});
 });req.session.planillaMensaje='Datos de la persona actualizados. El presupuesto general del rubro se mantiene separado de la referencia individual.';volver(req,res,persona);
}));
router.post('/:id/gasto',wrap(async(req,res)=>{
 filtro(req.body);
 const id=Number(req.params.id),fecha=validarFecha(String(req.body.fecha||'')),salario=P.montoValido(req.body.salario),extras=P.montoValido(req.body.extras),rebajos=P.montoValido(req.body.rebajos),observacion=String(req.body.observacion||'').trim(),version=Number(req.body.version);
 P.exigir(Number.isSafeInteger(id)&&id>0&&Number.isSafeInteger(version)&&version>=0&&observacion.length<=500,'Registro inválido.');
 let persona;
 await tx(async db=>{
  const [personas]=await db.query('SELECT * FROM cont_planilla_personas WHERE id=? FOR UPDATE',[id]);persona=personas[0];P.exigir(persona,'Persona no encontrada.');
  P.exigir(fecha.slice(0,7)===persona.periodo,'La fecha del gasto debe corresponder al mes de la planilla.');
  const [previos]=await db.query('SELECT * FROM cont_planilla_registros WHERE persona_id=? FOR UPDATE',[id]),antes=previos[0];
  if(version!==Number(antes?.version||0))throw Object.assign(new Error('La fila cambió. Recargue la planilla antes de guardar.'),{status:409});
  const [pagos]=antes?await db.query('SELECT COALESCE(SUM(monto),0) pagado FROM cont_planilla_pagos WHERE registro_id=?',[antes.id]):[[{pagado:0}]];
  calcular(salario,extras,rebajos,pagos[0].pagado);
  if(antes)await db.query('UPDATE cont_planilla_registros SET fecha=?,salario=?,extras=?,rebajos=?,observacion=?,version=version+1,actualizado_por=? WHERE id=?',[fecha,salario,extras,rebajos,observacion,req.session.user.id,antes.id]);
  else await db.query('INSERT INTO cont_planilla_registros (persona_id,fecha,salario,extras,rebajos,observacion,actualizado_por) VALUES (?,?,?,?,?,?,?)',[id,fecha,salario,extras,rebajos,observacion,req.session.user.id]);
  await auditar(db,req,'PLANILLA_GASTO',id,antes,{fecha,salario,extras,rebajos,observacion});
 });req.session.planillaMensaje='Gasto real de planilla guardado. Los pagos se registran por separado.';volver(req,res,persona);
}));
router.post('/:id/pago',wrap(async(req,res)=>{
 filtro(req.body);
 const id=Number(req.params.id),fecha=validarFecha(String(req.body.fecha||'')),referencia=String(req.body.referencia||'').trim(),monto=P.montoValido(req.body.monto);
 P.exigir(Number.isSafeInteger(id)&&id>0&&referencia&&referencia.length<=120&&monto>0,'Complete fecha, referencia y monto del pago.');
 let persona;
 await tx(async db=>{
  const [p]=await db.query('SELECT * FROM cont_planilla_personas WHERE id=? FOR UPDATE',[id]);persona=p[0];P.exigir(persona,'Persona no encontrada.');
  const [r]=await db.query('SELECT * FROM cont_planilla_registros WHERE persona_id=? FOR UPDATE',[id]);P.exigir(r[0],'Registre primero el gasto real de la persona.');
  const [pagos]=await db.query('SELECT COALESCE(SUM(monto),0) pagado FROM cont_planilla_pagos WHERE registro_id=?',[r[0].id]);
  const saldo=calcular(r[0].salario,r[0].extras,r[0].rebajos,pagos[0].pagado).saldo;
  P.exigir(P.centavos(monto)<=saldo,'El pago supera el neto pendiente.');
  await db.query('INSERT INTO cont_planilla_pagos (registro_id,fecha,referencia,monto,actor) VALUES (?,?,?,?,?)',[r[0].id,fecha,referencia,monto,req.session.user.id]);
  await auditar(db,req,'PLANILLA_PAGO',id,null,{fecha,referencia,monto});
 });req.session.planillaMensaje='Pago registrado. El saldo se actualizó sin duplicar el gasto.';volver(req,res,persona);
}));
module.exports=router;
