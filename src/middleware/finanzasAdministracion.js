module.exports=function finanzasAdministracion(req,res,next){
  if(!req.session?.user)return res.redirect('/login');
  if(req.session.user.rol!=='ADMIN')return res.status(403).send('Planilla, Operación y gastos, y Capital y obligaciones están disponibles solo para Administración.');
  return next();
};
