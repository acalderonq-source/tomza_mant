const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const { esPropietarioAdministracion } = require('../utils/administracionPrivada');
const { claveProveedor } = require('../utils/proveeduriaProveedores');

function invalid(message) { const e = new Error(message); e.status = 400; throw e; }
function validarSolicitud(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Datos de solicitud inválidos.');
  const datos = {};
  for (const [key, max] of Object.entries({ razon_social:255, contacto:120, telefono:30, direccion:500 })) {
    const value = String(body[key] || '').trim();
    if (value.length < 3 || value.length > max || /[\x00-\x1f\x7f]/.test(value)) invalid('Revise la razón social, contacto, teléfono y dirección.');
    datos[key] = value;
  }
  if (!claveProveedor(datos.razon_social)) invalid('Ingrese una razón social válida.');
  datos.cedula = String(body.cedula || '').trim().replace(/[ -]/g, '');
  datos.email = String(body.email || '').trim().toLowerCase();
  if (!/^\d{9,12}$/.test(datos.cedula)) invalid('Ingrese una cédula fiscal de 9 a 12 dígitos.');
  if (datos.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email)) invalid('Ingrese un correo válido.');
  if (!/^[+\d ()-]{8,30}$/.test(datos.telefono)) invalid('Ingrese un teléfono válido.');
  return datos;
}

function createRouters(db, owner = esPropietarioAdministracion) {
  const publico = express.Router(), privado = express.Router();
  const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
  const limite = rateLimit({windowMs:3600000,limit:5,standardHeaders:true,legacyHeaders:false,message:'Límite de solicitudes alcanzado. Intente más tarde.'});
  publico.get('/', (_req,res) => res.render('portal_proveedores/solicitar_acceso',{error:null,datos:{},enviado:false}));
  publico.post('/', limite, wrap(async (req,res) => {
    let datos;
    try { datos = validarSolicitud(req.body); }
    catch(e) { return res.status(400).render('portal_proveedores/solicitar_acceso',{error:e.message,datos:req.body,enviado:false}); }
    // Do not disclose account existence, replace an existing request, or create credentials here.
    if (!req.body.sitio_web) await db.query(`INSERT IGNORE INTO prov_portal_solicitudes
      (cedula,razon_social,email,contacto,telefono,direccion) VALUES (?,?,?,?,?,?)`,
      [datos.cedula,datos.razon_social,datos.email,datos.contacto,datos.telefono,datos.direccion]);
    res.status(202).render('portal_proveedores/solicitar_acceso',{error:null,datos:{},enviado:true});
  }));
  privado.use(wrap(async(req,res,next) => {
    res.set('Cache-Control','private, no-store');
    if (!req.session?.user) return res.status(401).send('Inicie sesión en Administración.');
    if (!await owner(req.session.user,db)) return res.sendStatus(403);
    next();
  }));
  privado.get('/',wrap(async(_req,res) => {
    const [solicitudes] = await db.query('SELECT * FROM prov_portal_solicitudes ORDER BY estado=\'PENDIENTE\' DESC,creado_en DESC LIMIT 500');
    const [proveedores] = await db.query('SELECT id,nombre FROM prov_proveedores WHERE activo=1 ORDER BY nombre');
    res.render('portal_proveedores/solicitudes_acceso',{solicitudes,proveedores});
  }));
  privado.post('/:id',wrap(async(req,res) => {
    if (!/^\d+$/.test(req.params.id)) invalid('Solicitud inválida.');
    const aprobar = req.body.accion === 'aprobar';
    if (!aprobar && req.body.accion !== 'rechazar') invalid('Acción inválida.');
    let hash, dias;
    if (aprobar) {
      const password = String(req.body.password || '');
      dias = Number(req.body.plazo_dias);
      if (password.length < 12 || password.length > 128) invalid('Use una contraseña de 12 a 128 caracteres.');
      if (!Number.isInteger(dias) || dias < 0 || dias > 3650) invalid('Plazo de crédito inválido.');
      hash = await bcrypt.hash(password,12);
    }
    const motivo = String(req.body.motivo || '').trim();
    if (motivo.length > 500 || (!aprobar && motivo.length < 5)) invalid('Indique un motivo de 5 a 500 caracteres.');
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query('SELECT * FROM prov_portal_solicitudes WHERE id=? FOR UPDATE',[req.params.id]);
      const solicitud = rows[0];
      if (!solicitud || solicitud.estado !== 'PENDIENTE') invalid('La solicitud no está pendiente.');
      let cuentaId = null;
      if (aprobar) {
        const [existentes] = await connection.query('SELECT id FROM prov_portal_cuentas WHERE email=? OR cedula=?',[solicitud.email,solicitud.cedula]);
        if (existentes.length) invalid('Ya existe un acceso con ese correo o cédula. Revíselo en Cuentas de proveedores.');
        let proveedorId;
        if (req.body.proveedor_id === 'nuevo') {
          const clave = claveProveedor(solicitud.razon_social);
          await connection.query('INSERT IGNORE INTO prov_proveedores (nombre,clave) VALUES (?,?)',[solicitud.razon_social,clave]);
          const [proveedores] = await connection.query('SELECT id FROM prov_proveedores WHERE clave=? AND activo=1',[clave]);
          if (!proveedores.length) invalid('El proveedor está deshabilitado. Revise el catálogo.');
          proveedorId = proveedores[0].id;
        } else {
          const [proveedores] = await connection.query('SELECT id FROM prov_proveedores WHERE id=? AND activo=1',[req.body.proveedor_id]);
          if (!proveedores.length) invalid('Seleccione un proveedor válido.');
          proveedorId = proveedores[0].id;
        }
        const [creada] = await connection.query('INSERT INTO prov_portal_cuentas (proveedor_id,email,cedula,password_hash,plazo_dias) VALUES (?,?,?,?,?)',[proveedorId,solicitud.email,solicitud.cedula,hash,dias]);
        cuentaId = creada.insertId;
      }
      await connection.query('UPDATE prov_portal_solicitudes SET estado=?,cuenta_id=?,revisado_por=?,motivo=?,revisado_en=CURRENT_TIMESTAMP WHERE id=?',[aprobar?'APROBADA':'RECHAZADA',cuentaId,req.session.user.id,motivo||null,solicitud.id]);
      await connection.commit();
      res.json({ok:true});
    } catch(e) { await connection.rollback(); if(e.code==='ER_DUP_ENTRY') invalid('El proveedor, correo o cédula ya tiene acceso.'); throw e; }
    finally { connection.release(); }
  }));
  const errores = (e,_req,res,_next) => {
    if (!e.status) console.error('Solicitud de acceso:',e.code||'ERROR');
    res.status(e.status||503).json({error:e.status?e.message:'No se pudo procesar la solicitud. Intente nuevamente.'});
  };
  publico.use(errores); privado.use(errores);
  return {publico,privado};
}
module.exports = {createRouters,validarSolicitud};
