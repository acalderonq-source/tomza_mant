const { sedeSolicitud } = require('./sedesSolicitudesTrabajadores');

function sedeInventarioCompartido(valor) {
  const original = String(valor || '').trim();
  const clave = original.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (['CABEZALES','CISTERNAS','CARRETAS','GRUAS','TANDEM','TAMDEN'].includes(clave)) return 'Transportadora';
  if (clave === 'ACEITE LIMON') return 'Limon';
  return sedeSolicitud(original) || original;
}

function sedesInventarioCompartido(sedes) {
  return [...new Set(sedes.filter(s => s && s !== 'TODAS').map(sedeInventarioCompartido))];
}

module.exports = { sedeInventarioCompartido, sedesInventarioCompartido };
