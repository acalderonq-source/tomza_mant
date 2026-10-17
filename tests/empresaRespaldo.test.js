const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { leerClave, cifrar, verificar } = require('../src/utils/respaldoSeguro');
const { estadoRespaldo } = require('../src/utils/controlEmpresa');
const { ejecutarArchivo, dentroDe } = require('../src/scripts/respaldoEmpresa');

test('respaldo cifra y verifica, rechaza clave incorrecta y alteracion', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tomza-backup-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const archivo = path.join(directory, 'test.enc'), key = leerClave('ab'.repeat(32));
  const contenido = 'INSERT INTO prueba VALUES (1);\n'.repeat(1000);
  const metadata = await cifrar(Readable.from([contenido]), archivo, key);
  assert.equal(metadata.bytes, Buffer.byteLength(contenido));
  assert.deepEqual(await verificar(archivo, key, metadata), metadata);
  assert.equal((await fs.readFile(archivo)).includes(Buffer.from('INSERT INTO')), false);
  const extraido = path.join(directory, 'test.sql');
  await verificar(archivo, key, metadata, require('node:fs').createWriteStream(extraido, { flags: 'wx' }));
  assert.equal(await fs.readFile(extraido, 'utf8'), contenido);
  await assert.rejects(verificar(archivo, leerClave('cd'.repeat(32)), metadata));
  await assert.rejects(verificar(archivo, key, { ...metadata, bytes: 1 }));
  const data = await fs.readFile(archivo); data[25] ^= 1; await fs.writeFile(archivo, data);
  await assert.rejects(verificar(archivo, key, metadata));
});
test('clave corta o vacia falla sin respaldo', () => {
  assert.throws(() => leerClave('abc')); assert.throws(() => leerClave(''));
});
test('el destino privado no acepta subcarpetas publicas con prefijo de puntos', () => {
  const base = path.resolve('public');
  assert.equal(dentroDe(base, path.join(base, '..oculto')), true);
  assert.equal(dentroDe(base, path.resolve('privado')), false);
});
test('un destino configurado no se presenta como respaldo exitoso', async () => {
  assert.equal((await estadoRespaldo({})).estado, 'Sin configurar');
  assert.equal((await estadoRespaldo({ BACKUP_ROOT: path.join(os.tmpdir(), 'no-existing-tomza-backup') })).estado, 'Sin respaldo verificado registrado');
});
test('proceso de copia verifica salida y no acepta un comando fallido como respaldo valido', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tomza-backup-process-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const key = leerClave('ab'.repeat(32));
  const meta = await ejecutarArchivo(process.execPath, ['-e', 'process.stdout.write("SQL de prueba")'], path.join(directory, 'ok.enc'), key);
  assert.equal(meta.bytes, 13);
  await assert.rejects(ejecutarArchivo(process.execPath, ['-e', 'process.stdout.write("parcial");process.exitCode=1'], path.join(directory, 'error.enc'), key));
});
