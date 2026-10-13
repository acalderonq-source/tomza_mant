const fs = require('fs');
const path = require('path');
const pool = require('../db');

async function main() {
  const source = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname,'../data/carburacion_clientes.json'),'utf8'));
  const clientes = source.clientes;
  if (!Array.isArray(clientes) || !clientes.length || clientes.some(c => !String(c.nombre || '').trim() || c.nombre.length > 150 || !Number.isInteger(c.fila))) throw new Error('El archivo de clientes no tiene el formato esperado.');
  if (new Set(clientes.map(c => c.nombre.trim().normalize('NFC').toLocaleLowerCase('es-CR'))).size !== clientes.length) throw new Error('La lista contiene clientes duplicados.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [usuarios] = await connection.query(`SELECT DISTINCT uc.usuario_id id FROM usuario_cedulas uc
      JOIN usuario_departamentos ud ON ud.usuario_id=uc.usuario_id AND ud.departamento='CARBURACION'
      WHERE uc.persona_nombre=?`,['Fernández Mora Emily Camila']);
    if (usuarios.length !== 1) throw new Error('No se encontró un único perfil de Emily con acceso a Carburación.');
    let insertados = 0;
    for (const c of clientes) {
      const [[existente]] = await connection.query('SELECT id FROM carburacion_clientes WHERE nombre=? OR (archivo_origen=? AND hoja_origen=? AND fila_origen=?)',[c.nombre.trim(),source.archivo,source.hoja,c.fila]);
      if (existente) continue;
      await connection.query('INSERT INTO carburacion_clientes (nombre,archivo_origen,hoja_origen,fila_origen,creado_por) VALUES (?,?,?,?,?)',
        [c.nombre.trim(),source.archivo,source.hoja,c.fila,usuarios[0].id]);
      insertados++;
    }
    await connection.commit();
    const [[resumen]] = await connection.query('SELECT COUNT(*) cantidad FROM carburacion_clientes');
    console.log(JSON.stringify({leidos:clientes.length,insertados,total:resumen.cantidad}));
  } catch (e) { await connection.rollback(); throw e; } finally { connection.release(); }
}
main().catch(e => { console.error(e.code || e.message); process.exitCode=1; }).finally(()=>pool.end());
