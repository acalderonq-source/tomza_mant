function enviar(res,status,mensaje){
 res.set('Cache-Control','no-store, private');
 return res.status(status).type('text/plain').send(mensaje);
}
function noEncontrado(_req,res){
 return enviar(res,404,'Recurso no encontrado.');
}
function manejarError(error,_req,res,next){
 if(res.headersSent)return next(error);
 const codigo=Number(error.status||error.statusCode);
 const status=Number.isInteger(codigo)&&codigo>=400&&codigo<600?codigo:500;
 if(status>=500)console.error('Solicitud fallida:',error.code||'ERROR_INTERNO');
 return enviar(res,status,status>=500?'Error interno. Intente nuevamente.':'Solicitud no valida.');
}
module.exports={noEncontrado,manejarError};
