const router=require('express').Router();
router.get('/',(req,res)=>{
  const user=req.session?.user;
  if(!user)return res.redirect('/login');
  if(user.departamentoActivo!=='SEGURIDAD_OCUPACIONAL' || !['ADMIN','SEGURIDAD_OCUP'].includes(user.rol) || !user.departamentos?.includes('SEGURIDAD_OCUPACIONAL'))return res.status(403).send('No tiene acceso a Seguridad Ocupacional.');
  res.set('Cache-Control','private, no-store');
  res.render('seguridad_ocupacional',{user});
});
module.exports=router;
