const { isIP } = require('node:net');
function correoIngreso(value, requerido = false) {
  const correo = String(value || '').trim().toLowerCase();
  if (!correo && !requerido) return null;
  if (correo.length > 254 || !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(correo)) {
    throw Object.assign(new Error('Ingrese un correo electronico valido.'), { status: 400 });
  }
  return correo;
}
function identidadIngreso(user) {
  return user.cedula ? 'C:' + user.cedula : 'U:' + user.id;
}
async function guardarCorreoIngreso(db, identidad, correo, adminId) {
  correo = correoIngreso(correo, true);
  await db.query(`INSERT INTO ingreso_correos (identidad,correo,actualizado_por) VALUES (?,?,?)
    ON DUPLICATE KEY UPDATE correo=VALUES(correo),actualizado_por=VALUES(actualizado_por)`, [identidad, correo, adminId]);
}
async function registrarIngreso(db, user, req) {
  const identidad = identidadIngreso(user);
  const [contactos] = await db.query('SELECT correo FROM ingreso_correos WHERE identidad=?', [identidad]);
  let correo;
  try { correo = correoIngreso(contactos[0]?.correo); } catch (_) { correo = null; }
  const ip = isIP(req.ip || '') ? req.ip : null;
  const [insert] = await db.query(`INSERT INTO sesion_ingresos
    (identidad,usuario_id,usuario,nombre,rol,departamento,sede,ip,dispositivo,correo_destino,correo_estado)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [identidad, user.id, String(user.usuario).slice(0,120), String(user.nombre).slice(0,150),
    String(user.rol).slice(0,50), user.departamentoActivo, user.sede || null, ip,
    String(req.get('user-agent') || '').slice(0,500), correo, correo ? 'PENDIENTE' : 'SIN_CORREO']);
  return insert.insertId;
}
function escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function mensajeIngreso(ingreso) {
  const fecha = new Date(ingreso.creado_en).toLocaleString('es-CR', { timeZone:'America/Costa_Rica' });
  const filas = [['Nombre',ingreso.nombre],['Fecha y hora (Costa Rica)',fecha],['Perfil',ingreso.usuario],['Departamento',ingreso.departamento],['Sede',ingreso.sede || 'Sin sede'],['IP',ingreso.ip || 'No disponible'],['Dispositivo',ingreso.dispositivo || 'No disponible']];
  return {
    asunto: 'Nuevo inicio de sesion en Gas Tomza',
    html: `<h2>Se inicio sesion en su acceso de Gas Tomza</h2><table>${filas.map(([k,v])=>`<tr><th align="left">${escape(k)}</th><td>${escape(v)}</td></tr>`).join('')}</table><p>Si no fue usted, contacte de inmediato a administracion para revisar su acceso. No comparta su PIN.</p>`,
    text: 'Se inicio sesion en su acceso de Gas Tomza.\n' + filas.map(([k,v])=>`${k}: ${v}`).join('\n') + '\nSi no fue usted, contacte a administracion.'
  };
}
const ejecutando = new WeakSet();
function perfilAvisosIngreso(enviar = require('./mail')) {
  if (typeof enviar.estaConfigurado !== 'function') return 'seguridad';
  if (enviar.estaConfigurado('seguridad')) return 'seguridad';
  return null;
}
async function procesarAvisosIngreso(db, enviar = require('./mail'), env = process.env) {
  if (env.APP_ENV === 'staging' || env.MAIL_ENABLED === 'false' || ejecutando.has(db)) return;
  ejecutando.add(db);
  try {
    await db.query("UPDATE sesion_ingresos SET correo_estado='ERROR',error_codigo='ENVIO_INTERRUMPIDO' WHERE correo_estado='ENVIANDO' AND ultimo_intento < DATE_SUB(NOW(),INTERVAL 10 MINUTE)");
    const [rows] = await db.query(`SELECT * FROM sesion_ingresos WHERE intentos < 3 AND
      (correo_estado='PENDIENTE' OR (correo_estado='ERROR' AND ultimo_intento < DATE_SUB(NOW(),INTERVAL 5 MINUTE)))
      ORDER BY id LIMIT 10`);
    for (const row of rows) {
      const [claim] = await db.query("UPDATE sesion_ingresos SET correo_estado='ENVIANDO',intentos=intentos+1,ultimo_intento=NOW(),error_codigo=NULL WHERE id=? AND correo_estado=? AND intentos=?", [row.id,row.correo_estado,row.intentos]);
      if (!claim.affectedRows) continue;
      try {
        const mensaje = mensajeIngreso(row);
        const perfil=perfilAvisosIngreso(enviar);
        if (!perfil) throw Object.assign(Error('No hay remitente configurado para los avisos.'),{code:'REMITENTE_NO_CONFIGURADO'});
        await enviar(correoIngreso(row.correo_destino, true), mensaje.asunto, mensaje.html, { perfil, text:mensaje.text, nombreRemitente:'Seguridad Gas Tomza' });
        await db.query("UPDATE sesion_ingresos SET correo_estado='ENVIADO',enviado_en=NOW(),error_codigo=NULL WHERE id=? AND correo_estado='ENVIANDO' AND intentos=?", [row.id,row.intentos+1]);
      } catch (error) {
        const codigo = String(error.code || 'ENVIO_FALLIDO').replace(/[^A-Z0-9_]/gi,'').slice(0,80);
        await db.query("UPDATE sesion_ingresos SET correo_estado='ERROR',error_codigo=? WHERE id=? AND correo_estado='ENVIANDO' AND intentos=?", [codigo,row.id,row.intentos+1]);
      }
    }
  } finally { ejecutando.delete(db); }
}
function iniciarAvisosIngreso(db) {
  const ejecutar = () => procesarAvisosIngreso(db).catch(error => console.error('Avisos de ingreso:', error.code || 'ERROR'));
  const timer = setInterval(ejecutar,60000); timer.unref();
  return timer;
}
module.exports = { correoIngreso, identidadIngreso, guardarCorreoIngreso, registrarIngreso, mensajeIngreso, procesarAvisosIngreso, iniciarAvisosIngreso, perfilAvisosIngreso };
