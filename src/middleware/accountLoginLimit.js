const crypto=require('node:crypto');
const {rateLimit}=require('express-rate-limit');
function limitarCuenta(obtenerIdentificador){
  return rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:true,legacyHeaders:false,
    keyGenerator:req=>crypto.createHash('sha256').update(String(obtenerIdentificador(req)||'').trim().toLowerCase()).digest('hex'),
    skipSuccessfulRequests:true,requestWasSuccessful:req=>req.loginVerificado===true,
    message:'Demasiados intentos para esta cuenta. Espere 15 minutos antes de intentar nuevamente.'});
}
module.exports={limitarCuenta};
