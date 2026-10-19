const test = require('node:test');
const assert = require('node:assert/strict');
const { sedeInventarioCompartido: sede, sedesInventarioCompartido: sedes } = require('../src/utils/sedesInventarioCompartido');

test('Proveeduria comparte inventario por ubicacion sin mezclar ciudades', () => {
  for (const s of ['Cartago','granel_cartago','Granel','Taller','Tecnicos']) assert.equal(sede(s), 'Cartago');
  for (const [origen,destino] of [['granel_la_cruz','La Cruz'],['granel_guapiles','Guapiles'],['granel_alajuela','Alajuela'],['granel_perez_zeledon','Perez Zeledon'],['mueble-limon','Limon'],['Recope_Limon','Limon'],['generales-limon','Limon'],['Cabezales','Transportadora'],['Tándem','Transportadora']]) assert.equal(sede(origen), destino);
  assert.equal(sede('Orotina'), 'Orotina');
  assert.equal(sede('Corporacion'), 'Corporacion');
  assert.deepEqual(sedes(['TODAS','Cartago','Taller','Tecnicos','granel_cartago','La Cruz','granel_la_cruz','Alajuela','granel_alajuela']), ['Cartago','La Cruz','Alajuela']);
});

test('normalizacion es idempotente y mantiene destinos externos sin inventarlos', () => {
  for (const valor of ['Cartago','La Cruz','Limon','Transportadora','PORTAL','Otro']) assert.equal(sede(sede(valor)), valor);
  assert.deepEqual(sedes(['',null,'TODAS']), []);
});
