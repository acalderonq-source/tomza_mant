const {DEPARTAMENTOS}=require('./departamentos');
function departamentosInicio(user) {
  return DEPARTAMENTOS.map(d=>({...d,permitido:!user || (Array.isArray(user.departamentos) && user.departamentos.includes(d.key))}));
}
function destinoIngreso(next, user) {
  if(['PANTALLA_MECANICOS','PANTALLA_PESADOS'].includes(user.rol))return '/taller/dashboard';
  if(user.requiere_cambio_password)return '/cambiar-clave';
  return !next || next==='/dashboard' ? '/inicio' : next;
}
module.exports={departamentosInicio,destinoIngreso};
