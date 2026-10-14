const crypto=require('node:crypto');
const IDLE_MS=30*60*1000,ABSOLUTE_MS=8*60*60*1000;
function selloUsuario(user,departamentos,secret){
  return crypto.createHmac('sha256',secret).update(JSON.stringify([String(user.id),user.usuario,user.rol,user.sede,user.password||'',user.pin_hash||'',Number(user.requiere_cambio_password||0),departamentos.map(d=>[d.departamento,Number(d.es_principal||0)])])).digest('hex');
}
async function leerSello(user,db,secret){
  const [rows]=await db.query('SELECT u.id,u.usuario,u.rol,u.sede,u.password,u.requiere_cambio_password,uc.pin_hash FROM usuarios u LEFT JOIN usuario_cedulas uc ON uc.usuario_id=u.id AND uc.cedula=? WHERE u.id=? LIMIT 1',[user.cedula||null,user.id]);
  if(!rows.length)return null;
  const [areas]=await db.query('SELECT departamento,es_principal FROM usuario_departamentos WHERE usuario_id=? ORDER BY es_principal DESC,departamento',[user.id]);
  return selloUsuario(rows[0],areas,secret);
}
function protegerSesiones(db,secret,now=Date.now){
  return async(req,res,next)=>{
    if(!req.session?.user&&!req.session?.proveedorPortal)return next();
    const t=now(),pantalla=['PANTALLA_MECANICOS','PANTALLA_PESADOS'].includes(req.session.user?.rol);
    const cerrar=()=>req.session.destroy(()=>{res.clearCookie('tomza.sid');if(req.method!=='GET'||req.headers.accept?.includes('application/json'))return res.status(401).json({error:'La sesión venció o cambió el acceso. Inicie sesión nuevamente.'});res.redirect(req.session?.proveedorPortal?'/portal-proveedores/login':req.path.startsWith('/portal-proveedores')?'/portal-proveedores/login':'/login?departamento=TALLER');});
    if(!req.session.authenticatedAt||!req.session.lastActivity||(!pantalla&&(t-req.session.lastActivity>IDLE_MS||t-req.session.authenticatedAt>ABSOLUTE_MS)))return cerrar();
    try{
      if(req.session.user){
        const sello=await leerSello(req.session.user,db,secret);
        if(!sello||!req.session.user.authStamp||sello!==req.session.user.authStamp)return cerrar();
      }
      req.session.lastActivity=t;return next();
    }catch(e){console.warn('No se pudo verificar la sesión:',e.code||'ERROR');return res.status(503).send('No se pudo verificar el acceso. Intente nuevamente en unos momentos.');}
  };
}
module.exports={selloUsuario,leerSello,protegerSesiones,IDLE_MS,ABSOLUTE_MS};
