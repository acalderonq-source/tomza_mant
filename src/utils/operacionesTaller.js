// Las unidades de Operaciones conservan la sede histórica del catálogo.
const SEDES_OPERACIONES = ['Tecnicos', 'Técnicos'];
const esOperaciones = user => user?.departamentoActivo === 'OPERACIONES';
function rutaReportesOperaciones(ruta, metodo = 'GET') {
  if (['GET', 'HEAD'].includes(metodo)) return ['/reportes-supervisores', '/reportes-supervisores/', '/reportes-supervisores/historial', '/reportes-supervisores/reporte/excel'].includes(ruta);
  return metodo === 'POST' && ['/reportes-supervisores', '/reportes-supervisores/'].includes(ruta);
}
module.exports = { SEDES_OPERACIONES, esOperaciones, rutaReportesOperaciones };
