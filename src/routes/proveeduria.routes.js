const router = require('express').Router();
const {facturasDeOrden}=require('../utils/portalFacturaOrden');
const { leerFacturaXML, consultarHacienda, aprobable, vencimiento } = require('../utils/proveedorHacienda');
const { rateLimit } = require('express-rate-limit');
const pool = require('../db');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const enviarCorreo = require('../utils/mail');
const { generarPDFOrden } = require('../utils/pdfOrdenCompra');
const { leerDocumento } = require('../utils/proveeduriaLectura');
const { esUsuarioTodasSedes, obtenerTodasSedes, sedeCanonicaVisible } = require('../utils/sedes');
const { esDepartamentoValido } = require('../utils/departamentos');
const { correosValidos,leerCorreosJSON } = require('../utils/proveeduriaProveedores');
const {GRUPOS,TIPOS,cantidadInventario,fichaInventario,estadoStock,guardarFichaInventario,registrarMovimientoInventario}=require('../utils/proveeduriaInventario');
const {resumenRecepcion,leerRecepcion,validarPendientes}=require('../utils/proveeduriaRecepciones');
const { exigir, numero, lineasCompra, totales, totalesConAjustes, compararFactura, saldo, hash, adjunto, conciliarEstado } = require('../utils/proveeduria');
const gestion = u => ['ADMIN','PROVEEDURIA','PROVEEDURIA_TALLER','BODEGA','BODEGUERO'].includes(u?.rol);
const contabilidad = u => ['ADMIN','CONTABILIDAD'].includes(u?.rol);
const datos = row => { if (typeof row.datos === 'string') row.datos = JSON.parse(row.datos); return row; };
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const error = (status, mensaje) => Object.assign(new Error(mensaje), { status });
const limitarLectura=rateLimit({windowMs:3600000,limit:20,standardHeaders:true,legacyHeaders:false,handler:(_req,res)=>res.status(429).json({error:'Límite de lectura automática alcanzado. Intente después o ingrese los datos manualmente.'})});
async function guardarAdjunto(db,a){
  const [r]=await db.query('INSERT INTO prov_adjuntos (nombre,mime,contenido) VALUES (?,?,?)',[a.nombre,a.mime,Buffer.from(a.base64,'base64')]);
  return {id:r.insertId,nombre:a.nombre,mime:a.mime};
}
async function documento(db,id,tipo,lock = false) {
  const [rows] = await db.query(`SELECT * FROM prov_documentos WHERE id = ? AND tipo = ? ${lock ? 'FOR UPDATE' : ''}`, [id,tipo]);
  if (!rows[0]) throw error(404,'Documento no encontrado');
  return datos(rows[0]);
}
async function guardar(db,row,actor,accion) {
  await db.query('UPDATE prov_documentos SET datos = ? WHERE id = ?', [JSON.stringify(row.datos),row.id]);
  await db.query('INSERT INTO prov_auditoria (documento_id,actor,accion) VALUES (?,?,?)',[row.id,String(actor),accion]);
}
async function alerta(db,id,mensaje,usuario = null,grupo = 'PROVEEDURIA') {
  await db.query('INSERT INTO prov_alertas (usuario_id,grupo,mensaje,documento_id) VALUES (?,?,?,?)',[usuario,usuario ? null : grupo,mensaje,id]);
}
async function transaccion(fn) {
  const db = await pool.getConnection();
  try { await db.beginTransaction(); const result = await fn(db); await db.commit(); return result; }
  catch(e) { await db.rollback(); throw e; } finally { db.release(); }
}
function visible(req,row) {
  if (!gestion(req.session.user) && !contabilidad(req.session.user) && row.usuario_id !== req.session.user.id) throw error(403,'No autorizado');
}
function sede(req) { const s = req.session.sedeSeleccionada || req.session.user.sede; exigir(s && s !== 'TODAS','Seleccione una sede específica desde el inicio'); return s; }
async function sedesOrden(req) {
  const u=req.session.user;
  if(esUsuarioTodasSedes(u))return (await obtenerTodasSedes(pool)).filter(s=>s&&s!=='TODAS');
  const [extras]=await pool.query('SELECT sede FROM usuarios_sedes WHERE usuario_id=?',[u.id]);
  return [...new Set([u.sede,...extras.map(r=>r.sede)].filter(s=>s&&s!=='TODAS').map(sedeCanonicaVisible))];
}
async function sedeFormulario(req) {
  if(!req.body.sede)return sede(req);
  const elegida=sedeCanonicaVisible(String(req.body.sede).trim());
  if(!(await sedesOrden(req)).includes(elegida))throw error(403,'No tiene acceso a la sede seleccionada');
  return elegida;
}
async function pdf(row) {
  const d = row.datos;
  // Reutiliza el diseño de Taller, con las condiciones y los impuestos de Proveeduría.
  return generarPDFOrden({ ...d, po_numero: `PR-${row.id}`, fecha: row.creado_en,
    departamento: 'Proveeduría', etiqueta_referencia: 'Artículo', tipo_mantenimiento: 'PROVEEDURÍA',
    forma_pago: `${d.forma_pago||d.condicion} ${d.credito ? d.credito + ' días' : ''}`, iva: d.iva ?? (d.subtotal ? d.impuesto / d.subtotal * 100 : 0),
    observaciones: `Razón social: ${d.razon_social}\nEntrega: ${d.entrega}\nMoneda: ${d.moneda}\n${d.observaciones||''}`
  }, { nombre: d.proveedor, email: d.email, telefono:d.proveedor_telefono, direccion:d.proveedor_direccion }, d.lineas.map(l=>({...l,codigo:l.referencia||d.placa_unidad||'PROVEEDURÍA',codigo_producto:l.codigo})));
}
// El enlace aleatorio da acceso únicamente a una OC; vence y puede revocarse al regenerarlo.
router.use(wrap(async(req,res,next) => {
  if (req.path.startsWith('/portal/')) {
    const token = req.path.split('/')[2];
    if (!/^[a-f0-9]{64}$/.test(token || '')) throw error(404,'Enlace inválido');
    const [rows] = await pool.query("SELECT * FROM prov_documentos WHERE tipo='oc' AND JSON_UNQUOTE(JSON_EXTRACT(datos,'$.portal_hash')) = ?",[hash(token)]);
    if (!rows[0]) throw error(404,'Enlace inválido');
    req.portal = datos(rows[0]);
    if (Date.now() > req.portal.datos.portal_vence) throw error(410,'Enlace vencido. Solicite uno nuevo a Proveeduría');
    res.set('Referrer-Policy','no-referrer'); res.set('Cache-Control','no-store');
    return next();
  }
  if (!req.session.user) return res.redirect('/login');
  const u = req.session.user;
  const compartida=(req.method==='GET'&&['/mis-solicitudes','/alertas'].includes(req.path))||(req.method==='POST'&&(req.path==='/solicitudes'||/^\/salidas\/\d+\/aceptar$/.test(req.path)));
  if(compartida&&esDepartamentoValido(u.departamentoActivo)&&!['PANTALLA_MECANICOS','PANTALLA_PESADOS'].includes(u.rol))return next();
  if (!(u.departamentos || []).includes('PROVEEDURIA') && !['PROVEEDURIA','CONTABILIDAD'].includes(u.departamentoActivo) && u.rol !== 'ADMIN') throw error(403,'Sin acceso a Proveeduría');
  next();
}));
router.get('/mis-solicitudes',wrap(async(req,res)=>{
  const u=req.session.user;
  const [rows]=await pool.query("SELECT * FROM prov_documentos WHERE usuario_id=? AND tipo IN ('solicitud','salida') ORDER BY id DESC LIMIT 500",[u.id]);
  const [alertas]=await pool.query('SELECT * FROM prov_alertas WHERE usuario_id=? ORDER BY id DESC LIMIT 40',[u.id]);
  const sedesPermitidas=await sedesOrden(req);
  const actual=req.session.sedeSeleccionada||u.sede;
  res.render('proveeduria/mis_solicitudes',{user:u,docs:rows.map(datos),alertas,sedesPermitidas,sedeActual:sedesPermitidas.includes(actual)?actual:''});
}));
router.get('/solicitudes',wrap(async(req,res)=>{
  if(!gestion(req.session.user))throw error(403,'Solo Proveeduría puede gestionar solicitudes');
  const [rows]=await pool.query("SELECT * FROM prov_documentos WHERE tipo='solicitud' ORDER BY id DESC LIMIT 500");
  res.render('proveeduria/solicitudes',{user:req.session.user,docs:rows.map(datos),puedeGestion:true});
}));
// Compatibilidad con enlaces antiguos: la pantalla única fue reemplazada por módulos.
router.get('/gestion',(req,res)=>res.redirect('/proveeduria/ordenes'));
router.get(['/', '/salidas', '/facturas', '/pagos', '/conciliacion', '/avisos'],wrap(async(req,res) => {
  const u = req.session.user;
  const completo = gestion(u) || contabilidad(u);
  const [docs] = await pool.query(`SELECT * FROM prov_documentos ${completo ? '' : 'WHERE usuario_id = ?'} ORDER BY id DESC LIMIT 500`, completo ? [] : [u.id]);
  docs.forEach(datos);
  const faltantes=[...new Set(docs.filter(d=>d.tipo==='estado').flatMap(d=>d.datos.partidas.map(p=>p.oc_id)).filter(id=>!docs.some(d=>d.id===id)))];
  const [historicas]=faltantes.length?await pool.query(`SELECT * FROM prov_documentos WHERE tipo='oc' AND id IN (${faltantes.map(()=>'?').join(',')})`,faltantes):[[]];
  const ordenesConciliacion=[...docs,...historicas.map(datos)].filter(d=>d.tipo==='oc');
  const sedeActual=req.session.sedeSeleccionada || u.sede || 'TODAS';
  const [alertas] = await pool.query('SELECT * FROM prov_alertas WHERE usuario_id = ? OR grupo = ? ORDER BY id DESC LIMIT 40',[u.id,gestion(u) ? 'PROVEEDURIA' : contabilidad(u) ? 'CONTABILIDAD' : 'USUARIO']);
  const modulo=req.path.slice(1),titulos={salidas:'Salidas de inventario',facturas:'Facturas',pagos:'Pagos y comprobantes',conciliacion:'Conciliación',avisos:'Alertas'};
  res.render(req.path==='/'?'proveeduria/dashboard':'proveeduria/modulo',{user:u,sedeActual,docs,alertas,puedeGestion:gestion(u),puedeContabilidad:contabilidad(u),saldo,conciliarEstado,ordenesConciliacion,modulo,titulo:titulos[modulo]});
}));
router.get('/alertas',wrap(async(req,res) => {
  const u=req.session.user;
  const [rows]=await pool.query('SELECT * FROM prov_alertas WHERE id > ? AND (usuario_id = ? OR grupo = ?) ORDER BY id LIMIT 50',[Number(req.query.desde)||0,u.id,gestion(u)?'PROVEEDURIA':contabilidad(u)?'CONTABILIDAD':'USUARIO']);
  res.json(rows);
}));
async function cargarInventario(req){
  const sedesPermitidas=await sedesOrden(req);
  const filtros={sede:String(req.query.sede||req.session.sedeSeleccionada||req.session.user.sede||'TODAS'),q:String(req.query.q||'').trim(),grupo:String(req.query.grupo||''),estado:String(req.query.estado||''),pagina:req.query.vista==='movimientos'?'movimientos':'inventario'};
  if(filtros.sede!=='TODAS'&&!sedesPermitidas.includes(filtros.sede))throw error(403,'No tiene acceso a esa sede');
  const sedes=filtros.sede==='TODAS'?sedesPermitidas:[filtros.sede];
  if(!sedes.length)return {inventario:[],movimientos:[],sedesPermitidas,filtros};
  const where=sedes.map(()=>'?').join(',');
  const [rows]=await pool.query(`SELECT i.*,COALESCE(f.grupo,'INVENTARIO') AS grupo,COALESCE(f.tipo,'OTRO') AS tipo,COALESCE(f.categoria,'') AS categoria,COALESCE(f.unidad,'UND') AS unidad,COALESCE(f.ubicacion,'') AS ubicacion,COALESCE(f.stock_minimo,0) AS stock_minimo,COALESCE(f.stock_maximo,0) AS stock_maximo,COALESCE(f.proveedor,'') AS proveedor FROM prov_inventario i LEFT JOIN prov_inventario_fichas f ON f.sede=i.sede AND f.codigo=i.codigo WHERE i.sede IN (${where}) ORDER BY i.descripcion,i.sede`,sedes);
  const normal=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const inventario=rows.filter(a=>(!filtros.grupo||a.grupo===filtros.grupo)&&(!filtros.estado||estadoStock(a)===filtros.estado)&&(!filtros.q||normal([a.codigo,a.descripcion,a.categoria,a.ubicacion,a.proveedor,a.sede].join(' ')).includes(normal(filtros.q))));
  const [movimientos]=await pool.query(`SELECT * FROM prov_inventario_movimientos WHERE sede IN (${where}) ${filtros.q?'AND (codigo LIKE ? OR descripcion LIKE ? OR motivo LIKE ?)':''} ORDER BY id DESC LIMIT 200`,[...sedes,...filtros.q?Array(3).fill('%'+filtros.q+'%'):[]]);
  return {inventario,movimientos,sedesPermitidas,filtros};
}
router.get('/inventario',wrap(async(req,res)=>{
  if(!gestion(req.session.user)&&!contabilidad(req.session.user))throw error(403,'No autorizado');
  const data=await cargarInventario(req);
  const [proveedores]=await pool.query('SELECT nombre FROM prov_proveedores WHERE activo=1 ORDER BY nombre');
  res.render('proveeduria/inventario',{...data,user:req.session.user,puedeGestion:gestion(req.session.user),GRUPOS,TIPOS,estadoStock,proveedores});
}));
router.get('/inventario/exportar.xlsx',wrap(async(req,res)=>{
  if(!gestion(req.session.user)&&!contabilidad(req.session.user))throw error(403,'No autorizado');
  const {inventario}=await cargarInventario(req);const w=new ExcelJS.Workbook(),s=w.addWorksheet('Inventario Proveeduría');
  s.columns=[{header:'Sede',key:'sede',width:23},{header:'Código',key:'codigo',width:23},{header:'Descripción',key:'descripcion',width:48},{header:'Grupo',key:'grupo',width:18},{header:'Categoría',key:'categoria',width:23},{header:'Unidad',key:'unidad',width:12},{header:'Existencia',key:'cantidad',width:16},{header:'Mínimo',key:'stock_minimo',width:16},{header:'Máximo',key:'stock_maximo',width:16},{header:'Ubicación',key:'ubicacion',width:23},{header:'Proveedor',key:'proveedor',width:40},{header:'IVA %',key:'iva',width:12}];
  inventario.forEach(a=>s.addRow({...a,cantidad:Number(a.cantidad),stock_minimo:Number(a.stock_minimo),stock_maximo:Number(a.stock_maximo),iva:Number(a.iva)}));s.views=[{state:'frozen',ySplit:1}];s.getRow(1).font={bold:true};
  res.attachment('Inventario-Proveeduria.xlsx');await w.xlsx.write(res);res.end();
}));
router.post('/inventario/articulos',wrap(async(req,res)=>{
  if(!gestion(req.session.user))throw error(403,'No autorizado');
  const sedeArticulo=await sedeFormulario(req),d=fichaInventario(req.body),cantidad=cantidadInventario(req.body.cantidad??0,'Stock inicial');
  const codigo=String(req.body.codigo||'').trim()||'PV-'+crypto.randomBytes(4).toString('hex').toUpperCase();exigir(codigo.length<=80,'Código demasiado largo');
  await transaccion(async db=>{
    const [existe]=await db.query('SELECT codigo FROM prov_inventario WHERE sede=? AND codigo=? FOR UPDATE',[sedeArticulo,codigo]);exigir(!existe.length,'El código ya existe en esta sede. Edite su ficha o ajuste la existencia');
    await db.query('INSERT INTO prov_inventario (sede,codigo,descripcion,iva,cantidad) VALUES (?,?,?,?,?)',[sedeArticulo,codigo,d.descripcion,d.iva,cantidad]);
    await guardarFichaInventario(db,sedeArticulo,codigo,d);
    if(cantidad)await registrarMovimientoInventario(db,{sede:sedeArticulo,codigo,tipo:'INICIAL',cantidad,usuario_id:req.session.user.id,motivo:'Registro de existencia inicial'});
  });res.json({ok:true,codigo});
}));
router.post('/inventario/ficha',wrap(async(req,res)=>{
  if(!gestion(req.session.user))throw error(403,'No autorizado');
  const sedeArticulo=await sedeFormulario(req),codigo=String(req.body.codigo||''),d=fichaInventario(req.body);
  await transaccion(async db=>{
    const [rows]=await db.query('SELECT codigo FROM prov_inventario WHERE sede=? AND codigo=? FOR UPDATE',[sedeArticulo,codigo]);exigir(rows.length,'Artículo no encontrado');
    await db.query('UPDATE prov_inventario SET descripcion=?,iva=? WHERE sede=? AND codigo=?',[d.descripcion,d.iva,sedeArticulo,codigo]);await guardarFichaInventario(db,sedeArticulo,codigo,d);
  });res.json({ok:true});
}));
router.post('/inventario/ajuste',wrap(async(req,res)=>{
  if(!gestion(req.session.user))throw error(403,'No autorizado');
  const sedeArticulo=await sedeFormulario(req),codigo=String(req.body.codigo||''),cantidad=cantidadInventario(req.body.cantidad,'Existencia física'),motivo=String(req.body.motivo||'').trim();
  exigir(motivo&&motivo.length<=500,'Indique el motivo del ajuste (máximo 500 caracteres)');
  await transaccion(async db=>{
    const [rows]=await db.query('SELECT cantidad FROM prov_inventario WHERE sede=? AND codigo=? FOR UPDATE',[sedeArticulo,codigo]);exigir(rows.length,'Artículo no encontrado');
    const diferencia=Math.round((cantidad-Number(rows[0].cantidad))*1000)/1000;exigir(diferencia!==0,'La existencia ya coincide con la cantidad indicada');
    await db.query('UPDATE prov_inventario SET cantidad=? WHERE sede=? AND codigo=?',[cantidad,sedeArticulo,codigo]);await registrarMovimientoInventario(db,{sede:sedeArticulo,codigo,tipo:'AJUSTE',cantidad:diferencia,usuario_id:req.session.user.id,motivo});
  });res.json({ok:true});
}));
router.get('/ordenes',wrap(async(req,res)=>{
  const u=req.session.user, completo=gestion(u)||contabilidad(u);
  const [rows]=await pool.query(`SELECT * FROM prov_documentos WHERE tipo='oc' ${completo?'':'AND usuario_id=?'} ORDER BY id DESC`,completo?[]:[u.id]);
  const filtros={buscar:String(req.query.buscar||'').trim(),estado:String(req.query.estado||''),fecha_desde:String(req.query.fecha_desde||''),fecha_hasta:String(req.query.fecha_hasta||'')};
  const ordenes=rows.map(datos).filter(r=>{
    const fecha=new Date(r.creado_en).toLocaleDateString('en-CA',{timeZone:'America/Costa_Rica'});
    return (!filtros.buscar||`PR-${r.id} ${r.datos.proveedor} ${r.sede}`.toLowerCase().includes(filtros.buscar.toLowerCase()))&&(!filtros.estado||r.datos.estado===filtros.estado)&&(!filtros.fecha_desde||fecha>=filtros.fecha_desde)&&(!filtros.fecha_hasta||fecha<=filtros.fecha_hasta);
  });
  res.render('proveeduria/ordenes',{user:u,ordenes,filtros,puedeGestion:gestion(u)});
}));
router.get('/recepciones',wrap(async(req,res)=>{
  if(!gestion(req.session.user)&&!contabilidad(req.session.user))throw error(403,'No autorizado');
  const sedesPermitidas=await sedesOrden(req);
  const filtros={sede:String(req.query.sede||req.session.sedeSeleccionada||req.session.user.sede||'TODAS'),estado:String(req.query.estado||'PENDIENTE'),q:String(req.query.q||'').trim()};
  if(filtros.sede!=='TODAS'&&!sedesPermitidas.includes(filtros.sede))throw error(403,'No tiene acceso a esa sede');
  const sedes=filtros.sede==='TODAS'?sedesPermitidas:[filtros.sede];
  const [rows]=sedes.length?await pool.query(`SELECT * FROM prov_documentos WHERE tipo='oc' AND sede IN (${sedes.map(()=>'?').join(',')}) ORDER BY id DESC`,sedes):[[]];
  const todas=rows.map(datos).map(r=>({...r,recepcion:resumenRecepcion(r.datos)}));
  const normal=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const ordenes=todas.filter(r=>(filtros.estado==='TODAS'||(filtros.estado==='PENDIENTE'?r.recepcion.estado!=='RECIBIDA':r.recepcion.estado===filtros.estado))&&(!filtros.q||normal(`PR-${r.id} ${r.datos.proveedor} ${r.sede} ${r.datos.lineas.map(l=>l.descripcion+' '+l.codigo).join(' ')}`).includes(normal(filtros.q))));
  const stats={pendientes:todas.filter(r=>r.recepcion.estado==='PENDIENTE').length,parciales:todas.filter(r=>r.recepcion.estado==='PARCIAL').length,recibidas:todas.filter(r=>r.recepcion.estado==='RECIBIDA').length};
  res.render('proveeduria/recepciones',{user:req.session.user,ordenes,stats,sedesPermitidas,filtros,puedeGestion:gestion(req.session.user)});
}));
router.get('/ordenes/:id/recepcion',wrap(async(req,res)=>{
  if(!gestion(req.session.user)&&!contabilidad(req.session.user))throw error(403,'No autorizado');
  const row=await documento(pool,req.params.id,'oc');
  if(!(await sedesOrden(req)).includes(row.sede))throw error(403,'No tiene acceso a la sede de esta OC');
  res.set('Cache-Control','no-store');
  res.render('proveeduria/recepcion',{user:req.session.user,row,resumen:resumenRecepcion(row.datos),token:crypto.randomBytes(16).toString('hex'),puedeGestion:gestion(req.session.user)});
}));
router.get('/proveedores',wrap(async(req,res)=>{
  if(!gestion(req.session.user)&&!contabilidad(req.session.user))throw error(403,'No autorizado');
  const [proveedores]=await pool.query('SELECT p.nombre,c.telefono,c.correos,c.correo_original,c.direccion,c.condicion_pago FROM prov_proveedores p LEFT JOIN prov_proveedor_contactos c ON c.clave=p.clave WHERE p.activo=1 ORDER BY p.nombre');
  proveedores.forEach(p=>{p.correos=leerCorreosJSON(p.correos);});
  res.render('proveeduria/proveedores',{proveedores});
}));
router.get(['/ordenes/nueva','/solicitudes/:id/cotizacion'],wrap(async(req,res)=>{
  if(!gestion(req.session.user))throw error(403,'No autorizado');
  const esCotizacion=Boolean(req.params.id);
  const [proveedores]=await pool.query('SELECT p.nombre,c.telefono,c.correos,c.correo_original,c.direccion,c.condicion_pago FROM prov_proveedores p LEFT JOIN prov_proveedor_contactos c ON c.clave=p.clave WHERE p.activo=1 ORDER BY p.nombre');
  proveedores.forEach(p=>{p.correos=leerCorreosJSON(p.correos);});
  const solicitudId=req.params.id||req.query.solicitud_id;
  const solicitud=solicitudId?await documento(pool,solicitudId,'solicitud'):null;
  if(solicitud)exigir(!solicitud.datos.oc_id&&!solicitud.datos.salida_id,'Esta solicitud ya tiene OC o fue despachada');
  if(solicitud&&!esCotizacion&&!solicitud.datos.cotizacion)return res.redirect(`/proveeduria/solicitudes/${solicitud.id}/cotizacion`);
  const sedesPermitidas=solicitud?[solicitud.sede]:await sedesOrden(req);
  const seleccionada=solicitud?.sede||req.session.sedeSeleccionada||req.session.user.sede;
  const sedeActual=sedesPermitidas.includes(seleccionada)?seleccionada:'';
  const cotizacion=solicitud?.datos.cotizacion;
  const precarga=cotizacion?{...cotizacion,cotizacion_archivo:cotizacion.cotizacion_archivo?`/proveeduria/solicitudes/${solicitud.id}/cotizacion/archivo`:null}:null;
  res.render('compras/orden_form',{orden:precarga,esNuevaOrden:true,solicitudId:solicitud?.id||'',lineas:solicitud?solicitud.datos.lineas.map(l=>({...l,codigo:'',codigo_producto:l.codigo,precio_unitario:cotizacion?.lineas.find(x=>x.codigo===l.codigo)?.precio_unitario??'',subtotal:cotizacion?.lineas.find(x=>x.codigo===l.codigo)?.subtotal??0})):[],proveedores,siguientePO:esCotizacion?'Cotización · Sin OC':'Se asigna al guardar',esProveeduria:true,sedesPermitidas,sedeActual,tituloOrden:esCotizacion?'Cotizar solicitud PR-'+solicitud.id:'Nueva orden de compra',textoGuardar:esCotizacion?'Guardar cotización':'Guardar orden',subtituloOrden:esCotizacion?`Solicitud de ${solicitud.datos.departamento||'departamento solicitante'} · ${solicitud.datos.solicitante||'Usuario '+solicitud.usuario_id}`:'Departamento de Proveeduría · Complete el encabezado, líneas y totales de la orden.',volverUrl:esCotizacion?'/proveeduria/solicitudes':'/proveeduria/ordenes',cancelarUrl:'/proveeduria/solicitudes',formAction:esCotizacion?`/proveeduria/solicitudes/${solicitud.id}/cotizacion`:'/proveeduria/ordenes'});
}));
router.get('/solicitudes/:id/cotizacion/archivo',wrap(async(req,res)=>{
  if(!gestion(req.session.user))throw error(403,'No autorizado');
  const row=await documento(pool,req.params.id,'solicitud'),a=row.datos.cotizacion?.cotizacion_archivo;
  if(!a)throw error(404,'Cotización no encontrada');
  const [files]=await pool.query('SELECT contenido FROM prov_adjuntos WHERE id=?',[a.id]);if(!files[0])throw error(404,'Archivo no encontrado');
  res.set('X-Content-Type-Options','nosniff');res.attachment(a.nombre);res.type(a.mime).send(files[0].contenido);
}));
router.post('/cotizacion/analizar',limitarLectura,wrap(async(req,res)=>{
  if(!gestion(req.session.user))throw error(403,'No autorizado');
  const [proveedores]=await pool.query('SELECT id,nombre FROM proveedores ORDER BY nombre');
  const orden=await require('../utils/cotizacionLocal').leerCotizacionLocal(req.body,proveedores);
  res.json({ok:true,orden});
}));
router.post('/solicitudes',wrap(async(req,res) => {
  exigir(Array.isArray(req.body.lineas),'Agregue los artículos solicitados');
  const lineas = lineasCompra((req.body.lineas||[]).map(l=>({...l,codigo:String(l.codigo||'').trim()||'ART-'+crypto.createHash('sha256').update(String(l.descripcion||'').trim().toUpperCase()).digest('hex').slice(0,12),iva:13})));
  const sedeSolicitud=await sedeFormulario(req);
  const u=req.session.user;
  exigir(esDepartamentoValido(u.departamentoActivo),'Seleccione su departamento antes de crear una solicitud');
  const id = await transaccion(async db=>{
    for(const l of lineas){const [stock]=await db.query('SELECT descripcion,iva FROM prov_inventario WHERE sede=? AND codigo=?',[sedeSolicitud,l.codigo]);if(stock[0]){l.descripcion=stock[0].descripcion;l.iva=Number(stock[0].iva);}}
    const [r]=await db.query("INSERT INTO prov_documentos (tipo,usuario_id,sede,datos) VALUES ('solicitud',?,?,?)",[u.id,sedeSolicitud,JSON.stringify({lineas,estado:'PENDIENTE',departamento:u.departamentoActivo,solicitante:u.nombre||u.usuario,motivo:String(req.body.motivo||'').trim().slice(0,2000)})]);
    await alerta(db,r.insertId,`Nueva solicitud PR-${r.insertId} de ${u.departamentoActivo} · ${u.nombre||u.usuario}`); return r.insertId;
  }); res.json({id});
}));
router.post('/cotizacion/importar',limitarLectura,wrap(async(req,res) => {
  if (!gestion(req.session.user)) throw error(403,'No autorizado');
  if(!String(req.body.nombre||'').toLowerCase().endsWith('.xlsx')) return res.json(await leerDocumento(req.body,'cotizacion'));
  exigir(typeof req.body.base64==='string' && req.body.base64.length<7000000,'Cotización demasiado grande');
  const w=new ExcelJS.Workbook(); await w.xlsx.load(Buffer.from(req.body.base64,'base64'));
  const s=w.getWorksheet('Cotizacion'); exigir(s,'Se requiere la hoja Cotizacion de la plantilla descargable');
  const value=(r,c)=>s.getCell(r,c).text.trim();
  const lineas=[]; s.eachRow((r,n)=>{if(n>=9 && value(n,1))lineas.push({codigo:value(n,1),descripcion:value(n,2),cantidad:value(n,3),precio_unitario:value(n,4),iva:value(n,5)||13});});
  res.json({proveedor:value(1,2),email:value(2,2),razon_social:value(3,2),entrega:value(4,2),condicion:value(5,2),credito:Number(value(6,2))||0,moneda:value(7,2),lineas:lineasCompra(lineas,true)});
}));
router.get('/cotizacion/plantilla',wrap(async(req,res)=>{
  const w=new ExcelJS.Workbook(),s=w.addWorksheet('Cotizacion');
  s.addRows([['Proveedor',''],['Email',''],['Razón social compradora','GAS TOMZA DE COSTA RICA S.A.'],['Plazo entrega',''],['Condición','CREDITO'],['Crédito días',30],['Moneda','CRC'],['Código','Descripción','Cantidad','Precio unitario','IVA %']]);
  s.columns=[{width:28},{width:48},{width:18},{width:20},{width:14}];
  res.attachment('Cotizacion-proveeduria.xlsx'); await w.xlsx.write(res);res.end();
}));
router.post(['/ordenes','/solicitudes/:id/cotizacion'],wrap(async(req,res)=>{
  if(!gestion(req.session.user))throw error(403,'No autorizado');
  const esCotizacion=Boolean(req.params.id);
  if(esCotizacion)req.body.solicitud_id=req.params.id;
  const compartido=req.body.origen_formulario==='taller';
  if(compartido){
    const b=req.body; const empresas={'GAS TOMZA':'GAS TOMZA DE COSTA RICA S.A.','SUPER GAS':'ENVASADORA SUPER GAS GLP S.A.','GRANEL':'GAS TOMZA DE COSTA RICA S.A.'};
    exigir(empresas[b.empresa_destino],'Empresa destinataria inválida');
    b.lineas=Object.values(b.lineas||{}).map(l=>({...l,referencia:l.codigo,codigo:String(l.codigo_producto||'').trim()||'ART-'+crypto.createHash('sha256').update(String(l.descripcion||'')).digest('hex').slice(0,12),iva:b.iva??13}));
    b.precios=Object.fromEntries(b.lineas.map(l=>[l.codigo,l.precio_unitario]));
    b.iva_global=!b.solicitud_id;
    b.razon_social=empresas[b.empresa_destino];b.condicion=Number(b.credito)?'CREDITO':'CONTADO';b.modo=b.solicitud_id?'manual':'cotizacion';
  }
  const sedeDirecta=compartido&&!req.body.solicitud_id?await sedeFormulario(req):null;
  const id=await transaccion(async db=>{
    let solicitud;
    if(compartido&&!req.body.solicitud_id){
      const lineas=lineasCompra(req.body.lineas);
      const [r]=await db.query("INSERT INTO prov_documentos (tipo,usuario_id,sede,datos) VALUES ('solicitud',?,?,?)",[req.session.user.id,sedeDirecta,JSON.stringify({lineas,estado:'PENDIENTE',origen:'OC_DIRECTA'})]);
      solicitud={id:r.insertId,usuario_id:req.session.user.id,sede:sedeDirecta,datos:{lineas,estado:'PENDIENTE'}};
    }else solicitud=await documento(db,req.body.solicitud_id,'solicitud',true);
    exigir(!solicitud.datos.oc_id&&!solicitud.datos.salida_id,'Esta solicitud ya tiene OC o fue despachada');
    if(!esCotizacion&&solicitud.datos.departamento)exigir(solicitud.datos.cotizacion,'Primero prepare y guarde la cotización');
    let lineas;
    if(req.body.modo==='manual') {
      lineas=lineasCompra(solicitud.datos.lineas.map(l=>({...l,precio_unitario:req.body.precios?.[l.codigo]})),true);
    } else {
      lineas=lineasCompra(req.body.lineas,true);
      exigir(lineas.length===solicitud.datos.lineas.length && solicitud.datos.lineas.every(l=>lineas.some(x=>x.codigo===l.codigo && x.cantidad===l.cantidad)),'La cotización debe corresponder a la solicitud');
    }
    const d={lineas,...totalesConAjustes(lineas,req.body),solicitud_id:solicitud.id,proveedor:String(req.body.proveedor||'').trim(),email:String(req.body.email||'').trim(),razon_social:String(req.body.razon_social||'').trim(),entrega:String(req.body.entrega||'').trim(),condicion:req.body.condicion,credito:Number(req.body.credito),moneda:req.body.moneda,empresa_destino:req.body.empresa_destino||'GAS TOMZA',forma_pago:String(req.body.forma_pago||''),observaciones:String(req.body.observaciones||''),estado:'GENERADA',pagos:[]};
    const correos=correosValidos(d.email);
    exigir(d.proveedor && d.razon_social && d.entrega && correos.length,'Complete proveedor, correo válido, razón social y entrega');
    d.email=correos.join(', ');
    d.proveedor_telefono=String(req.body.proveedor_telefono||'').trim().slice(0,120);
    d.proveedor_direccion=String(req.body.proveedor_direccion||'').trim().slice(0,4000);
    if(compartido)exigir(req.body.credito!=='' && req.body.credito!==undefined,'Seleccione contado o el plazo de crédito de 30, 60 o 90 días');
    exigir(['CRC','USD'].includes(d.moneda)&&['CONTADO','CREDITO'].includes(d.condicion),'Condición o moneda inválida');
    exigir(d.condicion==='CONTADO' ? d.credito===0 : [30,60,90].includes(d.credito),'Crédito: 30, 60 o 90 días; contado: 0');
    d.placa_unidad=String(req.body.placa_unidad||'');
    d.iva_global=req.body.iva_global===true;
    if(req.body.cotizacion_data){
      const match=String(req.body.cotizacion_data).match(/^data:[^;]+;base64,(.+)$/);exigir(match,'Cotización inválida');
      d.cotizacion_archivo=await guardarAdjunto(db,adjunto({nombre:req.body.cotizacion_nombre,base64:match[1]}));d.cotizacion_nombre=d.cotizacion_archivo.nombre;
    }
    if(!d.cotizacion_archivo&&solicitud.datos.cotizacion?.cotizacion_archivo){d.cotizacion_archivo=solicitud.datos.cotizacion.cotizacion_archivo;d.cotizacion_nombre=solicitud.datos.cotizacion.cotizacion_nombre;}
    if(esCotizacion){
      solicitud.datos.cotizacion={...d,cotizada_por:req.session.user.id,cotizada_en:new Date().toISOString()};solicitud.datos.estado='COTIZADA';
      await guardar(db,solicitud,req.session.user.id,'Cotización preparada');await alerta(db,solicitud.id,'Proveeduría preparó la cotización de su solicitud',solicitud.usuario_id);return solicitud.id;
    }
    const [r]=await db.query("INSERT INTO prov_documentos (tipo,usuario_id,sede,datos) VALUES ('oc',?,?,?)",[solicitud.usuario_id,solicitud.sede,JSON.stringify(d)]);
    solicitud.datos.estado='ORDENADA';solicitud.datos.oc_id=r.insertId;await guardar(db,solicitud,req.session.user.id,'OC generada');
    await alerta(db,r.insertId,`OC PR-${r.insertId} generada`,solicitud.usuario_id);return r.insertId;
  });if(compartido)return res.redirect(esCotizacion?'/proveeduria/solicitudes':'/proveeduria/ordenes');res.json({id});
}));
router.get('/ordenes/:id/pdf',wrap(async(req,res)=>{const row=await documento(pool,req.params.id,'oc');visible(req,row);res.type('pdf').send(await pdf(row));}));
router.post('/ordenes/:id/enviar',wrap(async(req,res)=>{
  if(!gestion(req.session.user))throw error(403,'No autorizado');
  const row=await documento(pool,req.params.id,'oc');
  const token=crypto.randomBytes(32).toString('hex');
  const base=process.env.PUBLIC_BASE_URL;
  exigir(base && /^https:\/\//.test(base),'Configure PUBLIC_BASE_URL con la dirección HTTPS del sistema');
  const link=`${base.replace(/\/$/,'')}/proveeduria/portal/${token}`;
  // Se guarda antes del envío para que el vínculo recibido siempre sea válido.
  await transaccion(async db=>{const r=await documento(db,row.id,'oc',true);r.datos.portal_hash=hash(token);r.datos.portal_vence=Date.now()+90*86400000;await guardar(db,r,req.session.user.id,'Enlace proveedor regenerado');});
  await enviarCorreo(row.datos.email,`Orden de compra PR-${row.id} · Proveeduría`,`<p>Estimado proveedor: adjuntamos nuestra orden de compra. Agradecemos confirmar disponibilidad y plazo de entrega.</p><p><a href="${link.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">Abrir portal privado del proveedor</a> para cargar factura y estado de cuenta, y consultar comprobantes de pago.</p>`,{nombreRemitente:'Proveeduría · Gas Tomza',text:`Estimado proveedor: adjuntamos OC PR-${row.id}. Portal privado: ${link}`,attachments:[{filename:`OC-PR-${row.id}.pdf`,content:await pdf(row)}]});
  await transaccion(async db=>{const r=await documento(db,row.id,'oc',true);r.datos.enviada_en=new Date().toISOString();await guardar(db,r,req.session.user.id,'Correo enviado');});res.json({ok:true});
}));
router.post('/ordenes/:id/recibir',wrap(async(req,res)=>{
  if(!gestion(req.session.user))throw error(403,'No autorizado');
  const recibo=leerRecepcion(req.body),sedesPermitidas=await sedesOrden(req);
  const resultado=await transaccion(async db=>{
    const row=await documento(db,req.params.id,'oc',true);
    if(!sedesPermitidas.includes(row.sede))throw error(403,'No tiene acceso a la sede de esta OC');
    const resumen=resumenRecepcion(row.datos),existente=resumen.historial.find(r=>r.id===recibo.id);
    if(existente){exigir(existente.huella===recibo.huella,'Esta recepción ya fue registrada con otros datos. Actualice la página');return {ok:true,repetida:true,estado:row.datos.estado,recepcion_id:existente.id};}
    validarPendientes(resumen,recibo);
    const lineas=recibo.lineas.filter(l=>l.cantidad>0).map(l=>({...resumen.lineas.find(x=>x.codigo===l.codigo),cantidad:l.cantidad}));
    for(const l of lineas){
      await db.query('INSERT INTO prov_inventario (sede,codigo,descripcion,iva,cantidad) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE cantidad = cantidad + VALUES(cantidad), descripcion = VALUES(descripcion), iva = VALUES(iva)',[row.sede,l.codigo,l.descripcion,l.iva,l.cantidad]);
      await db.query('INSERT INTO prov_inventario_fichas (sede,codigo,proveedor) VALUES (?,?,?) ON DUPLICATE KEY UPDATE proveedor=VALUES(proveedor)',[row.sede,l.codigo,row.datos.proveedor||'']);
      await registrarMovimientoInventario(db,{sede:row.sede,codigo:l.codigo,tipo:'ENTRADA_OC',cantidad:l.cantidad,documento_id:row.id,usuario_id:req.session.user.id,motivo:`Recepción de OC PR-${row.id} · ${recibo.referencia}`});
    }
    const fecha=new Date().toISOString();
    row.datos.recepciones=[...resumen.historial,{id:recibo.id,huella:recibo.huella,fecha,usuario_id:req.session.user.id,recibido_por:req.session.user.nombre||req.session.user.usuario,referencia:recibo.referencia,observaciones:recibo.observaciones,lineas:lineas.map(l=>({codigo:l.codigo,descripcion:l.descripcion,cantidad:l.cantidad}))}];
    row.datos.estado=resumenRecepcion(row.datos).estado;
    if(row.datos.estado==='RECIBIDA')row.datos.recibida_en=fecha;
    await guardar(db,row,req.session.user.id,`Recepción ${row.datos.estado==='RECIBIDA'?'completa':'parcial'} · ${recibo.referencia}`);
    if(row.datos.estado==='RECIBIDA'&&row.datos.solicitud_id){const s=await documento(db,row.datos.solicitud_id,'solicitud',true);if(!s.datos.salida_id){s.datos.estado='LISTA_PARA_ENTREGA';await guardar(db,s,req.session.user.id,'Compra recibida en Proveeduría');await alerta(db,s.id,'Proveeduría recibió la compra de su solicitud. La entrega está pendiente de alistar.',s.usuario_id);}}
    return {ok:true,estado:row.datos.estado,recepcion_id:recibo.id};
  });res.json(resultado);
}));
router.post('/salidas',wrap(async(req,res)=>{
  if(!gestion(req.session.user))throw error(403,'No autorizado');
  const id=await transaccion(async db=>{
    const solicitud=await documento(db,req.body.solicitud_id,'solicitud',true);
    exigir(!solicitud.datos.salida_id,'Solicitud ya despachada');
    if(solicitud.datos.departamento)exigir(solicitud.datos.oc_id,'Primero cotice la solicitud y genere la OC');
    if(solicitud.datos.oc_id){const oc=await documento(db,solicitud.datos.oc_id,'oc',true);exigir(oc.datos.estado==='RECIBIDA','Primero registre la recepción de la mercadería');}
    const lineas=[];
    for(const l of [...solicitud.datos.lineas].sort((a,b)=>a.codigo.localeCompare(b.codigo))){
      const [stock]=await db.query('SELECT * FROM prov_inventario WHERE sede=? AND codigo=? FOR UPDATE',[solicitud.sede,l.codigo]);
      exigir(stock[0] && Number(stock[0].cantidad)>=l.cantidad,`Inventario insuficiente: ${l.codigo}`);
      await db.query('UPDATE prov_inventario SET cantidad=cantidad-? WHERE sede=? AND codigo=?',[l.cantidad,solicitud.sede,l.codigo]);lineas.push(l);
    }
    const [r]=await db.query("INSERT INTO prov_documentos (tipo,usuario_id,sede,datos) VALUES ('salida',?,?,?)",[solicitud.usuario_id,solicitud.sede,JSON.stringify({lineas,solicitud_id:solicitud.id,estado:'ALISTANDO'})]);
    for(const l of lineas)await registrarMovimientoInventario(db,{sede:solicitud.sede,codigo:l.codigo,tipo:'SALIDA_PEDIDO',cantidad:-l.cantidad,documento_id:r.insertId,usuario_id:req.session.user.id,motivo:`Entrega de solicitud PR-${solicitud.id}`});
    solicitud.datos.salida_id=r.insertId;solicitud.datos.estado='ALISTANDO';await guardar(db,solicitud,req.session.user.id,'Salida de inventario');await alerta(db,r.insertId,'Su pedido se está alistando',solicitud.usuario_id);return r.insertId;
  });res.json({id});
}));
router.post('/salidas/:id/:accion',wrap(async(req,res)=>{
  await transaccion(async db=>{
    const row=await documento(db,req.params.id,'salida',true);
    if(req.params.accion==='enviar'){
      if(!gestion(req.session.user))throw error(403,'No autorizado');exigir(row.datos.estado==='ALISTANDO','Salida ya enviada');row.datos.estado='EN_CAMINO';await alerta(db,row.id,'Su pedido va en camino. Confirme al recibirlo.',row.usuario_id);
    }else if(req.params.accion==='aceptar'){
      if(row.usuario_id!==req.session.user.id)throw error(403,'Solo el solicitante puede confirmar la recepción');exigir(row.datos.estado==='EN_CAMINO','Pedido no enviado o ya recibido');row.datos.estado='RECIBIDA';row.datos.aceptada_en=new Date().toISOString();await alerta(db,row.id,'El solicitante confirmó la recepción del pedido');
    }else throw error(404,'Acción inválida');
    await guardar(db,row,req.session.user.id,req.params.accion);
    if(row.datos.solicitud_id){const s=await documento(db,row.datos.solicitud_id,'solicitud',true);s.datos.estado=req.params.accion==='aceptar'?'ENTREGADA':'EN_CAMINO';await guardar(db,s,req.session.user.id,'Seguimiento de entrega');}
  });res.json({ok:true});
}));
router.get('/salidas/:id/imprimir',wrap(async(req,res)=>{const row=await documento(pool,req.params.id,'salida');visible(req,row);res.render('proveeduria/salida',{row});}));
router.get('/cuentas-por-pagar',wrap(async(req,res)=>{
  if(!contabilidad(req.session.user))throw error(403,'Solo Contabilidad');
  const [rows]=await pool.query("SELECT * FROM prov_documentos WHERE tipo IN ('oc','factura_portal') AND JSON_TYPE(JSON_EXTRACT(datos,'$.factura')) = 'OBJECT' ORDER BY id DESC");
  const docs=rows.map(datos);
  res.render('proveeduria/cuentas_por_pagar',{user:req.session.user,docs,saldo});
}));
router.post('/ordenes/:id/hacienda',limitarLectura,wrap(async(req,res)=>{
  if(!gestion(req.session.user)&&!contabilidad(req.session.user))throw error(403,'No autorizado');
  const actual=await documento(pool,req.params.id,'oc');
  exigir(actual.datos.factura?.electronica,'Cargue el XML de la factura');
  const clave=actual.datos.factura.electronica.clave;
  const hacienda=await consultarHacienda(clave,actual.datos.factura.electronica);
  await transaccion(async db=>{
    const row=await documento(db,actual.id,'oc',true);
    exigir(row.datos.factura?.electronica?.clave===clave,'La factura cambió; vuelva a consultar');
    row.datos.factura.electronica.hacienda=hacienda;
    await guardar(db,row,req.session.user.id,'Consulta Hacienda: '+hacienda.estado);
  });
  res.json({ok:true,hacienda});
}));
router.get('/portal/:token',wrap(async(req,res)=>{res.render('proveeduria/portal',{row:req.portal,token:req.params.token,saldo:saldo(req.portal.datos)});}));
router.post('/portal/:token/leer-factura',limitarLectura,wrap(async(req,res)=>{res.json(await leerDocumento(req.body,'factura'));}));
router.post('/portal/:token/leer-estado',limitarLectura,wrap(async(req,res)=>{res.json(await leerDocumento(req.body,'estado'));}));
router.post('/portal/:token/estado-general',wrap(async(req,res)=>{
  await transaccion(async db=>{
    const row=await documento(db,req.portal.id,'oc',true);
    exigir(row.datos.portal_hash===hash(req.params.token)&&Date.now()<=row.datos.portal_vence,'Enlace revocado o vencido');
    exigir(Array.isArray(req.body.partidas)&&req.body.partidas.length>0&&req.body.partidas.length<=200,'Ingrese partidas por OC');
    const partidas=req.body.partidas.map(p=>({oc_id:numero(p.oc_id,'Número OC',1),factura:String(p.factura||'').trim(),depositos:numero(p.depositos,'Depósitos'),saldo:numero(p.saldo,'Saldo',-1e10)}));
    exigir(partidas.every(p=>Number.isInteger(p.oc_id)&&p.factura)&&new Set(partidas.map(p=>p.oc_id)).size===partidas.length,'Una partida por OC, con su número de factura');
    exigir(['CRC','USD'].includes(req.body.moneda),'Moneda inválida');
    const [ordenes]=await db.query("SELECT * FROM prov_documentos WHERE tipo='oc' AND JSON_UNQUOTE(JSON_EXTRACT(datos,'$.email'))=?",[row.datos.email]);
    const estado={proveedor:row.datos.proveedor,email:row.datos.email,moneda:req.body.moneda,fecha:String(req.body.fecha||''),partidas,archivo:await guardarAdjunto(db,adjunto(req.body.archivo))};
    exigir(/^\d{4}-\d{2}-\d{2}$/.test(estado.fecha)&&Number.isFinite(Date.parse(estado.fecha)),'Fecha inválida');
    const resultado=conciliarEstado(estado,ordenes.map(datos));
    exigir(resultado.every(p=>p.sistema),'Todas las OC deben pertenecer a este proveedor y moneda');
    const [r]=await db.query("INSERT INTO prov_documentos (tipo,usuario_id,sede,datos) VALUES ('estado',0,?,?)",[row.sede,JSON.stringify(estado)]);
    await alerta(db,r.insertId,`Estado de cuenta de ${estado.proveedor}: ${resultado.filter(p=>p.error).length} partidas con diferencias`,null,'CONTABILIDAD');
  });res.json({ok:true});
}));
router.post('/portal/:token/:accion',limitarLectura,wrap(async(req,res)=>{
  let electronica;
  if(req.params.accion==='factura'){
    electronica=leerFacturaXML(req.body.xml);
    const {archivo,...campos}=electronica;
    electronica={...campos,archivo,hacienda:await consultarHacienda(campos.clave,campos)};
  }
  await transaccion(async db=>{
    const row=await documento(db,req.portal.id,'oc',true);
    exigir(row.datos.portal_hash===hash(req.params.token) && Date.now()<=row.datos.portal_vence,'Enlace revocado o vencido');
    const archivo=await guardarAdjunto(db,adjunto(req.body.archivo));
    if(req.params.accion==='factura'){
      exigir(!row.datos.factura || ['DEVUELTA','DEVUELTA_CONTABILIDAD'].includes(row.datos.factura.estado),'Ya existe una factura en revisión o aceptada');
      const lineas=lineasCompra(req.body.lineas,true);
      const f={numero:String(req.body.numero||'').trim(),proveedor:String(req.body.proveedor||'').trim(),moneda:req.body.moneda,lineas,...totalesConAjustes(lineas,req.body),archivo,subida_en:new Date().toISOString(),estado:'PENDIENTE'};
      exigir(f.numero && f.proveedor && ['CRC','USD'].includes(f.moneda),'Complete número, proveedor y moneda');
      exigir(Math.abs(numero(req.body.total,'Total factura')-f.total)<=0.01,'El total declarado no coincide con las líneas');
      exigir(Math.abs(electronica.total-f.total)<=0.01 && electronica.moneda===f.moneda,'El total o moneda del XML no coincide con la factura');
      exigir(f.numero===electronica.consecutivo,'El número debe coincidir con el consecutivo del XML');
      exigir(electronica.nombre_emisor.trim().toUpperCase()===f.proveedor.trim().toUpperCase(),'El proveedor debe coincidir con el emisor del XML');
      exigir(electronica.nombre_receptor.trim().toUpperCase()===row.datos.razon_social.trim().toUpperCase(),'El receptor del XML no coincide con la razón social de la OC');
      const [claves]=await db.query('SELECT documento_id FROM prov_facturas_claves WHERE clave=? FOR UPDATE',[electronica.clave]);
      exigir(!claves.length || Number(claves[0].documento_id)===Number(row.id),'Esta factura ya fue cargada en otra OC');
      if(!claves.length)await db.query('INSERT INTO prov_facturas_claves (clave,documento_id) VALUES (?,?)',[electronica.clave,row.id]);
      electronica.archivo=await guardarAdjunto(db,electronica.archivo);
      f.electronica=electronica;
      f.fecha_vencimiento=vencimiento(electronica.fecha,row.datos.credito);
      f.diferencias=compararFactura(row.datos,f);
      if(row.datos.factura){row.datos.factura_historial=row.datos.factura_historial||[];row.datos.factura_historial.push(row.datos.factura);}
      row.datos.factura=f;
      await alerta(db,row.id,`Factura ${f.numero} subida: ${f.diferencias.length ? f.diferencias.join('; ') : 'coincide con OC'}`);
    }else if(req.params.accion==='estado-cuenta'){
      const fecha=String(req.body.fecha||'');exigir(/^\d{4}-\d{2}-\d{2}$/.test(fecha)&&Number.isFinite(Date.parse(fecha)),'Fecha inválida');
      row.datos.estado_cuenta={archivo,saldo:numero(req.body.saldo,'Saldo declarado',-1e10),fecha,subido_en:new Date().toISOString()};
      await alerta(db,row.id,'Proveedor subió estado de cuenta','', 'CONTABILIDAD');
    }else throw error(404,'Acción inválida');
    await guardar(db,row,`Proveedor OC ${row.id}`,req.params.accion);
  });res.json({ok:true});
}));
router.post('/ordenes/:id/factura/:accion',wrap(async(req,res)=>{
  await transaccion(async db=>{
    const row=await documento(db,req.params.id,'oc',true), f=row.datos.factura;
    exigir(f,'No hay factura');const a=req.params.accion;
    if(['aceptar','devolver'].includes(a)){
      if(!gestion(req.session.user))throw error(403,'No autorizado');exigir(f.estado==='PENDIENTE','Factura ya revisada');
      if(a==='aceptar'){aprobable(f);exigir(!f.diferencias.length,'Devuelva la factura para corregir las diferencias');f.estado='CONTABILIDAD';await alerta(db,row.id,'Factura aceptada por Proveeduría, pendiente de conciliación',null,'CONTABILIDAD');}else f.estado='DEVUELTA';
    }else if(['conciliar','devolver-contabilidad'].includes(a)){
      if(!contabilidad(req.session.user))throw error(403,'Solo Contabilidad');exigir(f.estado==='CONTABILIDAD','Primero debe aceptar Proveeduría');if(a==='conciliar'){aprobable(f);f.cuenta_por_pagar=true;f.aprobada_en=new Date().toISOString();}f.estado=a==='conciliar'?'CONCILIADA':'DEVUELTA_CONTABILIDAD';
    }else throw error(404,'Acción inválida');
    if(a.startsWith('devolver')){exigir(String(req.body.motivo||'').trim(),'Indique el motivo');f.motivo=String(req.body.motivo).slice(0,1000);await alerta(db,row.id,`Factura devuelta: ${f.motivo}`);}
    await guardar(db,row,req.session.user.id,a);
  });res.json({ok:true});
}));
router.post('/ordenes/:id/pagos',wrap(async(req,res)=>{
  if(!contabilidad(req.session.user))throw error(403,'Solo Contabilidad puede registrar pagos');
  await transaccion(async db=>{
    const row=await documento(db,req.params.id,'oc',true);exigir(row.datos.factura?.estado==='CONCILIADA','Factura pendiente de conciliación');
    aprobable(row.datos.factura);
    const p={referencia:String(req.body.referencia||'').trim(),monto:numero(req.body.monto,'Monto',0.01),fecha:String(req.body.fecha||''),archivo:await guardarAdjunto(db,adjunto(req.body.archivo))};
    exigir(p.referencia && /^\d{4}-\d{2}-\d{2}$/.test(p.fecha)&&Number.isFinite(Date.parse(p.fecha)),'Referencia y fecha requeridas');
    exigir(p.monto<=saldo(row.datos).saldo,'El pago supera el saldo pendiente');
    exigir(!row.datos.pagos.some(x=>x.referencia===p.referencia),'Comprobante ya registrado');row.datos.pagos.push(p);await guardar(db,row,req.session.user.id,'Pago registrado');await alerta(db,row.id,'Contabilidad registró un comprobante de pago');
  });res.json({ok:true});
}));
router.get('/adjunto/:id/:tipo/:indice?',wrap(async(req,res)=>{
  const row=await documento(pool,req.params.id,'oc');visible(req,row);await enviarAdjunto(res,row,req.params.tipo,req.params.indice);
}));
router.get('/estados/:id/archivo',wrap(async(req,res)=>{
  if(!gestion(req.session.user)&&!contabilidad(req.session.user))throw error(403,'No autorizado');
  const row=await documento(pool,req.params.id,'estado');
  const a=row.datos.archivo;const [files]=await pool.query('SELECT contenido FROM prov_adjuntos WHERE id=?',[a.id]);
  if(!files[0])throw error(404,'Archivo no encontrado');res.set('X-Content-Type-Options','nosniff');res.attachment(a.nombre);res.type(a.mime).send(files[0].contenido);
}));
router.get('/portal/:token/adjunto/:tipo/:indice?',wrap(async(req,res)=>{await enviarAdjunto(res,req.portal,req.params.tipo,req.params.indice);}));
async function enviarAdjunto(res,row,tipo,indice){
  const a=tipo==='xml'?row.datos.factura?.electronica?.archivo:tipo==='factura'?row.datos.factura?.archivo:tipo==='cotizacion'?row.datos.cotizacion_archivo:tipo==='estado-cuenta'?row.datos.estado_cuenta?.archivo:tipo==='pago'?row.datos.pagos[Number(indice)]?.archivo:null;
  if(!a)throw error(404,'Archivo no encontrado');
  const [files]=await pool.query('SELECT contenido FROM prov_adjuntos WHERE id=?',[a.id]);
  if(!files[0])throw error(404,'Archivo no encontrado');
  res.set('X-Content-Type-Options','nosniff');res.attachment(a.nombre);res.type(a.mime).send(files[0].contenido);
}
router.get('/ordenes/:id',wrap(async(req,res)=>{
  const row=await documento(pool,req.params.id,'oc');visible(req,row);
  res.render('proveeduria/modulo',{user:req.session.user,row,modulo:'detalle',titulo:`Orden de compra PR-${row.id}`,facturasPortal:await facturasDeOrden(pool,'PROVEEDURIA',row.id),puedeGestion:gestion(req.session.user),puedeContabilidad:contabilidad(req.session.user),saldo,alertas:[]});
}));
router.use((e,req,res,next)=>{console.error('Proveeduría:',e.code||e.message);res.status(e.status||500).json({error:e.status?e.message:'No se pudo completar la operación. Verifique la migración de Proveeduría y vuelva a intentar.'});});
module.exports=router;
