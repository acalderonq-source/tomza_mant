const express=require('express');
const bcrypt=require('bcryptjs');
const {rateLimit}=require('express-rate-limit');
const pool=require('../db');
const {revisarFactura,exigirControl,excepciones,registrarRecepcionCompras}=require('../utils/portalControlFactura');
const {vincularOrden}=require('../utils/portalFacturaOrden');
const {cruzarFactura}=require('../utils/portalCruceAutomatico');
const {exigir,adjunto,saldo,numero}=require('../utils/proveeduria');
const {leerFacturaXML,consultarHacienda,aprobable,vencimiento}=require('../utils/proveedorHacienda');
const {esPropietarioAdministracion}=require('../utils/administracionPrivada');
const externo=express.Router(),interno=express.Router(),administracion=express.Router();
administracion.use(async(req,res,next)=>{try{res.set('Cache-Control','no-store');if(!req.session.user)return res.redirect('/login?departamento=ADMINISTRACION');if(!await esPropietarioAdministracion(req.session.user,pool))return res.status(403).send('Solo el propietario puede administrar el portal de proveedores');next();}catch(e){next(e);}});
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const gestion=u=>['ADMIN','PROVEEDURIA','PROVEEDURIA_TALLER'].includes(u?.rol);
const contabilidad=u=>['ADMIN','CONTABILIDAD'].includes(u?.rol);
const parse=r=>({...r,datos:typeof r.datos==='string'?JSON.parse(r.datos):r.datos});
const limitar=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:true,legacyHeaders:false,message:'Demasiados intentos. Intente en 15 minutos.'});
const cargas=rateLimit({windowMs:3600000,limit:60,standardHeaders:true,legacyHeaders:false,message:'Límite de cargas alcanzado. Intente más tarde.'});
async function transaccion(fn){for(let intento=0;intento<3;intento++){const db=await pool.getConnection();try{await db.beginTransaction();const r=await fn(db);await db.commit();return r;}catch(e){await db.rollback();if(!['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(e.code)||intento===2)throw e;}finally{db.release();}}}
async function guardarArchivo(db,a){const [r]=await db.query('INSERT INTO prov_adjuntos (nombre,mime,contenido) VALUES (?,?,?)',[a.nombre,a.mime,Buffer.from(a.base64,'base64')]);return {id:r.insertId,nombre:a.nombre,mime:a.mime};}
async function documento(db,id,lock=false){const [r]=await db.query(`SELECT * FROM prov_documentos WHERE id=? AND tipo='factura_portal' ${lock?'FOR UPDATE':''}`,[id]);exigir(r.length,'Factura no encontrada');return parse(r[0]);}
async function guardar(db,row,actor,accion){await db.query('UPDATE prov_documentos SET datos=? WHERE id=?',[JSON.stringify(row.datos),row.id]);await db.query('INSERT INTO prov_auditoria (documento_id,actor,accion) VALUES (?,?,?)',[row.id,String(actor),accion]);}
const sesion=(req)=>req.session.proveedorPortal;
externo.use((req,res,next)=>{res.set('Cache-Control','no-store');res.set('Referrer-Policy','same-origin');next();});
externo.get('/login',(req,res)=>res.render('portal_proveedores/login',{error:null}));
externo.post('/login',limitar,wrap(async(req,res)=>{
  const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');
  if(password.length>128)return res.status(401).render('portal_proveedores/login',{error:'Correo o contraseña incorrectos'});
  const [rows]=await pool.query('SELECT c.*,p.nombre FROM prov_portal_cuentas c JOIN prov_proveedores p ON p.id=c.proveedor_id WHERE c.email=? AND c.activo=1 AND p.activo=1',[email]);
  const cuenta=rows[0];
  // El hash ficticio mantiene el mismo trabajo para correos inexistentes.
  const valido=await bcrypt.compare(password,cuenta?.password_hash||'$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW');
  if(!cuenta||!valido)return res.status(401).render('portal_proveedores/login',{error:'Correo o contraseña incorrectos'});
  await new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));
  req.session.proveedorPortal={id:cuenta.id,version:cuenta.version_acceso};
  await new Promise((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));
  res.redirect('/portal-proveedores');
}));
externo.use(wrap(async(req,res,next)=>{
  if(!sesion(req))return res.redirect('/portal-proveedores/login');
  const [rows]=await pool.query('SELECT c.id,c.cedula,c.email,c.plazo_dias,c.version_acceso,p.nombre FROM prov_portal_cuentas c JOIN prov_proveedores p ON p.id=c.proveedor_id WHERE c.id=? AND c.activo=1 AND p.activo=1',[sesion(req).id]);
  if(!rows[0]||rows[0].version_acceso!==sesion(req).version){delete req.session.proveedorPortal;return res.redirect('/portal-proveedores/login');}
  req.proveedor=rows[0];next();
}));
externo.post('/logout',(req,res)=>{delete req.session.proveedorPortal;res.redirect('/portal-proveedores/login');});
externo.get('/',wrap(async(req,res)=>{
  const [rows]=await pool.query("SELECT id,datos,creado_en FROM prov_documentos WHERE tipo='factura_portal' AND JSON_UNQUOTE(JSON_EXTRACT(datos,'$.cuenta_id'))=? ORDER BY id DESC",[String(req.proveedor.id)]);
  const [receptores]=await pool.query('SELECT cedula,nombre FROM prov_portal_receptores WHERE activo=1 ORDER BY nombre');
  const docs=rows.map(parse);for(const row of docs)row.datos.control=await revisarFactura(pool,row);
  res.render('portal_proveedores/inicio',{proveedor:req.proveedor,docs,receptores,saldo,excepciones});
}));
externo.post('/password',limitar,wrap(async(req,res)=>{
  const password=String(req.body.password||'');exigir(password.length>=12&&password.length<=128,'Use una contraseña de 12 a 128 caracteres');
  const [r]=await pool.query('SELECT password_hash FROM prov_portal_cuentas WHERE id=?',[req.proveedor.id]);
  exigir(await bcrypt.compare(String(req.body.actual||''),r[0].password_hash),'Contraseña actual incorrecta');
  await pool.query('UPDATE prov_portal_cuentas SET password_hash=?,version_acceso=version_acceso+1 WHERE id=?',[await bcrypt.hash(password,12),req.proveedor.id]);
  delete req.session.proveedorPortal;res.json({ok:true,redirect:'/portal-proveedores/login'});
}));
externo.post('/facturas',cargas,wrap(async(req,res)=>{
  const electronica=leerFacturaXML(req.body.xml),pdf=adjunto(req.body.archivo);
  exigir(pdf.mime==='application/pdf','Adjunte la representación PDF de la factura');
  const id=n=>String(n).replace(/^0+/,'');
  exigir(id(electronica.emisor)===id(req.proveedor.cedula),'El emisor del XML no corresponde a su cuenta de proveedor');
  const [receptores]=await pool.query('SELECT cedula FROM prov_portal_receptores WHERE activo=1');
  exigir(receptores.some(r=>id(r.cedula)===id(electronica.receptor)),'La factura no está emitida a una empresa receptora autorizada');
  const {archivo,...campos}=electronica;
  const hacienda=await consultarHacienda(campos.clave,campos);
  const facturaId=await transaccion(async db=>{
    const [cuentas]=await db.query('SELECT id FROM prov_portal_cuentas WHERE id=? AND activo=1 AND version_acceso=? FOR UPDATE',[req.proveedor.id,sesion(req).version]);exigir(cuentas.length,'La cuenta fue deshabilitada; vuelva a ingresar');
    const [claves]=await db.query('SELECT documento_id FROM prov_facturas_claves WHERE clave=? FOR UPDATE',[campos.clave]);exigir(!claves.length,'Esta factura ya está registrada');
    const f={numero:campos.consecutivo,total:campos.total,estado:'PENDIENTE',diferencias:[],subida_en:new Date().toISOString(),fecha_vencimiento:vencimiento(campos.fecha,req.proveedor.plazo_dias),archivo:await guardarArchivo(db,pdf),electronica:{...campos,archivo:await guardarArchivo(db,archivo),hacienda}};
    const d={cuenta_id:req.proveedor.id,proveedor:req.proveedor.nombre,moneda:campos.moneda,razon_social:campos.nombre_receptor,pagos:[],factura:f};
    const [r]=await db.query("INSERT INTO prov_documentos (tipo,usuario_id,sede,datos) VALUES ('factura_portal',0,'PORTAL',?)",[JSON.stringify(d)]);
    await db.query('INSERT INTO prov_facturas_claves (clave,documento_id) VALUES (?,?)',[campos.clave,r.insertId]);
    await db.query('INSERT INTO prov_auditoria (documento_id,actor,accion) VALUES (?,?,?)',[r.insertId,`Proveedor ${req.proveedor.id}`,'Factura cargada desde cuenta del proveedor']);
    return r.insertId;
  });
  try{await cruzarFactura(pool,facturaId);}catch(e){console.warn('Cruce automático pendiente:',e.code||e.message);}
  res.json({ok:true,id:facturaId});
}));
async function cargarNota(req,res){
  const n=leerFacturaXML(req.body.xml,true),pdf=adjunto(req.body.archivo);exigir(pdf.mime==='application/pdf','Adjunte PDF de la nota de crédito');
  n.hacienda=await consultarHacienda(n.clave,n);
  await transaccion(async db=>{
    const row=await documento(db,req.params.id,true),f=row.datos.factura.electronica;
    if(req.proveedor)exigir(Number(row.datos.cuenta_id)===Number(req.proveedor.id),'Factura no encontrada');
    exigir(n.emisor.replace(/^0+/,'')===f.emisor.replace(/^0+/,'')&&n.receptor.replace(/^0+/,'')===f.receptor.replace(/^0+/,''),'Emisor o receptor no coincide con la factura original');
    exigir(n.moneda===row.datos.moneda&&n.referencias.some(r=>r.numero===f.clave),'La nota debe corresponder a esta factura y moneda');
    exigir(n.total<=row.datos.factura.total,'La nota supera el total original');
    await db.query('INSERT INTO prov_facturas_claves (clave,documento_id) VALUES (?,?)',[n.clave,row.id]);
    n.archivo=await guardarArchivo(db,n.archivo);n.pdf=await guardarArchivo(db,pdf);n.subida_en=new Date().toISOString();n.aplicada=false;
    (row.datos.notas_credito??=[]).push(n);
    await guardar(db,row,req.proveedor?`Proveedor ${req.proveedor.id}`:req.session.user.id,'Nota de crédito recibida');
  });res.json({ok:true});
}
externo.post('/facturas/:id/notas-credito',cargas,wrap(cargarNota));
async function descargar(req,res,row){const tipo=req.params.tipo;const a=tipo==='xml'?row.datos.factura.electronica.archivo:tipo==='pdf'?row.datos.factura.archivo:tipo==='pago'?row.datos.pagos[Number(req.params.indice)]?.archivo:tipo==='nota-xml'?row.datos.notas_credito?.[Number(req.params.indice)]?.archivo:tipo==='nota-pdf'?row.datos.notas_credito?.[Number(req.params.indice)]?.pdf:null;exigir(a,'Archivo no encontrado');const [r]=await pool.query('SELECT contenido FROM prov_adjuntos WHERE id=?',[a.id]);exigir(r.length,'Archivo no encontrado');res.set('X-Content-Type-Options','nosniff');res.attachment(a.nombre);res.type(a.mime).send(r[0].contenido);}
externo.get('/facturas/:id/archivo/:tipo/:indice?',wrap(async(req,res)=>{const row=await documento(pool,req.params.id);if(Number(row.datos.cuenta_id)!==Number(req.proveedor.id))return res.sendStatus(404);await descargar(req,res,row);}));

interno.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!req.session.user)return res.redirect('/login?departamento=PROVEEDURIA');if(!gestion(req.session.user)&&!contabilidad(req.session.user))return res.sendStatus(403);next();});
administracion.get('/',wrap(async(req,res)=>{
  if(req.baseUrl!=='/administracion/portal-proveedores')return res.redirect('/administracion/portal-proveedores');
  const [proveedores]=await pool.query('SELECT id,nombre FROM prov_proveedores WHERE activo=1 ORDER BY nombre');
  const [cuentas]=await pool.query('SELECT c.id,c.proveedor_id,c.email,c.cedula,c.plazo_dias,c.activo,p.nombre FROM prov_portal_cuentas c JOIN prov_proveedores p ON p.id=c.proveedor_id ORDER BY p.nombre');
  const [receptores]=await pool.query('SELECT * FROM prov_portal_receptores ORDER BY nombre');
  res.render('portal_proveedores/cuentas',{proveedores,cuentas,receptores,puedeGestion:true});
}));
administracion.post('/cuentas',wrap(async(req,res)=>{
  if(!gestion(req.session.user))return res.sendStatus(403);
  const email=String(req.body.email||'').trim().toLowerCase(),cedula=String(req.body.cedula||'').trim(),password=String(req.body.password||'');
  exigir(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email.length<=254&&/^\d{9,12}$/.test(cedula),'Correo o cédula inválidos');
  exigir(password.length>=12&&password.length<=128,'Use contraseña de 12 a 128 caracteres');
  const dias=numero(req.body.plazo_dias,'Días crédito');exigir(Number.isInteger(dias)&&dias<=3650,'Plazo inválido');
  const [p]=await pool.query('SELECT id FROM prov_proveedores WHERE id=? AND activo=1',[req.body.proveedor_id]);exigir(p.length,'Proveedor inválido');
  await pool.query('INSERT INTO prov_portal_cuentas (proveedor_id,email,cedula,password_hash,plazo_dias) VALUES (?,?,?,?,?)',[p[0].id,email,cedula,await bcrypt.hash(password,12),dias]);res.json({ok:true});
}));
administracion.post('/cuentas/:id',wrap(async(req,res)=>{
  if(!gestion(req.session.user))return res.sendStatus(403);
  exigir(['activar','desactivar','password'].includes(req.body.accion),'Acción inválida');
  if(req.body.accion==='password'){const p=String(req.body.password||'');exigir(p.length>=12&&p.length<=128,'Use contraseña de 12 a 128 caracteres');await pool.query('UPDATE prov_portal_cuentas SET password_hash=?,version_acceso=version_acceso+1 WHERE id=?',[await bcrypt.hash(p,12),req.params.id]);}
  else await pool.query('UPDATE prov_portal_cuentas SET activo=?,version_acceso=version_acceso+1 WHERE id=?',[req.body.accion==='activar'?1:0,req.params.id]);res.json({ok:true});
}));
administracion.post('/receptores',wrap(async(req,res)=>{
  if(!gestion(req.session.user))return res.sendStatus(403);
  const cedula=String(req.body.cedula||'').trim(),nombre=String(req.body.nombre||'').trim();exigir(/^\d{9,12}$/.test(cedula)&&nombre&&nombre.length<=255,'Cédula y razón social requeridas');
  await pool.query('INSERT INTO prov_portal_receptores (cedula,nombre,activo) VALUES (?,?,?) ON DUPLICATE KEY UPDATE nombre=VALUES(nombre),activo=VALUES(activo)',[cedula,nombre,req.body.activo==='0'?0:1]);res.json({ok:true});
}));
interno.get('/facturas',wrap(async(req,res)=>{const [r]=await pool.query("SELECT * FROM prov_documentos WHERE tipo='factura_portal' ORDER BY id DESC");const docs=r.map(parse);for(const row of docs)row.datos.control=await revisarFactura(pool,row);res.render('portal_proveedores/bandeja',{docs,saldo,excepciones,puedeContabilidad:contabilidad(req.session.user),puedeRecibir:gestion(req.session.user),puedeAdministracion:await esPropietarioAdministracion(req.session.user,pool)});}));
interno.post('/facturas/:id/notas-credito',wrap(async(req,res)=>{if(!contabilidad(req.session.user))return res.sendStatus(403);await cargarNota(req,res);}));
interno.post('/facturas/:id/:accion',wrap(async(req,res)=>{
  const a=req.params.accion;exigir(['hacienda','aprobar','rechazar','pago','orden','programar','cancelar-programacion','aplicar-nota','recepcion'].includes(a),'Acción inválida');
  if(a!=='hacienda'&&!(['orden','recepcion'].includes(a)&&gestion(req.session.user))&&!contabilidad(req.session.user))return res.sendStatus(403);
  if(a==='recepcion'&&!gestion(req.session.user))return res.sendStatus(403);
  let hacienda,actual,notasConsultadas=[];
  if(a==='hacienda'){actual=await documento(pool,req.params.id);hacienda=await consultarHacienda(actual.datos.factura.electronica.clave,actual.datos.factura.electronica);for(const n of (actual.datos.notas_credito||[]).filter(n=>!['ACEPTADA','RECHAZADA'].includes(n.hacienda.estado)).slice(0,20))notasConsultadas.push({clave:n.clave,anterior:JSON.stringify(n.hacienda),hacienda:await consultarHacienda(n.clave,n)});}
  await transaccion(async db=>{
    const row=await documento(db,req.params.id,true),f=row.datos.factura;
    if(a==='hacienda'){exigir(f.subida_en===actual.datos.factura.subida_en,'La factura cambió');if(JSON.stringify(f.electronica.hacienda)===JSON.stringify(actual.datos.factura.electronica.hacienda))f.electronica.hacienda=hacienda;for(const c of notasConsultadas){const n=row.datos.notas_credito?.find(n=>n.clave===c.clave);if(n&&JSON.stringify(n.hacienda)===c.anterior)n.hacienda=c.hacienda;}}
    if(a==='recepcion')await registrarRecepcionCompras(db,row,req.body,req.session.user.id);
    if(a==='orden')await vincularOrden(db,row,req.body,req.session.user.id);
    if(['aprobar','pago','programar'].includes(a)){row.datos.control=await revisarFactura(db,row,true);exigirControl(row.datos.control,a!=='aprobar');}
    if(a==='aprobar'){exigir(f.estado==='PENDIENTE','Factura ya revisada');aprobable(f);f.estado='CONCILIADA';f.cuenta_por_pagar=true;f.aprobada_en=new Date().toISOString();}
    if(a==='rechazar'){exigir(f.estado==='PENDIENTE','Factura ya revisada');const motivo=String(req.body.motivo||'').trim();exigir(motivo&&motivo.length<=1000,'Indique el motivo');f.estado='RECHAZADA_INTERNA';f.motivo=motivo;}
    if(a==='programar'){
      exigir(f.cuenta_por_pagar&&f.estado==='CONCILIADA','Factura pendiente de aprobación');aprobable(f);
      const monto=numero(req.body.monto,'Monto programado',0.01),fecha=String(req.body.fecha||'');
      exigir(monto<=saldo(row.datos).saldo,'La programación supera el saldo');
      exigir(/^\d{4}-\d{2}-\d{2}$/.test(fecha)&&Number.isFinite(Date.parse(fecha)),'Fecha de pago inválida');
      row.datos.programacion={monto,fecha,creado_por:req.session.user.id,creado_en:new Date().toISOString()};
    }
    if(a==='cancelar-programacion'){exigir(row.datos.programacion,'No existe pago programado');delete row.datos.programacion;}
    if(a==='aplicar-nota'){
      exigir(f.cuenta_por_pagar&&f.estado==='CONCILIADA','Apruebe la factura original antes de aplicar la nota de crédito');
      const n=(row.datos.notas_credito||[]).find(n=>n.clave===String(req.body.clave));exigir(n&&!n.aplicada,'Nota no encontrada o ya aplicada');
      aprobable({electronica:n});exigir(n.total<=saldo(row.datos).saldo,'La nota supera el saldo pendiente; requiere revisar devolución de fondos');
      n.aplicada=true;n.aplicada_por=req.session.user.id;n.aplicada_en=new Date().toISOString();delete row.datos.programacion;
    }
    if(a==='pago'){
      exigir(f.estado==='CONCILIADA'&&f.cuenta_por_pagar,'Factura pendiente de aprobación');aprobable(f);
      const monto=numero(req.body.monto,'Monto',0.01),referencia=String(req.body.referencia||'').trim(),fecha=String(req.body.fecha||'');
      exigir(monto<=saldo(row.datos).saldo,'El pago supera el saldo pendiente');exigir(referencia&&referencia.length<=100&&/^\d{4}-\d{2}-\d{2}$/.test(fecha)&&Number.isFinite(Date.parse(fecha)),'Referencia y fecha requeridas');exigir(!row.datos.pagos.some(p=>p.referencia===referencia),'Pago ya registrado');
      row.datos.pagos.push({monto,referencia,fecha,archivo:await guardarArchivo(db,adjunto(req.body.archivo))});delete row.datos.programacion;
    }
    (row.datos.eventos??=[]).push({accion:a,actor:req.session.user.id,fecha:new Date().toISOString(),...(a==='programar'?{programacion:{...row.datos.programacion}}:{}),...(a==='pago'?{referencia:req.body.referencia,monto:Number(req.body.monto)}:{})});
    await guardar(db,row,req.session.user.id,`Portal proveedor: ${a}`);
  });res.json({ok:true});
}));
interno.get('/facturas/:id/archivo/:tipo/:indice?',wrap(async(req,res)=>descargar(req,res,await documento(pool,req.params.id))));
function errores(e,req,res,next){console.error('Portal proveedores:',e.code||e.message);res.status(e.code==='ER_DUP_ENTRY'?409:e.status||500).json({error:e.code==='ER_DUP_ENTRY'?'El proveedor, correo, cédula o factura ya está registrado':e.status?e.message:'No se pudo completar la operación'});}
externo.use(errores);interno.use(errores);administracion.use(errores);
module.exports={externo,interno,administracion};
