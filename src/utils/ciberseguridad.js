const crypto = require('node:crypto');
const { isIP } = require('node:net');
const { fechaActualCostaRica, fechaHoraCostaRica } = require('./fechaCostaRica');
const TIPOS = { LOGIN_FALLIDO: 'Ingreso fallido', LIMITE_INTENTOS: 'Límite de intentos', ACCESO_DENEGADO: 'Acceso denegado' };
const GRAVEDADES = ['Baja', 'Media', 'Alta', 'Crítica'];
const ESTADOS = ['Pendiente', 'En investigación', 'Resuelto'];
const limpiar = (value, max) => String(value || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, max);
const salud = new WeakMap();
function estadoRegistro(db) { return salud.get(db) || { fallos: 0, descartados: 0 }; }
function clasificar(req, res, ahora = new Date()) {
  let tipo;
  if (res.statusCode === 429) tipo = 'LIMITE_INTENTOS';
  else if ([401, 403].includes(res.statusCode)) tipo = 'ACCESO_DENEGADO';
  else if (req.ciberLoginFallido && res.statusCode < 400) tipo = 'LOGIN_FALLIDO';
  if (!tipo) return null;
  const user = req.session?.user;
  const ip = isIP(req.ip || '') ? req.ip : 'No disponible';
  // Los identificadores anónimos se resumen: no conservar cédulas ni datos del formulario.
  const usuario = user ? limpiar(user.usuario, 120) : 'Sin sesión';
  const ruta = limpiar(req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : '/' + (req.path || '').split('/').filter(Boolean)[0], 180);
  const bucket = Math.floor(ahora.getTime() / 900000);
  const huella = crypto.createHash('sha256').update(JSON.stringify([bucket, tipo, ip, usuario, ruta, res.statusCode])).digest('hex');
  return { huella, tipo, gravedad: tipo === 'LIMITE_INTENTOS' ? 'Alta' : tipo === 'ACCESO_DENEGADO' ? 'Media' : 'Baja', ip, usuario,
    departamento: limpiar(user?.departamentoActivo || 'Sin sesión', 60), ruta, http: res.statusCode, fecha: fechaHoraCostaRica(ahora) };
}
async function guardarEvento(db, e) {
  await db.query(`INSERT INTO ciberseguridad_eventos
    (huella,tipo,gravedad,ip,usuario,departamento,ruta,http_estado,creado_en,ultimo_en)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE intentos=intentos+1,ultimo_en=VALUES(ultimo_en),version=version+1`,
  [e.huella, e.tipo, e.gravedad, e.ip, e.usuario, e.departamento, e.ruta, e.http, e.fecha, e.fecha]);
}
function registrarSeguridad(db, { maxPendientes = 256, avisar = () => console.warn('Ciberseguridad: no se pudo guardar un evento. Revise el estado del registro.') } = {}) {
  let cola = Promise.resolve(), pendientes = 0, ultimoAviso = 0;
  const status = { fallos: 0, descartados: 0 }; salud.set(db, status);
  const fallo = key => { status[key]++; if (Date.now() - ultimoAviso > 60000) { ultimoAviso = Date.now(); avisar(); } };
  const middleware = (req, res, next) => {
    res.once('finish', () => {
      const e = clasificar(req, res); if (!e) return;
      if (pendientes >= maxPendientes) { fallo('descartados'); return; }
      pendientes++;
      cola = cola.then(() => guardarEvento(db, e)).catch(() => fallo('fallos')).finally(() => { pendientes--; });
    });
    next();
  };
  middleware.esperar = () => cola;
  return middleware;
}
function filtros(query = {}, ahora = new Date()) {
  const dias = Number(query.dias || 30), gravedad = query.gravedad || 'Todas';
  const pagina = query.pagina === undefined ? 0 : Number(query.pagina);
  if (![7, 14, 30].includes(dias) || !['Todas', ...GRAVEDADES].includes(gravedad) || !Number.isSafeInteger(pagina) || pagina < 0 || pagina > 100000) throw Object.assign(Error('Filtro inválido.'), { status: 400 });
  const hasta = fechaActualCostaRica(ahora);
  const desde = new Date(Date.parse(hasta + 'T12:00:00Z') - (dias - 1) * 86400000).toISOString().slice(0, 10);
  return { dias, gravedad, pagina, desde, hasta };
}
function where(f) {
  return { sql: 'creado_en>=? AND creado_en<DATE_ADD(?,INTERVAL 1 DAY)' + (f.gravedad === 'Todas' ? '' : ' AND gravedad=?'),
    params: [f.desde, f.hasta, ...(f.gravedad === 'Todas' ? [] : [f.gravedad])] };
}
const seleccion = `id,tipo,gravedad,ip AS origen,usuario,departamento,ruta,http_estado,intentos,estado,version,
  CONCAT(DATE_FORMAT(creado_en,'%Y-%m-%dT%H:%i:%s'),'-06:00') AS fecha,
  CONCAT(DATE_FORMAT(ultimo_en,'%Y-%m-%dT%H:%i:%s'),'-06:00') AS ultimo`;
