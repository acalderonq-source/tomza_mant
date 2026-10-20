const {SEDES_SOLICITUD}=require('./sedesSolicitudesTrabajadores');
const AREAS={TALLER:'TALLER',OPERACIONES:'SUPERVISOR',CONTABILIDAD:'CONTABILIDAD',PROVEEDURIA:'PROVEEDURIA_TALLER',LOGISTICA:'TRAMITES',SEGURIDAD_OCUPACIONAL:'SEGURIDAD_OCUP',CARBURACION:'CARBURACION_GESTOR',RECURSOS_HUMANOS:'RH_GESTOR'};
const MODULOS=[
  {id:'INICIO',nombre:'Inicio del departamento',areas:Object.keys(AREAS),rutas:['/dashboard'],url:null},
  {id:'UNIDADES',nombre:'Unidades',areas:['TALLER','OPERACIONES'],rutas:['/unidades','/api/unidades'],url:'/unidades'},
  {id:'MANTENIMIENTOS',nombre:'Mantenimientos y agenda',areas:['TALLER'],rutas:['/mantenimientos','/agenda'],url:'/mantenimientos'},
  {id:'TALLER',nombre:'Tablero y prioridades de Taller',areas:['TALLER'],rutas:['/taller'],url:'/taller/dashboard'},
  {id:'REPUESTOS',nombre:'Solicitudes de repuestos',areas:['TALLER','PROVEEDURIA'],rutas:['/repuestos','/repuestos-semanales'],url:'/repuestos'},
  {id:'BODEGA',nombre:'Bodega e inventario',areas:['TALLER','PROVEEDURIA'],rutas:['/bodega'],url:'/bodega'},
  {id:'LLANTAS',nombre:'Llantas',areas:['TALLER'],rutas:['/llantas'],url:'/llantas'},
  {id:'ACEITES',nombre:'Aceites',areas:['TALLER','PROVEEDURIA'],rutas:['/aceite','/control-cambios-aceite'],url:'/aceite'},
  {id:'DEKRA',nombre:'DEKRA y MINAE',areas:['TALLER'],rutas:['/dekra','/minae'],url:'/dekra'},
  {id:'ASIENTOS',nombre:'Asientos pasivos',areas:['TALLER','CONTABILIDAD'],rutas:['/compras/facturas/asientos'],url:'/compras/facturas/asientos'},
  {id:'ORDENES',nombre:'Ordenes de compra y cotizaciones',areas:['TALLER','CONTABILIDAD','PROVEEDURIA'],rutas:['/compras/ordenes','/compras/cotizacion'],url:'/compras/ordenes'},
  {id:'FACTURAS',nombre:'Facturas y pagos',areas:['TALLER','CONTABILIDAD','PROVEEDURIA'],rutas:['/compras/facturas','/compras/dashboard'],url:'/compras/facturas'},
  {id:'RESUMEN',nombre:'Resumen ejecutivo y conciliacion',areas:['TALLER','CONTABILIDAD','PROVEEDURIA'],rutas:['/dashboard/resumen-ejecutivo','/dashboard/conciliacion-pagos'],url:'/dashboard/resumen-ejecutivo'},
  {id:'PROVEEDORES',nombre:'Proveedores',areas:['TALLER','PROVEEDURIA'],rutas:['/compras/proveedores'],url:'/compras/proveedores'},
  {id:'TRAMITES',nombre:'ARESEP y tramites',areas:['TALLER','CONTABILIDAD','OPERACIONES','LOGISTICA'],rutas:['/aresep'],url:'/aresep'},
  {id:'OPERACIONES',nombre:'Revision en ruta, giras y reportes',areas:['TALLER','OPERACIONES'],rutas:['/revision-ruta','/giras','/reportes-supervisores'],url:'/revision-ruta'},
  {id:'CARBURACION',nombre:'Carburacion',areas:['CARBURACION'],rutas:['/carburacion'],url:'/carburacion/dashboard'},
  {id:'SEGURIDAD',nombre:'Seguridad Ocupacional',areas:['SEGURIDAD_OCUPACIONAL'],rutas:['/seguridad-ocupacional'],url:'/seguridad-ocupacional'},
  {id:'RECURSOS_HUMANOS',nombre:'Recursos Humanos',areas:['RECURSOS_HUMANOS'],rutas:['/recursos-humanos'],url:'/recursos-humanos'},
  {id:'PROVEEDURIA',nombre:'Gestion de Proveeduria',areas:['PROVEEDURIA'],rutas:['/proveeduria'],url:'/proveeduria'},
  {id:'DOCUMENTOS',nombre:'Adjuntos autorizados por el sistema',areas:Object.keys(AREAS),rutas:['/uploads'],url:null}
];
function error(message){return Object.assign(Error(message),{status:400});}
function validarAcceso(body){
  const departamento=String(body.departamento || '');
  if(!AREAS[departamento])throw error('Seleccione un departamento habilitado, distinto de Administracion.');
  const sede=String(body.sede_asignada || '');
  if(!SEDES_SOLICITUD.includes(sede))throw error('Seleccione una sede laboral valida.');
  const permisos={};
  for(const [key,value] of Object.entries(body))if(key.startsWith('permiso_')){
    const id=key.slice(8),modulo=MODULOS.find(m=>m.id===id);
    if(!['','NINGUNO','LECTURA','GESTION'].includes(value))throw error('Permiso invalido.');
    if(value==='' || value==='NINGUNO')continue;
    if(!modulo?.areas.includes(departamento))throw error('El modulo no pertenece al departamento seleccionado.');
    permisos[id]=value;
  }
  if(!Object.keys(permisos).some(id=>id!=='DOCUMENTOS'))throw error('Asigne al menos un modulo al trabajador.');
  return {departamento,sede,permisos};
}
async function prepararAccesos(db){await db.query(`CREATE TABLE IF NOT EXISTS usuario_accesos_personales (
  usuario_id INT NOT NULL PRIMARY KEY,config_json TEXT NOT NULL,asignado_por INT NOT NULL,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);}
function coincide(ruta,prefijo){return ruta===prefijo || ruta.startsWith(prefijo+'/');}
function esRutaSuministrosSeguridad(ruta,metodo='GET'){
  return (['GET','HEAD'].includes(metodo) && ['/proveeduria/mis-solicitudes','/proveeduria/alertas'].includes(ruta))
    || (metodo==='POST' && (ruta==='/proveeduria/solicitudes' || /^\/proveeduria\/salidas\/\d+\/aceptar$/.test(ruta)));
}
function puedeAcceder(config,ruta,metodo){
  if(['SEGURIDAD_OCUPACIONAL','RECURSOS_HUMANOS'].includes(config.departamento) && esRutaSuministrosSeguridad(ruta,metodo)){
    const permiso=config.permisos[config.departamento==='RECURSOS_HUMANOS'?'RECURSOS_HUMANOS':'SEGURIDAD'];
    return permiso==='GESTION' || (permiso==='LECTURA' && ['GET','HEAD'].includes(metodo));
  }
  if(['/','/inicio','/dashboard','/logout','/login','/login/perfil','/cambiar-clave','/departamento/activo','/cambiar-sede'].includes(ruta))return true;
  let elegido=null,longitud=0;
  for(const m of MODULOS)for(const p of m.rutas)if(coincide(ruta,p) && p.length>longitud){elegido=m;longitud=p.length;}
  if(!elegido || !elegido.areas.includes(config.departamento))return false;
  const permiso=config.permisos[elegido.id];
  return permiso==='GESTION' || (permiso==='LECTURA' && ['GET','HEAD'].includes(metodo));
}
function controlarAccesosPersonales(db){return async(req,res,next)=>{
  const user=req.session?.user;
  if(!user || ['ADMIN','PANTALLA_MECANICOS','PANTALLA_PESADOS'].includes(user.rol))return next();
  if(['GET','HEAD'].includes(req.method) && (/^\/(css|js|img|fonts)\//.test(req.path) || ['/manifest.webmanifest','/sw.js','/offline.html','/data/mapa-sedes/costa-rica-provincias.geojson'].includes(req.path)))return next();
  try{
    const [rows]=await db.query('SELECT config_json FROM usuario_accesos_personales WHERE usuario_id=?',[user.id]);
    if(!rows.length){
      if(!/^acceso_\d{9,12}$/.test(user.usuario || '')){delete user.accesoPersonal;return next();}
      return res.status(403).send('Este acceso no tiene permisos configurados. Contacte a Administracion.');
    }
    const config=JSON.parse(rows[0].config_json);
    if(!AREAS[config.departamento] || !config.permisos || typeof config.permisos!=='object')throw Error('CONFIG_INVALIDA');
    user.accesoPersonal=config;user.departamentos=[config.departamento];
    if(user.departamentoActivo!==config.departamento || !puedeAcceder(config,req.path,req.method))return res.status(403).send('No tiene permiso para ingresar o realizar esta accion.');
    return next();
  }catch(e){console.error('Permisos personales:',e.code || 'ERROR');return res.status(503).send('No se pudieron verificar sus permisos. Intente nuevamente.');}
};}
module.exports={esRutaSuministrosSeguridad,AREAS,MODULOS,validarAcceso,prepararAccesos,puedeAcceder,controlarAccesosPersonales};
