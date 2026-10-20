const router=require('express').Router();
router.get('/',(req,res)=>{
  const user=req.session?.user;
  if(!user)return res.redirect('/login');
  if(user.departamentoActivo!=='RECURSOS_HUMANOS' || !['ADMIN','RH_GESTOR'].includes(user.rol) || !user.departamentos?.includes('RECURSOS_HUMANOS'))return res.status(403).send('No tiene acceso a Recursos Humanos.');
  res.set('Cache-Control','private, no-store');
  res.render('recursos_humanos',{user});
});
module.exports=router;
