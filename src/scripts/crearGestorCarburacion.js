// Alta individual solicitada: acceso exclusivo a Carburación y consulta financiera.
const crypto=require('node:crypto');const bcrypt=require('bcryptjs');const pool=require('../db');
async function crearGestor(){
 const connection=await pool.getConnection();
 try{
  await connection.beginTransaction();
  const [existing]=await connection.query('SELECT usuario_id FROM usuario_cedulas WHERE cedula=? FOR UPDATE',['206770080']);
  if(existing.length)throw Error('La cédula ya tiene una cuenta; revise sus permisos antes de modificarla.');
  const [result]=await connection.query('INSERT INTO usuarios (nombre,usuario,password,rol,cedula,requiere_cambio_password) VALUES (?,?,?,?,?,0)',
    ['José Luis Zamora Aguilar','jose.zamora.carburacion',await bcrypt.hash(crypto.randomBytes(40).toString('hex'),12),'CARBURACION_GESTOR','206770080']);
  const id=result.insertId;
  await connection.query('INSERT INTO usuario_cedulas (cedula,usuario_id,persona_nombre,codigo_trabajador,pin_hash,requiere_cambio_pin,perfil_excel) VALUES (?,?,?,?,?,1,?)',
    ['206770080',id,'José Luis Zamora Aguilar','2171',await bcrypt.hash('2171',12),'Gestor de Carburación']);
  await connection.query('INSERT INTO usuario_departamentos (usuario_id,departamento,es_principal) VALUES (?,\'CARBURACION\',1)',[id]);
  await connection.query('INSERT INTO carburacion_cliente_editores (usuario_id,motivo) VALUES (?,?)',[id,'Autorización para administrar clientes; órdenes y facturas solo consulta']);
  await connection.query('INSERT INTO carnets_trabajador (cedula,qr_token) VALUES (?,?)',['206770080',crypto.randomBytes(32).toString('hex')]);
  await connection.commit();return id;
 }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
module.exports={crearGestor};
if(require.main===module)crearGestor().then(id=>console.log('Usuario de Carburación creado: '+id)).catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
