const crypto=require('node:crypto');
// El secreto de desarrollo cambia al reiniciar si no se configuró uno privado.
const sessionSecret=process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex');
module.exports={sessionSecret};
