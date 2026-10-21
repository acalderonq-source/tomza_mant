function restringirModulosMecanicos(req,res,next){
 const user=req.session?.user;
 if(!user || ['ADMIN','PANTALLA_MECANICOS','PANTALLA_PESADOS'].includes(user.rol))return next();
 const mecanico=user.rol==='MECANICO';
 const rutas=['/dashboard/resumen-ejecutivo','/taller/dashboard','/lavado-unidades'];
 if(mecanico && rutas.some(ruta=>req.path===ruta || req.path.startsWith(ruta+'/'))){
  return res.status(403).send('No tiene permiso para ingresar a este modulo.');
 }
 return next();
}
module.exports={restringirModulosMecanicos};
