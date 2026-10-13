const express=require('express');const pool=require('../db');
const {CAMPOS_CLIENTE,puedeEditarClientes,guardarFicha}=require('../utils/carburacionClienteFicha');
const {fallo}=require('../utils/carburacionFinanzas');
const router=express.Router();const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
router.use((req,res,next)=>{
  puedeEditarClientes(req.session.user).then(permiso=>{
    res.locals.puedeEditarClientes=permiso;res.locals.camposCliente=CAMPOS_CLIENTE;
    res.locals.success=req.session.success || null;delete req.session.success;next();
  }).catch(next);
});
router.param('id',(req,res,next,id)=>{if(!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))return res.sendStatus(404);next();});
function requiereEdicion(req,res,next){if(!res.locals.puedeEditarClientes)return res.status(403).send('No tiene permiso para agregar o editar clientes de Carburación.');next();}
router.get('/',wrap(async(_req,res)=>{
  const [clientes]=await pool.query('SELECT id,nombre FROM carburacion_clientes ORDER BY nombre');
  res.render('carburacion/clientes',{clientes});
}));
router.get('/nuevo',requiereEdicion,(_req,res)=>res.render('carburacion/cliente_form',{cliente:{},error:null}));
async function guardar(req,res,next,id) {
  try {
    const clienteId=await guardarFicha(id,req.body,req.session.user);
    req.session.success=id?'Información del cliente actualizada.':'Nuevo cliente agregado a Carburación.';
    res.redirect(`/carburacion/clientes/${clienteId}`);
  }catch(error){
    if(![400,409].includes(error.status))return next(error);
    res.status(error.status).render('carburacion/cliente_form',{cliente:{...req.body,...(id?{id}:{})},error:error.message});
  }
}
router.post('/',requiereEdicion,(req,res,next)=>guardar(req,res,next,null));
router.get('/:id/editar',requiereEdicion,wrap(async(req,res)=>{
  const [[cliente]]=await pool.query('SELECT * FROM carburacion_clientes WHERE id=?',[req.params.id]);
  if(!cliente)throw fallo('Cliente no encontrado.',404);
  res.render('carburacion/cliente_form',{cliente,error:null});
}));
router.post('/:id/editar',requiereEdicion,(req,res,next)=>guardar(req,res,next,req.params.id));
router.get('/:id',wrap(async(req,res)=>{
  const [[cliente]]=await pool.query('SELECT * FROM carburacion_clientes WHERE id=?',[req.params.id]);
  if(!cliente)throw fallo('Cliente no encontrado.',404);
  res.render('carburacion/cliente_ficha',{cliente});
}));
router.use((error,req,res,next)=>{
  if(!error.status)return next(error);
  res.status(error.status).render('carburacion/cliente_error',{mensaje:error.message});
});
module.exports=router;
