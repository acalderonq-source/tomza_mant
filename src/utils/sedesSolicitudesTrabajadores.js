// Catalogo de ingreso de personas; no sustituye las sedes operativas de Taller.
const SEDES_SOLICITUD = ['Cartago','Guapiles','La Cruz','Transportadora','Orotina','Alajuela','San Carlos','Rio Claro','Perez Zeledon','Nicoya','Limon','Corporacion'];
function sedeSolicitud(value) {
  const clave = String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
  const equivalencias = {
    GRANEL:'Cartago', 'GRANEL CARTAGO':'Cartago', TALLER:'Cartago', TECNICOS:'Cartago',
    'GRANEL ALAJUELA':'Alajuela', 'GRANEL GUAPILES':'Guapiles', 'GRANEL LA CRUZ':'La Cruz',
    'GRANEL PEREZ ZELEDON':'Perez Zeledon', 'GENERALES LIMON':'Limon', 'MUEBLE LIMON':'Limon', 'RECOPE LIMON':'Limon'
  };
  return equivalencias[clave] || SEDES_SOLICITUD.find(s => s.toUpperCase() === clave) || null;
}
module.exports = { SEDES_SOLICITUD, sedeSolicitud };
