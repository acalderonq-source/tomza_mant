const { esSedeGranel, esSedeTransportadoraDetalle } = require('./sedes');

function negocioLlanta(solicitud) {
  const sede = String(solicitud.sede || '').trim();
  const clave = sede.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const placa = String(solicitud.placa || '').trim().toUpperCase();
  // La sede explicita de Tecnicos prevalece sobre el prefijo de la placa.
  if (clave === 'TECNICOS') return 'Tecnicos';
  if (esSedeGranel(sede)) return 'Granel';
  if (clave === 'TRANSPORTADORA' || esSedeTransportadoraDetalle(sede) || /^S\d{5,6}$/.test(placa) || /^EE\d{5,6}$/.test(placa)) return 'Transportadora';
  if (clave === 'TALLER') return 'Otros';
  return 'Cilindros';
}

module.exports = { negocioLlanta };
