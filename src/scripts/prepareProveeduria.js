require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pool = require('../db');

// Reparación acotada: no ejecuta migraciones pendientes de otros departamentos.
async function prepararProveeduria() {
  const files = ['202610130001_proveeduria.sql','202610130002_proveeduria_proveedores.sql','202610130003_proveeduria_proveedores_contactos.sql','202610130004_proveeduria_inventario_bodega.sql'].map(filename=>{
    const sql=fs.readFileSync(path.join(__dirname,'../../migrations',filename),'utf8');
    return {filename,checksum:crypto.createHash('sha256').update(sql).digest('hex'),statements:sql.replace(/\r\n/g,'\n').split(/;\s*(?:\n|$)/).map(s=>s.trim()).filter(Boolean)};
  });
  const statements=files.flatMap(f=>f.statements);
  const db = await pool.getConnection();
  const temporales = [];
  try {
    const [historyTable] = await db.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migrations'");
    if (historyTable.length) {
      for(const file of files){
        const [history] = await db.query('SELECT checksum FROM schema_migrations WHERE filename=?', [file.filename]);
        if (history.length && history[0].checksum !== file.checksum) throw new Error(`La migración ${file.filename} tiene otro checksum; requiere revisión antes de continuar.`);
        file.applied=Boolean(history.length);
      }
    }
    for (const statement of statements) {
      const seed=statement.match(/^INSERT(?: IGNORE)? INTO (prov_proveedores|prov_proveedor_contactos) \(/);
      if(seed){
        await db.query(statement.replace(`INTO ${seed[1]}`,`INTO check_${seed[1]}`));continue;
      }
      if (!/^CREATE TABLE IF NOT EXISTS prov_[a-z_]+\s*\(/.test(statement)) throw new Error('Solo se permiten tablas y proveedores iniciales de Proveeduría.');
      const name = statement.match(/^CREATE TABLE IF NOT EXISTS (prov_[a-z_]+)/)[1];
      const temp = `check_${name}`;
      await db.query(statement.replace(`CREATE TABLE IF NOT EXISTS ${name}`, `CREATE TEMPORARY TABLE ${temp}`));
      temporales.push(temp);
    }
    console.log('Estructura y catálogo validados en nueve tablas temporales.');
    for(const file of files)for(const statement of file.statements)if(!file.applied||/^CREATE TABLE/.test(statement))await db.query(statement);
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY, filename VARCHAR(255) NOT NULL UNIQUE,
      checksum CHAR(64) NOT NULL, executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    for(const file of files)await db.query('INSERT IGNORE INTO schema_migrations (filename,checksum) VALUES (?,?)', [file.filename,file.checksum]);
    const [tables] = await db.query("SELECT TABLE_NAME AS tabla FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('prov_documentos','prov_inventario','prov_alertas','prov_auditoria','prov_adjuntos','prov_proveedores','prov_proveedor_contactos','prov_inventario_fichas','prov_inventario_movimientos')");
    if (tables.length !== 9) throw new Error('La verificación de las tablas quedó incompleta.');
    const [[catalogo]]=await db.query('SELECT COUNT(*) AS total FROM prov_proveedores');
    console.log(`Proveeduría preparada: nueve tablas verificadas, migraciones registradas y ${catalogo.total} proveedores.`);
  } finally {
    for (const temp of temporales) await db.query(`DROP TEMPORARY TABLE IF EXISTS ${temp}`);
    db.release();
  }
}

if (require.main === module) prepararProveeduria().catch(e => {
  console.error(e.code || e.message); process.exitCode = 1;
}).finally(() => pool.end());

module.exports = { prepararProveeduria };
