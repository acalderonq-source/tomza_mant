const router=require('express').Router();
const pool=require('../db');
const {SEDES_OPERACIONES}=require('../utils/operacionesTaller');
const {permiteModulo}=require('../utils/permisosOperaciones');
router.get('/',async(req,res)=>{
  const user=req.session?.user;
  if(!user)return res.redirect('/login');
  if(user.departamentoActivo!=='OPERACIONES' || !user.departamentos?.includes('OPERACIONES'))return res.status(403).send('No tiene acceso a Operaciones.');
  try{
    const permite=(id,metodo='GET')=>!user.accesoPersonal || permiteModulo(user.accesoPersonal,id,metodo);
    const puedeUnidades=permite('OPERACIONES'),puedeReportes=permite('REPORTES_TALLER'),puedeCrearReporte=permite('REPORTES_TALLER','POST'),puedeSuministros=permite('SUMINISTROS');
    const [unidades]=puedeUnidades?await pool.query('SELECT id,placa FROM unidades WHERE activa=1 AND sede IN (?) ORDER BY placa',[SEDES_OPERACIONES]):[[]];
    res.set('Cache-Control','private, no-store');
    res.render('operaciones',{user,unidades,puedeUnidades,puedeReportes,puedeCrearReporte,puedeSuministros});
  }catch(error){console.error('Unidades de Operaciones:',error.code||'ERROR');res.status(503).send('No se pudieron consultar las unidades. Intente nuevamente.');}
});
module.exports=router;
