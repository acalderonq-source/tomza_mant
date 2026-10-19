const express=require('express');const pool=require('../db');
const {CAMPOS_CLIENTE,puedeEditarClientes,guardarFicha}=require('../utils/carburacionClienteFicha');
const {fallo}=require('../utils/carburacionFinanzas');
const expediente=require('../utils/carburacionExpediente');
const {fechaActualCostaRica}=require('../utils/fechaCostaRica');
const router=express.Router();const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
router.use((req,res,next)=>{
  puedeEditarClientes(req.session.user).then(permiso=>{
    res.locals.puedeEditarClientes=permiso;res.locals.camposCliente=CAMPOS_CLIENTE;
    res.locals.success=req.session.success || null;delete req.session.success;next();
  }).catch(next);
});
router.param('id',(req,res,next,id)=>{if(!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))return res.sendStatus(404);next();});
function requiereEdicion(req,res,next){if(!res.locals.puedeEditarClientes)return res.status(403).send('No tiene permiso para agregar o editar clientes de Carburación.');next();}
router.get('/',wrap(async(_req,res)=>{
  const [clientes]=await pool.query('SELECT id,nombre FROM carburacion_clientes ORDER BY nombre');
  res.render('carburacion/clientes',{clientes});
}));
router.get('/nuevo',requiereEdicion,(_req,res)=>res.render('carburacion/cliente_form',{cliente:{},documentosLegales:[],error:null}));
async function guardar(req,res,next,id) {
  try {
    const clienteId=await guardarFicha(id,req.body,req.session.user);
    req.session.success=id?'Información del cliente actualizada.':'Nuevo cliente agregado a Carburación.';
    res.redirect(`/carburacion/clientes/${clienteId}`);
  }catch(error){
    if(![400,409].includes(error.status))return next(error);
    const documentosLegales=id?(await pool.query("SELECT id,tipo,nombre,representante_legal FROM carburacion_cliente_documentos WHERE cliente_id=? AND tipo IN ('CEDULA_JURIDICA','PODER') ORDER BY id DESC",[id]))[0]:[];
    const cliente=Object.fromEntries(['version',...CAMPOS_CLIENTE.map(c=>c.key)].map(k=>[k,typeof req.body[k]==='string'?req.body[k]:'']));
    res.status(error.status).render('carburacion/cliente_form',{cliente:{...cliente,...(id?{id}:{})},documentosLegales,error:error.message+' Si seleccionó archivos, selecciónelos de nuevo antes de guardar.'});
  }
}
router.post('/',requiereEdicion,(req,res,next)=>guardar(req,res,next,null).catch(next));
router.get('/:id/editar',requiereEdicion,wrap(async(req,res)=>{
  const [[cliente]]=await pool.query('SELECT * FROM carburacion_clientes WHERE id=?',[req.params.id]);
  if(!cliente)throw fallo('Cliente no encontrado.',404);
  const [documentosLegales]=await pool.query("SELECT id,tipo,nombre,representante_legal FROM carburacion_cliente_documentos WHERE cliente_id=? AND tipo IN ('CEDULA_JURIDICA','PODER') ORDER BY id DESC",[cliente.id]);
  res.render('carburacion/cliente_form',{cliente,documentosLegales,error:null});
}));
router.post('/:id/editar',requiereEdicion,(req,res,next)=>guardar(req,res,next,req.params.id).catch(next));
router.post('/:id/documentos',requiereEdicion,wrap(async(req,res)=>{
 await expediente.guardarDocumento(req.params.id,req.body,req.session.user);req.session.success='Archivo agregado al expediente.';res.redirect(`/carburacion/clientes/${req.params.id}#expediente`);
}));
router.post('/:id/incidencias',requiereEdicion,wrap(async(req,res)=>{
 await expediente.guardarIncidencia(req.params.id,req.body,req.session.user);req.session.success='Incidencia registrada.';res.redirect(`/carburacion/clientes/${req.params.id}#incidencias`);
}));
router.post('/:id/incidencias/:incidenciaId/estado',requiereEdicion,wrap(async(req,res)=>{
 if(!/^[1-9]\d*$/.test(req.params.incidenciaId) || !Number.isSafeInteger(Number(req.params.incidenciaId)))return res.sendStatus(404);
 await expediente.guardarIncidencia(req.params.id,req.body,req.session.user,req.params.incidenciaId);req.session.success='Estado de la incidencia actualizado.';res.redirect(`/carburacion/clientes/${req.params.id}#incidencias`);
}));
router.get('/:id/documentos/:documentoId',wrap(async(req,res)=>{
 if(!/^[1-9]\d*$/.test(req.params.documentoId) || !Number.isSafeInteger(Number(req.params.documentoId)))return res.sendStatus(404);
 const [[documento]]=await pool.query('SELECT nombre,mime,archivo FROM carburacion_cliente_documentos WHERE id=? AND cliente_id=?',[req.params.documentoId,req.params.id]);if(!documento)throw fallo('Archivo no encontrado.',404);
 res.set('Cache-Control','private, no-store').set('X-Content-Type-Options','nosniff').type(documento.mime);
 if(req.query.vista==='1' && documento.mime.startsWith('image/'))res.set('Content-Disposition','inline');else res.attachment(documento.nombre);
 res.send(documento.archivo);
}));
router.get('/:id',wrap(async(req,res)=>{
  const [[cliente]]=await pool.query('SELECT * FROM carburacion_clientes WHERE id=?',[req.params.id]);
  if(!cliente)throw fallo('Cliente no encontrado.',404);
  const [incidencias]=await pool.query('SELECT id,titulo,descripcion,fecha,estado,version,creado_nombre,creado_en,actualizado_en FROM carburacion_cliente_incidencias WHERE cliente_id=? ORDER BY fecha DESC,id DESC',[cliente.id]);
  const [documentos]=await pool.query('SELECT id,tipo,nombre,mime,tamanio,representante_legal,creado_nombre,creado_en FROM carburacion_cliente_documentos WHERE cliente_id=? ORDER BY id DESC',[cliente.id]);
  res.render('carburacion/cliente_ficha',{cliente,incidencias,documentos,tiposDocumento:expediente.TIPOS_DOCUMENTO,estadosIncidencia:expediente.ESTADOS_INCIDENCIA,hoy:fechaActualCostaRica()});
}));
router.use((error,req,res,next)=>{
  if(!error.status)return next(error);
  res.status(error.status).render('carburacion/cliente_error',{mensaje:error.message});
});
module.exports=router;
