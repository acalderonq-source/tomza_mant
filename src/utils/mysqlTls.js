const fs=require('node:fs'),{X509Certificate}=require('node:crypto');
const net=require('node:net');
function mysqlTls(env=process.env){
  const archivo=env.MYSQL_SSL_CA_FILE,contenido=env.MYSQL_SSL_CA;
  if(archivo&&contenido)throw Error('Configure solo MYSQL_SSL_CA o MYSQL_SSL_CA_FILE');
  let ca=contenido?String(contenido).replace(/\\n/g,'\n'):archivo?fs.readFileSync(archivo,'utf8'):undefined;
  if(!ca&&String(env.MYSQL_SSL).toLowerCase()!=='true')return undefined;
  if(ca){try{new X509Certificate(ca);}catch(_){throw Error('El certificado MYSQL_SSL_CA no es un certificado PEM válido');}}
  return {rejectUnauthorized:true,verifyIdentity:true,minVersion:'TLSv1.2',...(ca?{ca}:{})};
}
function mysqlNetwork(env=process.env){
  const nombre=env.MYSQL_SSL_SERVER_NAME;if(!nombre)return {};
  if(!env.MYSQL_SSL_CA&&!env.MYSQL_SSL_CA_FILE&&String(env.MYSQL_SSL).toLowerCase()!=='true')throw Error('MYSQL_SSL_SERVER_NAME requiere TLS configurado');
  const port=Number(env.MYSQLPORT);
  if(!/^[a-zA-Z0-9_.-]{1,253}$/.test(nombre)||!env.MYSQLHOST||!Number.isInteger(port)||port<1||port>65535)throw Error('Nombre o puerto TLS de MySQL inválido');
  // La dirección TCP del proxy y la identidad certificada del servidor son distintas.
  // El nombre certificado se obtiene del certificado público por un canal administrativo confiable.
  return {host:nombre,stream:()=>net.connect({host:env.MYSQLHOST,port})};
}
module.exports={mysqlTls,mysqlNetwork};
