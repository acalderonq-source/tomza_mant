const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
const { normalizarCedula, cedulaValida } = require('../utils/cedula');
const { SEDES_SOLICITUD, sedeSolicitud } = require('../utils/sedesSolicitudesTrabajadores');
const { correoIngreso, guardarCorreoIngreso } = require('../utils/ingresosSesion');
const { requireAdministracion } = require('../middleware/requireAdministracion');
const {AREAS,MODULOS,validarAcceso,prepararAccesos}=require('../utils/accesosTrabajador');
const {DEPARTAMENTOS}=require('../utils/departamentos');

function fallo(mensaje, status = 400) { throw Object.assign(new Error(mensaje), { status }); }
function texto(value, max, min = 1) {
  if (typeof value !== 'string') fallo('Complete los datos de la solicitud.');
  const result = value.trim().replace(/\s+/g, ' ');
  if (result.length < min || result.length > max || /[<>\x00-\x1f\x7f]/.test(value)) fallo('Revise la longitud y el contenido de los campos.');
  return result;
}
function validarSolicitud(body, sedes) {
  if (!body || Array.isArray(body)) fallo('Solicitud invalida.');
  const raw = texto(body.cedula, 25);
  const cedula = normalizarCedula(raw);
  if (!cedulaValida(raw) || !/^\d{9,12}$/.test(cedula)) fallo('Ingrese una cedula valida de 9 a 12 digitos.');
  const nombre_completo = texto(body.nombre_completo, 150, 5);
  if (nombre_completo.split(' ').length < 2 || !/\p{L}/u.test(nombre_completo)) fallo('Ingrese su nombre completo y apellidos.');
  const puesto = texto(body.puesto, 120, 3), sede = sedeSolicitud(texto(body.sede, 100));
  if (!sedes.includes(sede)) fallo('Seleccione una sede del listado.');
  return { cedula, nombre_completo, puesto, sede, correo:correoIngreso(body.correo,true) };
}
function createRouters(db, opciones = {}) {
  const publico = express.Router(), privado = express.Router();
  const cargarSedes = opciones.cargarSedes || (async () => [...SEDES_SOLICITUD]);
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const limite = rateLimit({ windowMs: 3600000, limit: 60, standardHeaders: true, legacyHeaders: false,
    message: 'Demasiadas solicitudes. Intente nuevamente mas tarde.' });
  publico.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  publico.get('/', wrap(async (_req, res) => {
    res.render('trabajadores/solicitar_ingreso', { sedes: await cargarSedes(), datos: {}, error: null, enviado: false });
  }));
  publico.post('/', limite, wrap(async (req, res) => {
    const sedes = await cargarSedes();
    let datos;
    try { datos = validarSolicitud(req.body, sedes); }
    catch (error) {
      if (!error.status) throw error;
      const datosFormulario = Object.fromEntries(Object.entries({ cedula:25, nombre_completo:150, puesto:120, sede:100, correo:254 })
        .map(([key,max]) => [key, typeof req.body?.[key] === 'string' ? req.body[key].slice(0,max) : '']));
      return res.status(400).render('trabajadores/solicitar_ingreso', { sedes, datos: datosFormulario, error: error.message, enviado: false });
    }
    // Igual respuesta para duplicados y accesos existentes. No crear usuarios aqui.
    if (!req.body.sitio_web) await db.query(`INSERT INTO trabajador_solicitudes_acceso
      (cedula,nombre_completo,puesto,sede,correo) VALUES (?,?,?,?,?)
      ON DUPLICATE KEY UPDATE id=id`, [datos.cedula, datos.nombre_completo, datos.puesto, datos.sede, datos.correo]);
    return res.status(202).render('trabajadores/solicitar_ingreso', { sedes: [], datos: {}, error: null, enviado: true });
  }));
  privado.use(requireAdministracion(db,opciones.comprobarPropietario));
  privado.get('/', wrap(async (req, res) => {
    const estado = ['PENDIENTE','APROBADA','RECHAZADA'].includes(req.query.estado) ? req.query.estado : 'PENDIENTE';
    const [solicitudes] = await db.query('SELECT id,cedula,nombre_completo,puesto,sede,correo,estado,codigo_trabajador,motivo,creado_en,revisado_en FROM trabajador_solicitudes_acceso WHERE estado=? ORDER BY creado_en DESC,id DESC LIMIT 200', [estado]);
    const mensaje = req.session.solicitudTrabajadorMensaje || '';
    delete req.session.solicitudTrabajadorMensaje;
    res.render('trabajadores/solicitudes_ingreso', { solicitudes: solicitudes.map(s => ({ ...s, sede: sedeSolicitud(s.sede) || s.sede })), departamentos:DEPARTAMENTOS.filter(d=>AREAS[d.key]),modulos:MODULOS,sedesAsignables:SEDES_SOLICITUD, estado, mensaje });
  }));
  privado.post('/:id', wrap(async (req, res) => {
    if (!/^[1-9]\d{0,14}$/.test(req.params.id)) fallo('Solicitud invalida.');
    const aprobar = req.body.accion === 'aprobar';
    if (!aprobar && req.body.accion !== 'rechazar') fallo('Accion invalida.');
    const motivo = typeof req.body.motivo === 'string' ? req.body.motivo.trim() : '';
    if (motivo.length > 500 || (!aprobar && motivo.length < 5)) fallo('Indique un motivo de 5 a 500 caracteres.');
    let codigo, ids, hash,acceso;
    if (aprobar) {
      if (req.body.identidad_verificada !== '1') fallo('Confirme que verifico la identidad y el puesto del trabajador.');
      codigo = String(req.body.codigo_trabajador || '').trim();
      if (!/^\d{1,30}$/.test(codigo)) fallo('Ingrese el codigo de trabajador.');
      if(req.body.usuario_ids!==undefined)fallo('Use departamento y permisos; ya no se asignan perfiles de otras personas.');
      acceso=validarAcceso(req.body);
      await prepararAccesos(db);
      hash = await bcrypt.hash(codigo, 12);
    }
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query('SELECT * FROM trabajador_solicitudes_acceso WHERE id=? FOR UPDATE', [req.params.id]);
      const solicitud = rows[0];
      if (!solicitud || solicitud.estado !== 'PENDIENTE') fallo('Esta solicitud ya fue revisada o no existe.', 409);
      if (aprobar) {
        const [existentes] = await connection.query('SELECT cedula FROM usuario_cedulas WHERE cedula=? OR codigo_trabajador=? FOR UPDATE', [solicitud.cedula, codigo]);
        const [legacy] = await connection.query('SELECT id FROM usuarios WHERE cedula=? FOR UPDATE', [solicitud.cedula]);
        if (existentes.length || legacy.length) fallo('La cedula o el codigo ya tiene acceso. Revise Accesos y carnets; no se reemplazo ningun acceso.', 409);
        const [nuevo]=await connection.query('INSERT INTO usuarios (nombre,usuario,password,rol,sede,requiere_cambio_password) VALUES (?,?,?,?,?,0)',
          [solicitud.nombre_completo.slice(0,100),'acceso_'+solicitud.cedula,await bcrypt.hash(crypto.randomBytes(32).toString('hex'),12),AREAS[acceso.departamento],acceso.sede]);
        ids=[nuevo.insertId];
        await connection.query('INSERT INTO usuario_departamentos (usuario_id,departamento,es_principal) VALUES (?,?,1)',[nuevo.insertId,acceso.departamento]);
        await connection.query('INSERT INTO usuario_accesos_personales (usuario_id,config_json,asignado_por) VALUES (?,?,?)',[nuevo.insertId,JSON.stringify(acceso),req.session.user.id]);
        for (const id of ids) await connection.query(`INSERT INTO usuario_cedulas
          (cedula,usuario_id,persona_nombre,codigo_trabajador,pin_hash,perfil_excel,requiere_cambio_pin)
          VALUES (?,?,?,?,?,?,1)`, [solicitud.cedula, id, solicitud.nombre_completo, codigo, hash, solicitud.puesto.slice(0, 80)]);
        const [carnets] = await connection.query('SELECT cedula FROM carnets_trabajador WHERE cedula=? FOR UPDATE', [solicitud.cedula]);
        if (!carnets.length) await connection.query('INSERT INTO carnets_trabajador (cedula,qr_token) VALUES (?,?)', [solicitud.cedula, crypto.randomBytes(32).toString('hex')]);
        const correo=correoIngreso(req.body.correo !== undefined ? req.body.correo : solicitud.correo);
        if (correo) await guardarCorreoIngreso(connection,'C:'+solicitud.cedula,correo,req.session.user.id);
      }
      await connection.query('UPDATE trabajador_solicitudes_acceso SET estado=?,codigo_trabajador=?,perfiles_json=?,revisado_por=?,motivo=?,revisado_en=CURRENT_TIMESTAMP WHERE id=?',
        [aprobar ? 'APROBADA' : 'RECHAZADA', codigo || null, ids ? JSON.stringify(ids) : null, req.session.user.id, motivo || null, solicitud.id]);
      await connection.commit();
      req.session.solicitudTrabajadorMensaje = aprobar ? 'Solicitud aprobada. Acceso y carnet creados. Informe al trabajador su codigo por un canal verificado.' : 'Solicitud rechazada. No se creo ningun acceso.';
      return res.redirect(303, '/admin/solicitudes-trabajadores');
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') fallo('El acceso ya fue registrado. Revise los carnets antes de continuar.', 409);
      throw error;
    } finally { connection.release(); }
  }));
  const errores = (error, _req, res, _next) => {
    if (!error.status) console.error('Solicitud de trabajador:', error.code || 'ERROR');
    res.status(error.status || 503).render('trabajadores/error_solicitud', { mensaje: error.status ? error.message : 'No se pudo procesar la solicitud. Intente nuevamente en unos momentos.' });
  };
  publico.use(errores); privado.use(errores);
  return { publico, privado };
}
module.exports = { createRouters, validarSolicitud };
