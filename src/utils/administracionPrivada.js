async function esPropietarioAdministracion(user,pool) {
  if(!user || user.rol!=='ADMIN')return false;
  const [rows]=await pool.query("SELECT a.usuario_id FROM administracion_propietario a JOIN usuarios u ON u.id=a.usuario_id WHERE a.id=1 AND u.rol='ADMIN'");
  return rows.length===1 && Number(rows[0].usuario_id)===Number(user.id);
}
module.exports={esPropietarioAdministracion};
