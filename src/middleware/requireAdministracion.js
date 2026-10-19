const { esPropietarioAdministracion } = require('../utils/administracionPrivada');

function requireAdministracion(db, propietario = esPropietarioAdministracion) {
  return async (req,res,next) => {
    res.set('Cache-Control','private, no-store');
    const user=req.session?.user;
    if (!user) return res.status(401).send('Inicie sesion en el departamento Administracion.');
    if (user.rol!=='ADMIN' || user.departamentoActivo!=='ADMINISTRACION') {
      return res.status(403).send('Esta opcion es exclusiva del departamento Administracion. Cambie de departamento para continuar.');
    }
    try {
      if (!await propietario(user,db)) return res.status(403).send('Administracion esta reservada al propietario del sistema.');
      return next();
    } catch(error) { return next(error); }
  };
}
module.exports={requireAdministracion};
