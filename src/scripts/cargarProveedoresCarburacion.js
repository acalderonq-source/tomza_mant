const pool = require('../db');

const proveedores = [
  {
    nombre: 'Tecno Analitica S.A.',
    direccion: 'Barrio el Carmen, Coronado, de la plaza de deportes de Dulce Nombre de Coronado 400 metros al este y 50 metros norte',
    telefono: '2294-7000', email: 'info@tecnoanalitica.net', cedula: null
  },
  {
    nombre: 'Ingnova Soluciones Integrales S.A.', cedula: '3101895580',
    telefono: '+506 8860-6127', email: 'factura@ingnovacr.com',
    direccion: 'Provincia: Cartago, Cantón: Cartago, Distrito: Occidental, Barrio: Hospital (parte). 25 metros sur y 50 metros oeste de Perimercado Cartago, Urbanización San Luis Gonzaga'
  }
];

async function main() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [usuarios] = await connection.query(`
      SELECT DISTINCT u.id FROM usuarios u
      JOIN usuario_cedulas uc ON uc.usuario_id=u.id
      JOIN usuario_departamentos ud ON ud.usuario_id=u.id AND ud.departamento='CARBURACION'
      WHERE uc.persona_nombre=?
    `, ['Fernández Mora Emily Camila']);
    if (usuarios.length !== 1) throw new Error('No se encontró un único perfil de Emily con acceso a Carburación.');
    for (const p of proveedores) {
      const [existentes] = await connection.query('SELECT id FROM carburacion_proveedores WHERE nombre=? FOR UPDATE', [p.nombre]);
      if (existentes.length) continue;
      await connection.query(`INSERT INTO carburacion_proveedores
        (nombre,direccion,telefono,email,cedula_juridica,creado_por) VALUES (?,?,?,?,?,?)`,
      [p.nombre,p.direccion,p.telefono,p.email,p.cedula,usuarios[0].id]);
    }
    await connection.commit();
    const [rows] = await connection.query(`SELECT nombre,direccion,telefono,email,cedula_juridica FROM carburacion_proveedores WHERE nombre IN (${proveedores.map(() => '?').join(',')}) ORDER BY nombre`, proveedores.map(p=>p.nombre));
    console.log(JSON.stringify(rows,null,2));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;}).finally(()=>pool.end());
