// Los perfiles anteriores conservan su alcance hasta que se guarden los controles separados.
function separarPermisos(config){
  if(!config || !['TALLER','OPERACIONES'].includes(config.departamento) || config.permisosOperacionesSeparados===true)return config;
  const permisos={...config.permisos},anterior=permisos.OPERACIONES;
  if(['LECTURA','GESTION'].includes(anterior)){
    if(!Object.hasOwn(permisos,'REPORTES_TALLER'))permisos.REPORTES_TALLER=anterior;
    if(config.departamento==='OPERACIONES' && !Object.hasOwn(permisos,'SUMINISTROS'))permisos.SUMINISTROS=anterior;
  }
  return {...config,permisos,permisosOperacionesSeparados:true};
}
function permiteModulo(config,id,metodo='GET'){
  const permiso=separarPermisos(config)?.permisos?.[id];
  return permiso==='GESTION' || (permiso==='LECTURA' && ['GET','HEAD'].includes(metodo));
}
module.exports={separarPermisos,permiteModulo};
