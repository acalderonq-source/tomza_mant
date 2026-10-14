const router=require('express').Router();
const pool=require('../db');
const {esPropietarioAdministracion}=require('../utils/administracionPrivada');
const {DEPARTAMENTOS}=require('../utils/departamentos');
router.use(async(req,res,next)=>{
  try{
    res.set('Cache-Control','no-store');
    if(!req.session.user)return res.redirect('/login?departamento=ADMINISTRACION');
    if(!await esPropietarioAdministracion(req.session.user,pool))return res.status(403).send('Administración está reservada al propietario del sistema.');
    next();
  }catch(e){next(e);}
});
router.get('/',(req,res)=>res.render('administracion',{user:req.session.user,departamentos:DEPARTAMENTOS}));
module.exports=router;
