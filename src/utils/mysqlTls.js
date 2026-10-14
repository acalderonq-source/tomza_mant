const fs=require('node:fs'),{X509Certificate}=require('node:crypto');
function mysqlTls(env=process.env){
  const archivo=env.MYSQL_SSL_CA_FILE,contenido=env.MYSQL_SSL_CA;
  if(archivo&&contenido)throw Error('Configure solo MYSQL_SSL_CA o MYSQL_SSL_CA_FILE');
  let ca=contenido?String(contenido).replace(/\\n/g,'\n'):archivo?fs.readFileSync(archivo,'utf8'):undefined;
  if(!ca&&String(env.MYSQL_SSL).toLowerCase()!=='true')return undefined;
  if(ca){try{new X509Certificate(ca);}catch(_){throw Error('El certificado MYSQL_SSL_CA no es un certificado PEM válido');}}
  return {rejectUnauthorized:true,verifyIdentity:true,minVersion:'TLSv1.2',...(ca?{ca}:{})};
}
module.exports={mysqlTls};
