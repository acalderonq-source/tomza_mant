// Gestor operativo: administra catálogos y estaciones; consulta documentos financieros.
function puedeModificarFinanzas(user) {
  return user?.rol !== 'CARBURACION_GESTOR';
}
function controlarFinanzas(req,res,next) {
  const permiso=puedeModificarFinanzas(req.session?.user);
  res.locals.puedeModificarFinanzas=permiso;
  if(permiso)return next();
  const pathname=req.path.toLowerCase().replace(/\/+$/,'');
  const financiera=/^\/(ordenes|facturas)(\/|$)/.test(pathname);
  // Configurar destinatarios es gestión del departamento, no registra pagos ni facturas.
  if(pathname==='/facturas/configuracion-correo' && ['GET','HEAD','POST'].includes(req.method))return next();
  const formulario=/^\/ordenes\/nueva$|^\/ordenes\/[^/]+\/(editar|factura)$|^\/facturas\/(nueva|pago)$/.test(pathname);
  if(financiera && (!['GET','HEAD'].includes(req.method) || formulario))return res.status(403).send('Su acceso a órdenes, facturas y pagos de Carburación es solo de consulta.');
  next();
}
module.exports={puedeModificarFinanzas,controlarFinanzas};
