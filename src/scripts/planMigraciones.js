require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
async function plan(db, directory = path.resolve(__dirname, '../../migrations')) {
  const [tables] = await db.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migrations'");
  const [rows] = tables.length ? await db.query('SELECT filename,checksum FROM schema_migrations') : [[]];
  const applied = new Map(rows.map(r => [r.filename, r.checksum]));
  const files = fs.readdirSync(directory).filter(f => f.endsWith('.sql')).sort();
  return files.map(filename => {
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, filename), 'utf8')).digest('hex');
    return { filename, estado: !applied.has(filename) ? 'PENDIENTE' : applied.get(filename) === checksum ? 'APLICADA' : 'CHECKSUM_DIFERENTE' };
  });
}
if (require.main === module) {
  const db = require('../db');
  plan(db).then(rows => {
    console.table(rows);
    if (rows.some(r => r.estado === 'CHECKSUM_DIFERENTE')) process.exitCode = 1;
  }).catch(error => { console.error('No se pudo revisar migraciones:', error.code || error.message); process.exitCode = 1; })
    .finally(() => db.end());
}
module.exports = { plan };
