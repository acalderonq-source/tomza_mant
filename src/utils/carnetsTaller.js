function puedeConsultarCarnetsTaller(user){
 if(!user || user.requiereCambioPassword || user.departamentoActivo!=='TALLER')return false;
 const perfil=String(user.perfilExcel||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
 return user.rol==='TALLER' && (['ASISTENTE TALLER','ASISTENTE DE TALLER','JEFE DE TALLER'].includes(perfil) || (!perfil && user.usuario==='taller'));
}
const FILTRO_MECANICOS=`EXISTS (
 SELECT 1 FROM usuario_cedulas cm JOIN usuarios um ON um.id=cm.usuario_id
 WHERE cm.cedula=c.cedula AND um.rol='MECANICO'
)`;
module.exports={puedeConsultarCarnetsTaller,FILTRO_MECANICOS};
