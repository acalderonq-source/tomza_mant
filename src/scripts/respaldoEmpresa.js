require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { cifrar, verificar, leerClave } = require('../utils/respaldoSeguro');
const { UPLOAD_ROOT, rutaEnDiscoPersistente } = require('../utils/uploadStorage');

function dentroDe(base, target) {
  const relative = path.relative(base, target);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

async function ejecutarArchivo(cmd, args, destino, key, env = process.env) {
  const child = spawn(cmd, args, { shell: false, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  // No imprimir stderr: el cliente puede incluir detalles de conexion.
  child.stderr.resume();
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(Error(`${path.basename(cmd)} fallo; codigo ${code}.`)));
  });
  const timer = setTimeout(() => child.kill(), 30 * 60 * 1000);
  try {
    const [metadata] = await Promise.all([cifrar(child.stdout, destino, key), exit]);
    await verificar(destino, key, metadata);
    return metadata;
  } catch (error) { child.kill(); throw error; }
  finally { clearTimeout(timer); }
}
async function main() {
  const key = leerClave(process.env.BACKUP_KEY);
  if (!process.env.BACKUP_ROOT) throw Error('Configure BACKUP_ROOT fuera de public/uploads.');
  const root = path.resolve(process.env.BACKUP_ROOT);
  const publicRoot = path.resolve(__dirname, '../../public');
  for (const prohibido of [publicRoot, path.resolve(UPLOAD_ROOT)]) {
    if (dentroDe(prohibido, root)) throw Error('El destino no puede estar dentro de archivos publicos o adjuntos.');
  }
  if (process.env.RENDER === 'true' && !rutaEnDiscoPersistente(root)) throw Error('BACKUP_ROOT debe estar en un disco persistente montado.');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const lockPath = path.join(root, '.respaldo.lock');
  const lock = await fs.open(lockPath, 'wx', 0o600);
  try {
    if (process.argv.includes('--verificar') || process.argv.includes('--extraer')) {
      const extraer = process.argv.includes('--extraer');
      const directory = process.argv[process.argv.indexOf(extraer ? '--extraer' : '--verificar') + 1];
      if (!directory) throw Error('Indique la carpeta del respaldo.');
      const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
      for (const name of ['database', 'uploads']) await verificar(path.join(directory, `${name}.enc`), key, manifest[name]);
      if (extraer) {
        if (!process.env.RESTORE_OUTPUT) throw Error('Defina RESTORE_OUTPUT con una carpeta nueva y privada.');
        const target = path.resolve(process.env.RESTORE_OUTPUT);
        if ([publicRoot, path.resolve(UPLOAD_ROOT)].some(base => dentroDe(base, target))) throw Error('No extraer datos a una carpeta publica o de adjuntos.');
        await fs.mkdir(target, { mode: 0o700 });
        for (const [name, filename] of [['database','database.sql'],['uploads','uploads.tar']]) {
          const output = require('node:fs').createWriteStream(path.join(target, filename + '.incompleto'), { flags: 'wx', mode: 0o600 });
          await verificar(path.join(directory, `${name}.enc`), key, manifest[name], output);
          await fs.rename(path.join(target, filename + '.incompleto'), path.join(target, filename));
        }
        console.log('SQL y TAR extraidos a la carpeta privada; no se importaron datos ni se reemplazaron adjuntos.');
      }
      console.log('Integridad y descifrado verificados. Esto no es una prueba de restauracion SQL.');
      return;
    }
    for (const name of ['MYSQLHOST', 'MYSQLUSER', 'MYSQLDATABASE']) if (!process.env[name]) throw Error(`Falta ${name}.`);
    // Un proxy con identidad TLS separada requiere un tunel/cliente verificado, no desactivar TLS.
    if (process.env.MYSQL_SSL_SERVER_NAME && process.env.MYSQL_SSL_SERVER_NAME !== process.env.MYSQLHOST) throw Error('Configure un cliente de respaldo con tunel TLS validado para este proxy.');
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    const directory = path.join(root, id + '.incompleto');
    await fs.mkdir(directory, { mode: 0o700 });
    const args = ['--single-transaction', '--quick', '--hex-blob', '--no-tablespaces',
      '--host', process.env.MYSQLHOST, '--port', process.env.MYSQLPORT || '3306', '--user', process.env.MYSQLUSER];
    if (process.env.NODE_ENV === 'production' || process.env.MYSQL_SSL === 'true' || process.env.MYSQL_SSL_CA_FILE) {
      args.push('--ssl-mode=VERIFY_IDENTITY');
      if (process.env.MYSQL_SSL_CA_FILE) args.push('--ssl-ca', process.env.MYSQL_SSL_CA_FILE);
      if (process.env.MYSQL_SSL_CA && !process.env.MYSQL_SSL_CA_FILE) throw Error('Configure MYSQL_SSL_CA_FILE para el cliente de respaldo.');
    }
    args.push(process.env.MYSQLDATABASE);
    const database = await ejecutarArchivo(process.env.MYSQLDUMP_BIN || 'mysqldump', args,
      path.join(directory, 'database.enc'), key, { ...process.env, MYSQL_PWD: process.env.MYSQLPASSWORD || '' });
    const uploads = await ejecutarArchivo(process.env.TAR_BIN || 'tar', ['-cf', '-', '-C', UPLOAD_ROOT, '.'],
      path.join(directory, 'uploads.enc'), key);
    const manifest = { version: 1, creado_en: new Date().toISOString(), release: process.env.RENDER_GIT_COMMIT || 'local',
      consistencia: 'SQL transaccional; adjuntos copiados despues. No ejecutar migraciones ni eliminar adjuntos durante el respaldo.', database, uploads };
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    const completed = path.join(root, id);
    await fs.rename(directory, completed);
    await fs.writeFile(path.join(root, 'ultimo-respaldo.json'), JSON.stringify({ ...manifest, carpeta: id }), { mode: 0o600 });
    console.log('Respaldo cifrado y verificado:', id);
  } finally { await lock.close(); await fs.unlink(lockPath); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { ejecutarArchivo, main, dentroDe };
