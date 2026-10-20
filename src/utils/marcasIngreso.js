const crypto = require('node:crypto');
const MAX_FOTO = 1024 * 1024;
const RETO_MS = 120000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const error = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status });
async function permisosMarcas(db, user) {
  if (user?.rol === 'ADMIN' && !user.requiereCambioPassword && ['TALLER','ADMINISTRACION'].includes(user.departamentoActivo)) return { marcar: false, consultar: true };
  if (!user || user.departamentoActivo !== 'TALLER' || user.requiereCambioPassword) return { marcar: false, consultar: false };
  const [[row]] = await db.query('SELECT puede_marcar,puede_consultar FROM taller_marcas_accesos WHERE usuario_id=?', [user.id]);
  return { marcar: Number(row?.puede_marcar) === 1, consultar: Number(row?.puede_consultar) === 1 };
}
function siguienteTipo(ultimo) { return ultimo?.tipo === 'ENTRADA' ? 'SALIDA' : 'ENTRADA'; }
function nuevoReto(usuarioId, tipo, now = Date.now()) {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, guardado: { hash: hash(token), usuarioId, tipo, expira: now + RETO_MS } };
}
function verificarReto(reto, token, usuarioId, tipo, now = Date.now()) {
  if (!reto || !/^[a-f0-9]{64}$/.test(String(token)) || reto.usuarioId !== usuarioId || reto.tipo !== tipo ||
      reto.expira <= now || reto.expira > now + RETO_MS || reto.hash !== hash(token)) {
    throw error('La captura vencio o no es valida. Abra la camara y tome una foto nueva.', 409);
  }
}
function validarFoto(base64) {
  if (typeof base64 !== 'string' || base64.length > Math.ceil(MAX_FOTO / 3) * 4 || base64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw error('Foto invalida. Tome una foto con la camara.');
  const foto = Buffer.from(base64, 'base64');
  if (foto.length < 128 || foto.length > MAX_FOTO || foto.toString('base64') !== base64 || foto.readUInt16BE(0) !== 0xffd8 || foto.readUInt16BE(foto.length - 2) !== 0xffd9) throw error('La foto debe ser JPEG de hasta 1 MB.');
  let pos = 2, ancho, alto;
  while (pos + 3 < foto.length) {
    if (foto[pos++] !== 0xff) break;
    while (foto[pos] === 0xff) pos++;
    const marker = foto[pos++];
    if (marker === 0xda || marker === 0xd9 || pos + 2 > foto.length) break;
    const length = foto.readUInt16BE(pos);
    if (length < 2 || pos + length > foto.length) break;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) { alto = foto.readUInt16BE(pos + 3); ancho = foto.readUInt16BE(pos + 5); break; }
    pos += length;
  }
  if (!ancho || !alto || ancho < 64 || alto < 64 || ancho > 1600 || alto > 1600) throw error('Resolucion de foto invalida. Vuelva a tomarla desde el sistema.');
  return { foto, tamanio: foto.length, sha256: hash(foto) };
}
function filtrosHistorial(query = {}, hoy = require('./fechaCostaRica').fechaActualCostaRica()) {
  const desde = String(query.desde || hoy), hasta = String(query.hasta || hoy);
  const fechaValida = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  if (!fechaValida(desde) || !fechaValida(hasta) || desde > hasta || Date.parse(hasta) - Date.parse(desde) > 366 * 86400000) throw error('Seleccione un rango de fechas valido, de hasta un ano.');
  const pagina = Number(query.pagina || 1);
  if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 100000) throw error('Pagina invalida.');
  return { desde, hasta, pagina };
}
const CAMPOS_MARCA = "id,usuario_id,nombre,tipo,DATE_FORMAT(creado_en,'%Y-%m-%dT%H:%i:%s.%fZ') AS fecha_utc";
async function ultimaMarca(db, id) {
  const [[row]] = await db.query(`SELECT ${CAMPOS_MARCA} FROM taller_marcas WHERE usuario_id=? ORDER BY id DESC LIMIT 1`, [id]);
  return row || null;
}
async function registrarMarca(db, user, tipo, archivo, retoHash) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // Lock one employee's access row so simultaneous taps cannot record two entries.
    const [[access]] = await conn.query('SELECT usuario_id FROM taller_marcas_accesos WHERE usuario_id=? AND puede_marcar=1 FOR UPDATE', [user.id]);
    if (!access) throw error('No tiene permiso para registrar marcas.', 403);
    const ultimo = await ultimaMarca(conn, user.id);
    if (tipo !== siguienteTipo(ultimo)) throw error('El estado cambio. Actualice la pantalla antes de marcar.', 409);
    const [result] = await conn.query('INSERT INTO taller_marcas (usuario_id,nombre,tipo,creado_en,foto,tamanio,foto_sha256,reto_sha256) VALUES (?,?,?,UTC_TIMESTAMP(3),?,?,?,?)',
      [user.id, String(user.nombre || user.usuario).slice(0, 160), tipo, archivo.foto, archivo.tamanio, archivo.sha256, retoHash]);
    await conn.commit();
    return result.insertId;
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY') throw error('Esta captura ya fue utilizada. Revise sus marcas y tome una foto nueva.', 409);
    throw e;
  } finally { conn.release(); }
}
module.exports = { MAX_FOTO, RETO_MS, permisosMarcas, siguienteTipo, nuevoReto, verificarReto, validarFoto, filtrosHistorial, ultimaMarca, registrarMarca, CAMPOS_MARCA };
