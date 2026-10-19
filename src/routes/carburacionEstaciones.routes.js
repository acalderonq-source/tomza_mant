const express=require('express');const pool=require('../db');
const {fechaActualCostaRica}=require('../utils/fechaCostaRica');
const {fallo}=require('../utils/carburacionFinanzas');
const {guardarRegistro}=require('../utils/carburacionEstacionesStore');
const {CATEGORIAS,ESTADOS,PRIORIDADES,categoriaPorKey,parseJSON,mantenimientoEstado,sumarDias}=require('../utils/carburacionEstaciones');
const router=express.Router();
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const FROM='FROM carburacion_estaciones_registros r LEFT JOIN carburacion_clientes c ON c.id=r.cliente_id';
const PROVEEDORES=`(SELECT GROUP_CONCAT(p.nombre ORDER BY p.nombre SEPARATOR ', ') FROM carburacion_estaciones_proveedores rp
  JOIN carburacion_proveedores p ON p.id=rp.proveedor_id WHERE rp.registro_id=r.id)`;
router.use((req,res,next)=>{
  res.locals.categorias=CATEGORIAS;res.locals.estados=ESTADOS;res.locals.prioridades=PRIORIDADES;
  res.locals.hoy=fechaActualCostaRica();res.locals.success=req.session.success || null;delete req.session.success;
  res.locals.etiqueta=value=>({SIN_DEFINIR:'Sin definir',PENDIENTE:'Pendiente',EN_PROCESO:'En proceso',EN_ESPERA:'En espera',FINALIZADO:'Finalizado',ALTA:'Alta',MEDIA:'Media',BAJA:'Baja',VENCIDO:'Vencido',HOY:'Hoy',PROXIMO:'Próximo (30 días)',PROGRAMADO:'Programado',SIN_FECHA:'Sin fecha'})[value] || value;
  res.locals.mantenimientoEstado=campos=>mantenimientoEstado(campos,res.locals.hoy);
  next();
});
router.param('id',(req,res,next,id)=>{if(!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))return res.sendStatus(404);next();});
router.get('/',wrap(async(req,res)=>{
  const categoria=categoriaPorKey(req.query.categoria)?req.query.categoria:'seguimiento';
  const estado=ESTADOS.includes(req.query.estado)?req.query.estado:'';
  const prioridad=PRIORIDADES.includes(req.query.prioridad)?req.query.prioridad:'';
  const buscar=String(req.query.buscar || '').trim().slice(0,150);
  const ejecutivo=String(req.query.ejecutivo || '').trim().slice(0,120);
  const vinculo=req.query.vinculo==='pendiente'?'pendiente':'';
  const proveedor_id=/^[1-9]\d*$/.test(String(req.query.proveedor_id || ''))?req.query.proveedor_id:'';
  const mantenimiento=categoria==='mantenimientos' && ['vencidos','proximos','sinfecha'].includes(req.query.mantenimiento)?req.query.mantenimiento:'';
  const conditions=['r.categoria=?'],params=[categoria];
  if(estado){conditions.push('r.estado=?');params.push(estado);}
  if(prioridad){conditions.push('r.prioridad=?');params.push(prioridad);}
  if(buscar){conditions.push('(r.estacion LIKE ? OR c.nombre LIKE ? OR r.detalle LIKE ?)');params.push(...Array(3).fill(`%${buscar}%`));}
  if(ejecutivo){conditions.push('r.ejecutivo LIKE ?');params.push(`%${ejecutivo}%`);}
  if(vinculo)conditions.push('r.cliente_id IS NULL');
  if(proveedor_id){conditions.push('EXISTS (SELECT 1 FROM carburacion_estaciones_proveedores rp WHERE rp.registro_id=r.id AND rp.proveedor_id=?)');params.push(proveedor_id);}
  const proximo="NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.campos_json,'$.proximo_mantenimiento')),''),'null')";
  if(mantenimiento==='vencidos'){conditions.push(`${proximo}<?`);params.push(res.locals.hoy);}
  if(mantenimiento==='proximos'){conditions.push(`${proximo} BETWEEN ? AND ?`);params.push(res.locals.hoy,sumarDias(res.locals.hoy,30));}
  if(mantenimiento==='sinfecha')conditions.push(`${proximo} IS NULL`);
  const where=` WHERE ${conditions.join(' AND ')}`;
  const [[count]]=await pool.query(`SELECT COUNT(*) total ${FROM}${where}`,params);
  const total=Number(count?.total || 0),totalPaginas=Math.max(1,Math.ceil(total/50));
  const pagina=Math.min(totalPaginas,Math.max(1,parseInt(req.query.pagina,10)||1));
  const order=categoria==='mantenimientos'?`COALESCE(${proximo},'9999-12-31'),r.estacion,r.id`:
    "(r.estado='FINALIZADO'),FIELD(r.prioridad,'ALTA','MEDIA','BAJA','SIN_DEFINIR'),r.actualizado_en DESC,r.id DESC";
  const [registros]=await pool.query(`SELECT r.*,c.nombre cliente_nombre,${PROVEEDORES} proveedores ${FROM}${where} ORDER BY ${order} LIMIT 50 OFFSET ?`,[...params,(pagina-1)*50]);
  const [resumen]=await pool.query('SELECT categoria,COUNT(*) total,SUM(estado<>\'FINALIZADO\') abiertos,SUM(cliente_id IS NULL) sin_vincular FROM carburacion_estaciones_registros GROUP BY categoria');
  const [proveedores]=await pool.query('SELECT id,nombre FROM carburacion_proveedores ORDER BY nombre');
  res.render('carburacion/estaciones_listado',{config:categoriaPorKey(categoria),registros:registros.map(r=>({...r,campos:parseJSON(r.campos_json)})),resumen,proveedores,
    filtros:{categoria,estado,prioridad,buscar,ejecutivo,vinculo,proveedor_id,mantenimiento},paginacion:{pagina,total,totalPaginas}});
}));
async function formulario(req,res,registro=null) {
  const categoria=registro?.categoria || req.query.categoria || 'seguimiento';const config=categoriaPorKey(categoria);
  if(!config)throw fallo('Área no encontrada.',404);
  const [clientes]=await pool.query('SELECT id,nombre FROM carburacion_clientes ORDER BY nombre');
  const [proveedores]=await pool.query('SELECT id,nombre FROM carburacion_proveedores ORDER BY nombre');
  const [links]=registro?await pool.query('SELECT proveedor_id FROM carburacion_estaciones_proveedores WHERE registro_id=?',[registro.id]):[[]];
  res.render('carburacion/estaciones_form',{registro:registro?{...registro,campos:parseJSON(registro.campos_json)}:null,config,clientes,proveedores,proveedorIds:links.map(p=>p.proveedor_id)});
}
router.get('/nuevo',wrap((req,res)=>formulario(req,res)));
router.post('/',wrap(async(req,res)=>{
  const id=await guardarRegistro(null,req.body,req.session.user);req.session.success='Registro de estación creado.';res.redirect(`/carburacion/estaciones/${id}`);
}));
router.get('/:id/editar',wrap(async(req,res)=>{
  const [[registro]]=await pool.query('SELECT * FROM carburacion_estaciones_registros WHERE id=?',[req.params.id]);
  if(!registro || !categoriaPorKey(registro.categoria))throw fallo('Registro de estación no encontrado.',404);await formulario(req,res,registro);
}));
router.post('/:id/editar',wrap(async(req,res)=>{
  const id=await guardarRegistro(req.params.id,req.body,req.session.user);req.session.success='Avance guardado en el historial.';res.redirect(`/carburacion/estaciones/${id}`);
}));
router.get('/:id',wrap(async(req,res)=>{
  const [[registro]]=await pool.query(`SELECT r.*,c.nombre cliente_nombre,${PROVEEDORES} proveedores ${FROM} WHERE r.id=?`,[req.params.id]);
  if(!registro || !categoriaPorKey(registro.categoria))throw fallo('Registro de estación no encontrado.',404);
  const [historial]=await pool.query('SELECT id,accion,antes_json,despues_json,observacion,usuario_id,usuario_nombre,creado_en FROM carburacion_estaciones_historial WHERE registro_id=? ORDER BY id DESC',[registro.id]);
  res.render('carburacion/estaciones_detalle',{registro:{...registro,campos:parseJSON(registro.campos_json),origen:parseJSON(registro.origen_json)},config:categoriaPorKey(registro.categoria),historial:historial.map(h=>({...h,despues:parseJSON(h.despues_json)}))});
}));
router.use((error,req,res,next)=>{if(!error.status)return next(error);res.status(error.status).render('carburacion/estaciones_error',{mensaje:error.message});});
module.exports=router;
