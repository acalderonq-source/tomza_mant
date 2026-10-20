const express=require('express'),crypto=require('node:crypto');
const {requireAdministracion}=require('../middleware/requireAdministracion');
const {AREAS,MODULOS,validarAcceso,prepararAccesos}=require('../utils/accesosTrabajador');
const {SEDES_SOLICITUD}=require('../utils/sedesSolicitudesTrabajadores');
const {DEPARTAMENTOS}=require('../utils/departamentos');
const protegidos=['ADMIN','PANTALLA_MECANICOS','PANTALLA_PESADOS'];
const version=p=>crypto.createHash('sha256').update(JSON.stringify([p.nombre,p.rol,p.sede,p.config_json||null])).digest('hex');
const fallo=(status,message)=>Object.assign(Error(message),{status});
function crearRouter(db,propietario){
  const router=express.Router(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
  router.use(requireAdministracion(db,propietario));
  router.use(wrap(async(req,res,next)=>{
    await prepararAccesos(db);
    await db.query(`CREATE TABLE IF NOT EXISTS usuario_perfiles_historial (
      id BIGINT AUTO_INCREMENT PRIMARY KEY, usuario_id INT NOT NULL, actor_id INT NOT NULL,
      antes JSON NOT NULL, despues JSON NOT NULL, creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_perfil_usuario(usuario_id,id)) ENGINE=InnoDB`);
    next();
  }));
  const sql='SELECT u.id,u.usuario,u.nombre,u.rol,u.sede,a.config_json FROM usuarios u LEFT JOIN usuario_accesos_personales a ON a.usuario_id=u.id';
  router.get('/',wrap(async(req,res)=>{
    const [usuarios]=await db.query(sql+' ORDER BY u.nombre,u.usuario');
    res.render('trabajadores/perfiles_acceso',{usuarios,protegidos,guardado:req.query.guardado==='1'});
  }));
  router.get('/:id',wrap(async(req,res)=>{
    if(!/^[1-9]\d{0,9}$/.test(req.params.id))throw fallo(400,'Perfil invalido.');
    const [[perfil]]=await db.query(sql+' WHERE u.id=?',[req.params.id]);
    if(!perfil)throw fallo(404,'Perfil no encontrado.');
    if(protegidos.includes(perfil.rol))throw fallo(403,'Este perfil de sistema esta protegido.');
    const config=perfil.config_json?JSON.parse(perfil.config_json):null;
    res.render('trabajadores/perfil_editar',{perfil,config,version:version(perfil),modulos:MODULOS,departamentos:DEPARTAMENTOS.filter(d=>AREAS[d.key]),sedes:[...new Set(['TODAS',...SEDES_SOLICITUD,perfil.sede].filter(Boolean))]});
  }));
  router.post('/:id',wrap(async(req,res)=>{
    if(!/^[1-9]\d{0,9}$/.test(req.params.id))throw fallo(400,'Perfil invalido.');
    const nombre=String(req.body.nombre||'').trim();
    if(!nombre||nombre.length>100||/[<>\x00-\x1f]/.test(nombre))throw fallo(400,'Revise el nombre del perfil.');
    if(!['conservar','personal'].includes(req.body.modo))throw fallo(400,'Seleccione como configurar el perfil.');
    const config=req.body.modo==='personal'?validarAcceso(req.body):null;
    const connection=await db.getConnection();
    try{
      await connection.beginTransaction();
      const [[perfil]]=await connection.query(sql+' WHERE u.id=? FOR UPDATE',[req.params.id]);
      if(!perfil)throw fallo(404,'Perfil no encontrado.');
      if(protegidos.includes(perfil.rol))throw fallo(403,'Este perfil de sistema esta protegido.');
      if(req.body.version!==version(perfil))throw fallo(409,'Otra persona modifico este perfil. Recargue antes de guardar.');
      if(perfil.config_json&&!config)throw fallo(400,'Este acceso debe conservar sus permisos individuales.');
      const sede=config?.sede||String(req.body.sede_asignada||'');
      if(!sede||!['TODAS',...SEDES_SOLICITUD,perfil.sede].includes(sede))throw fallo(400,'Seleccione una sede valida.');
      const rol=config?AREAS[config.departamento]:perfil.rol;
      await connection.query('UPDATE usuarios SET nombre=?,sede=?,rol=? WHERE id=?',[nombre,sede,rol,perfil.id]);
      if(config){
        await connection.query('INSERT INTO usuario_accesos_personales (usuario_id,config_json,asignado_por) VALUES (?,?,?) ON DUPLICATE KEY UPDATE config_json=VALUES(config_json),asignado_por=VALUES(asignado_por)',[perfil.id,JSON.stringify(config),req.session.user.id]);
        await connection.query('DELETE FROM usuario_departamentos WHERE usuario_id=?',[perfil.id]);
        await connection.query('INSERT INTO usuario_departamentos (usuario_id,departamento,es_principal) VALUES (?,?,1)',[perfil.id,config.departamento]);
      }
      await connection.query('INSERT INTO usuario_perfiles_historial (usuario_id,actor_id,antes,despues) VALUES (?,?,?,?)',[perfil.id,req.session.user.id,JSON.stringify(perfil),JSON.stringify({nombre,sede,rol,config})]);
      await connection.commit();res.redirect(303,'/admin/perfiles?guardado=1');
    }catch(e){await connection.rollback();throw e;}finally{connection.release();}
  }));
  router.use((e,req,res,next)=>{console.error('Editar perfil:',e.code||e.status||'ERROR');res.status(e.status||503).send(e.status?e.message:'No se pudo guardar el perfil. Intente nuevamente.');});
  return router;
}
module.exports={crearRouter,version};
