function areasConfiguradas(config) {
  return [config.departamento, ...Object.keys(config.adicionales || {})];
}
function configDepartamento(config, area) {
  if (area === config.departamento) { const { adicionales, ...base } = config; return require('./permisosOperaciones').separarPermisos(base); }
  const extra = config.adicionales?.[area];
  return extra ? require('./permisosOperaciones').separarPermisos({ ...extra, departamento: area, sede: config.sede }) : null;
}
function consultaCompras(ruta, metodo = 'GET') {
  if (!['GET', 'HEAD'].includes(metodo)) return false;
  return /^\/compras\/ordenes(?:\/(?:reporte\/(?:pdf|excel)|\d+\/(?:detalle|pdf)))?$/.test(ruta) ||
    /^\/compras\/facturas(?:\/(?:reporte\/(?:pdf|excel)|dashboard|historial-pagos|colillas\/\d+\/descargar))?$/.test(ruta);
}
function consultaTaller(user) {
  return user?.departamentoActivo === 'TALLER' && user.accesoPersonal?.perfil === 'TALLER_COMPRAS_LECTURA';
}
function carburacionOperativa(user) {
  return user?.departamentoActivo === 'CARBURACION' && user.accesoPersonal?.perfil === 'CARBURACION_SIN_FINANZAS';
}
function permisoEspecial(config, ruta, metodo) {
  if (config.perfil === 'TALLER_COMPRAS_LECTURA') {
    if (consultaCompras(ruta, metodo)) return true;
    return ['GET', 'HEAD'].includes(metodo) && /^\/uploads\/(facturas|cotizaciones)\/[\w.-]+$/.test(ruta) && !ruta.includes('..');
  }
  if (config.perfil === 'CARBURACION_SIN_FINANZAS') {
    return /^\/carburacion(?:\/|$)/.test(ruta) && !/^\/carburacion\/(ordenes|facturas)(?:\/|$)/.test(ruta);
  }
  return null;
}
module.exports = { areasConfiguradas, configDepartamento, consultaCompras, consultaTaller, carburacionOperativa, permisoEspecial };
