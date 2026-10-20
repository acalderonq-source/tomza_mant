const router=require('express').Router();
const pool=require('../db');
const {SEDES_OPERACIONES}=require('../utils/operacionesTaller');
router.get('/',async(req,res)=>{
  const user=req.session?.user;
  if(!user)return res.redirect('/login');
  if(user.departamentoActivo!=='OPERACIONES' || !user.departamentos?.includes('OPERACIONES'))return res.status(403).send('No tiene acceso a Operaciones.');
  try{
    const [unidades]=await pool.query('SELECT id,placa FROM unidades WHERE activa=1 AND sede IN (?) ORDER BY placa',[SEDES_OPERACIONES]);
    res.set('Cache-Control','private, no-store');
    res.render('operaciones',{user,unidades});
  }catch(error){console.error('Unidades de Operaciones:',error.code||'ERROR');res.status(503).send('No se pudieron consultar las unidades. Intente nuevamente.');}
});
module.exports=router;
