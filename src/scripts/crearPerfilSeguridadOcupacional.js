const crypto=require('node:crypto');
const bcrypt=require('bcryptjs');
async function crearPerfil(db) {
  const connection=await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]=await connection.query('SELECT id,rol FROM usuarios WHERE usuario=? FOR UPDATE',['seguridad_ocupacional']);
    if(rows.length)throw Object.assign(Error('El perfil ya existe. No se modificaron sus claves ni permisos.'),{code:'PERFIL_EXISTENTE'});
    const temporal='Tomza!7'+crypto.randomBytes(9).toString('base64url');
    const [result]=await connection.query(`INSERT INTO usuarios (nombre,usuario,password,rol,sede,requiere_cambio_password)
      VALUES (?,?,?,?,?,1)`,['Seguridad Ocupacional','seguridad_ocupacional',await bcrypt.hash(temporal,12),'SEGURIDAD_OCUP',null]);
    await connection.query('INSERT INTO usuario_departamentos (usuario_id,departamento,es_principal) VALUES (?,?,1)',[result.insertId,'SEGURIDAD_OCUPACIONAL']);
    await connection.commit();
    return {id:result.insertId,usuario:'seguridad_ocupacional',temporal,departamento:'Seguridad Ocupacional'};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
module.exports={crearPerfil};
if(require.main===module){
  const db=require('../db');
  crearPerfil(db).then(result=>console.log(JSON.stringify(result)))
    .catch(error=>{console.error(error.code || 'ERROR_CREANDO_PERFIL');process.exitCode=1;}).finally(()=>db.end());
}
