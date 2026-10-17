const fs = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Transform, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const MAGIC = Buffer.from('TOMZA-B1');
function leerClave(value) {
  if (!/^[a-f0-9]{64}$/i.test(String(value || ''))) throw Error('BACKUP_KEY debe tener 64 caracteres hexadecimales.');
  return Buffer.from(value, 'hex');
}
async function cifrar(input, archivo, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const hash = crypto.createHash('sha256'); let bytes = 0;
  const contador = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length; hash.update(chunk); callback(null, chunk);
  } });
  const output = fs.createWriteStream(archivo, { flags: 'wx', mode: 0o600 });
  output.write(Buffer.concat([MAGIC, iv]));
  await pipeline(input, contador, zlib.createGzip(), cipher, output);
  await fs.promises.appendFile(archivo, cipher.getAuthTag());
  return { bytes, sha256: hash.digest('hex') };
}
async function verificar(archivo, key, esperado, output) {
  const size = (await fs.promises.stat(archivo)).size;
  if (size < MAGIC.length + 12 + 16) throw Error('Respaldo incompleto.');
  const fd = await fs.promises.open(archivo, 'r');
  const header = Buffer.alloc(MAGIC.length + 12), tag = Buffer.alloc(16);
  try { await fd.read(header, 0, header.length, 0); await fd.read(tag, 0, 16, size - 16); }
  finally { await fd.close(); }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw Error('Formato de respaldo desconocido.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  const hash = crypto.createHash('sha256'); let bytes = 0;
  await pipeline(fs.createReadStream(archivo, { start: header.length, end: size - 17 }),
    decipher, zlib.createGunzip(), new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length; hash.update(chunk); callback(null, chunk);
    } }), output || new Writable({ write(_chunk, _encoding, callback) { callback(); } }));
  const sha256 = hash.digest('hex');
  if (esperado && (sha256 !== esperado.sha256 || bytes !== esperado.bytes)) throw Error('El contenido no coincide con el manifiesto.');
  return { bytes, sha256 };
}
module.exports = { leerClave, cifrar, verificar };
