const express = require('express');
const { fechaActualCostaRica } = require('../utils/fechaCostaRica');
const { guardarCorreoIngreso, perfilAvisosIngreso } = require('../utils/ingresosSesion');
const { requireAdministracion } = require('../middleware/requireAdministracion');
function filtrosIngreso(query = {}) {
  const hoy = new Date();
  const desde = String(query.desde || fechaActualCostaRica(new Date(hoy.getTime()-30*86400000)));
  const hasta = String(query.hasta || fechaActualCostaRica(hoy));
  for (const fecha of [desde,hasta]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Number.isFinite(Date.parse(fecha+'T12:00:00Z')) || new Date(fecha+'T12:00:00Z').toISOString().slice(0,10)!==fecha) throw Object.assign(Error('Fechas invalidas.'),{status:400});
  }
  if (desde>hasta || (Date.parse(hasta)-Date.parse(desde))/86400000>366) throw Object.assign(Error('Seleccione un periodo de hasta un año.'),{status:400});
  return { desde,hasta,buscar:String(query.buscar || '').trim().slice(0,100) };
}
function crearRouter(db) {
  const router = express.Router();
  const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
  router.use(requireAdministracion(db));
  router.get('/',wrap(async(req,res)=>{
    const filtros=filtrosIngreso(req.query);
    const [ingresos]=await db.query(`SELECT id,nombre,usuario,rol,departamento,sede,ip,dispositivo,correo_destino,correo_estado,intentos,error_codigo,creado_en,enviado_en
      FROM sesion_ingresos WHERE creado_en>=? AND creado_en<DATE_ADD(?,INTERVAL 1 DAY)
      AND (nombre LIKE ? OR usuario LIKE ?) ORDER BY creado_en DESC,id DESC LIMIT 200`,[filtros.desde,filtros.hasta,'%'+filtros.buscar+'%','%'+filtros.buscar+'%']);
    const mail=require('../utils/mail'),perfil=perfilAvisosIngreso(mail);
    const mensaje=req.session.ingresoMensaje || '';delete req.session.ingresoMensaje;
    res.render('trabajadores/ingresos',{ingresos,filtros,correoConfigurado:Boolean(perfil),remitente:perfil?mail.obtenerRemitente(perfil):'',mensaje});
  }));
  router.post('/:id/reintentar',wrap(async(req,res)=>{
    if (!/^[1-9]\d{0,14}$/.test(req.params.id)) throw Object.assign(Error('Ingreso invalido.'),{status:400});
    const [resultado]=await db.query(`UPDATE sesion_ingresos s JOIN ingreso_correos c ON c.identidad=s.identidad
      SET s.correo_destino=c.correo,s.correo_estado='PENDIENTE',s.intentos=0,s.ultimo_intento=NULL,s.error_codigo=NULL
      WHERE s.id=? AND s.correo_estado IN ('ERROR','SIN_CORREO')`,[req.params.id]);
    req.session.ingresoMensaje=resultado.affectedRows?'Aviso puesto en cola. Se enviara al correo verificado del trabajador.':'No se reenvio: el aviso ya fue enviado, esta en proceso o falta registrar el correo.';
    res.redirect(303,'/admin/ingresos');
  }));
  router.get('/correos',wrap(async(req,res)=>{
    const buscar=String(req.query.buscar || '').trim().slice(0,100);
    const [trabajadores]=await db.query(`SELECT personas.identidad,personas.nombre,c.correo FROM (
      SELECT CONCAT('C:',cedula) AS identidad,MAX(persona_nombre) AS nombre FROM usuario_cedulas GROUP BY cedula
      UNION ALL
      SELECT CONCAT('U:',u.id),COALESCE(u.nombre,u.usuario) FROM usuarios u
      WHERE NOT EXISTS(SELECT 1 FROM usuario_cedulas uc WHERE uc.usuario_id=u.id)
    ) personas LEFT JOIN ingreso_correos c ON c.identidad=personas.identidad
    WHERE personas.nombre LIKE ? OR personas.identidad LIKE ? OR c.correo LIKE ? ORDER BY personas.nombre LIMIT 200`,['%'+buscar+'%','%'+buscar+'%','%'+buscar+'%']);
    const mensaje=req.session.correoIngresoMensaje || '';delete req.session.correoIngresoMensaje;
    res.render('trabajadores/correos_ingreso',{trabajadores,mensaje,buscar});
  }));
  router.post('/correos',wrap(async(req,res)=>{
    const identidad=String(req.body.identidad || '');
    if (!/^(C:\d{9,12}|U:[1-9]\d{0,10})$/.test(identidad)) throw Object.assign(Error('Trabajador invalido.'),{status:400});
    const [personas]=identidad.startsWith('C:')
      ? await db.query('SELECT persona_nombre FROM usuario_cedulas WHERE cedula=? LIMIT 1',[identidad.slice(2)])
      : await db.query('SELECT id FROM usuarios WHERE id=? AND NOT EXISTS(SELECT 1 FROM usuario_cedulas uc WHERE uc.usuario_id=usuarios.id)',[identidad.slice(2)]);
    if (!personas.length) throw Object.assign(Error('El acceso no existe.'),{status:404});
    await guardarCorreoIngreso(db,identidad,req.body.correo,req.session.user.id);
    req.session.correoIngresoMensaje='Correo guardado. Se utilizara para los siguientes inicios de sesion.';
    res.redirect(303,'/admin/ingresos/correos');
  }));
  router.use((error,_req,res,_next)=>{
    if (!error.status) console.error('Registro de ingresos:',error.code || 'ERROR');
    res.status(error.status || 503).render('trabajadores/error_solicitud',{mensaje:error.status?error.message:'No se pudo consultar o guardar el registro. Intente nuevamente.'});
  });
  return router;
}
module.exports={crearRouter,filtrosIngreso};