function normalizar(row) { return { ...row, id: String(row.id), tipo: TIPOS[row.tipo] || row.tipo, intentos: Number(row.intentos), version: Number(row.version) }; }
async function resumenReal(db, f) {
  const w = where(f);
  const [[k]] = await db.query(`SELECT COUNT(*) AS grupos,COALESCE(SUM(intentos),0) AS total,
    COALESCE(SUM(IF(http_estado IN (401,403,429),intentos,0)),0) AS bloqueados,
    COALESCE(SUM(estado<>'Resuelto'),0) AS pendientes,COALESCE(SUM(estado='Resuelto'),0) AS resueltos
    FROM ciberseguridad_eventos WHERE ${w.sql}`, w.params);
  const [dias] = await db.query(`SELECT DATE_FORMAT(creado_en,'%Y-%m-%d') AS fecha,SUM(intentos) AS detectados,
    SUM(IF(http_estado IN (401,403,429),intentos,0)) AS bloqueados FROM ciberseguridad_eventos WHERE ${w.sql} GROUP BY DATE_FORMAT(creado_en,'%Y-%m-%d')`, w.params);
  const [tipos] = await db.query(`SELECT tipo,SUM(intentos) AS total FROM ciberseguridad_eventos WHERE ${w.sql} GROUP BY tipo`, w.params);
  const [incidentes] = await db.query(`SELECT ${seleccion} FROM ciberseguridad_eventos WHERE ${w.sql} ORDER BY creado_en DESC,id DESC LIMIT 12 OFFSET ?`, [...w.params, f.pagina * 12]);
  const [[config]] = await db.query("SELECT CONCAT(DATE_FORMAT(iniciado_en,'%Y-%m-%dT%H:%i:%s'),'-06:00') AS inicio FROM ciberseguridad_config WHERE id=1");
  const tendencia = Array.from({ length: f.dias }, (_, i) => {
    const fecha = new Date(Date.parse(f.desde + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10);
    const row = dias.find(d => d.fecha === fecha);
    return { fecha, detectados: Number(row?.detectados || 0), bloqueados: Number(row?.bloqueados || 0) };
  });
  return { demo: false, periodo: { desde: f.desde, hasta: f.hasta }, pagina: f.pagina, grupos: Number(k.grupos), total: Number(k.total),
    bloqueados: Number(k.bloqueados), pendientes: Number(k.pendientes), resueltos: Number(k.resueltos), tendencia,
    tipos: Object.entries(TIPOS).map(([key, tipo]) => ({ tipo, total: Number(tipos.find(r => r.tipo === key)?.total || 0) })),
    incidentes: incidentes.map(normalizar), inicio: config?.inicio, registro: estadoRegistro(db) };
}
async function seguimiento(db, id) {
  const [rows] = await db.query(`SELECT s.id,s.estado,s.nota,u.usuario AS administrador,
    CONCAT(DATE_FORMAT(s.creado_en,'%Y-%m-%dT%H:%i:%s'),'-06:00') AS fecha
    FROM ciberseguridad_seguimiento s LEFT JOIN usuarios u ON u.id=s.administrador_id WHERE s.evento_id=? ORDER BY s.id DESC LIMIT 50`, [id]);
  return rows;
}
async function cambiarEstado(db, id, body, adminId) {
  if (!ESTADOS.includes(body.estado) || typeof body.nota !== 'string' || body.nota.trim().length < 3 || body.nota.length > 1000 || !Number.isSafeInteger(body.version) || body.version < 1) throw Object.assign(Error('Seleccione un estado y escriba una nota de 3 a 1000 caracteres.'), { status: 400 });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query('UPDATE ciberseguridad_eventos SET estado=?,version=version+1 WHERE id=? AND version=?', [body.estado, id, body.version]);
    if (!r.affectedRows) throw Object.assign(Error('El incidente cambió o ya no existe. Actualice el panel antes de guardar.'), { status: 409 });
    await conn.query('INSERT INTO ciberseguridad_seguimiento (evento_id,administrador_id,estado,nota,creado_en) VALUES (?,?,?,?,?)', [id, adminId, body.estado, limpiar(body.nota.trim(), 1000), fechaHoraCostaRica()]);
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}
function celdaCSV(value) { let s = String(value ?? ''); if (/^[\s]*[=+@-]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }
async function exportar(db, f) {
  const w = where(f);
  // Límite explícito para no cargar una bitácora ilimitada en memoria.
  const [rows] = await db.query(`SELECT ${seleccion} FROM ciberseguridad_eventos WHERE ${w.sql} ORDER BY creado_en DESC,id DESC LIMIT 10001`, w.params);
  if (rows.length > 10000) throw Object.assign(Error('La exportación supera 10000 incidentes. Reduzca el período o filtre por gravedad.'), { status: 400 });
  return '\uFEFF' + [['EVENTOS REALES DE TOMZA - No equivalen a ataques confirmados'], ['ID','Fecha Costa Rica','Tipo','IP','Usuario','Departamento','Ruta','HTTP','Intentos','Gravedad','Estado'],
    ...rows.map(normalizar).map(r => [r.id,r.fecha,r.tipo,r.origen,r.usuario,r.departamento,r.ruta,r.http_estado,r.intentos,r.gravedad,r.estado])].map(r => r.map(celdaCSV).join(';')).join('\r\n');
}
module.exports = { clasificar, guardarEvento, registrarSeguridad, estadoRegistro, filtros, resumenReal, seguimiento, cambiarEstado, exportar, celdaCSV };
