const router=require('express').Router();
router.get('/',(req,res)=>{
  const user=req.session?.user;
  if(!user)return res.redirect('/login');
  if(user.departamentoActivo!=='OPERACIONES' || !user.departamentos?.includes('OPERACIONES'))return res.status(403).send('No tiene acceso a Operaciones.');
  res.set('Cache-Control','private, no-store');
  res.render('operaciones',{user});
});
module.exports=router;
