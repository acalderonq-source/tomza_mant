const { test } = require('node:test');
const assert = require('node:assert/strict');
const { negocioLlanta } = require('../src/utils/llantasNegocio');

test('EE38537 de Tecnicos no se agrupa en Transportadora', () => {
  assert.equal(negocioLlanta({ placa: 'EE38537', sede: 'Tecnicos' }), 'Tecnicos');
  assert.equal(negocioLlanta({ placa: 'EE38537', sede: ' Técnicos ' }), 'Tecnicos');
  assert.equal(negocioLlanta({ placa: 'C12345', sede: 'Tecnicos' }), 'Tecnicos');
});
test('conserva la clasificacion de las otras sedes y placas', () => {
  assert.equal(negocioLlanta({ placa: 'EE12345', sede: 'Transportadora' }), 'Transportadora');
  assert.equal(negocioLlanta({ placa: 'C12345', sede: 'granel_cartago' }), 'Granel');
  assert.equal(negocioLlanta({ placa: 'C12345', sede: 'Cartago' }), 'Cilindros');
  assert.equal(negocioLlanta({ placa: 'C12345', sede: 'Taller' }), 'Otros');
});
