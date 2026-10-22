const test = require('node:test');
const assert = require('node:assert/strict');
const { revisarExistencias } = require('../src/utils/solicitudExistencias');

test('verifica cantidades completas, parciales y sin stock sin confiar en el stock del formulario', () => {
  const lineas = [{ codigo: 'A', cantidad: 5, existencia: 999 }, { codigo: 'B', cantidad: 3 }];
  const revision = revisarExistencias(lineas, [{ codigo: 'A', cantidad: '2.125' }, { codigo: 'B', cantidad: -1 }]);
  assert.equal(revision.estado, 'PARCIAL');
  assert.deepEqual(revision.lineas.map(l => [l.disponible, l.faltante]), [[2.125, 2.875], [0, 3]]);
  assert.equal(revisarExistencias(lineas, []).estado, 'SIN_EXISTENCIAS');
  assert.equal(revisarExistencias(lineas, [{ codigo: 'A', cantidad: 5 }, { codigo: 'B', cantidad: 3 }]).estado, 'COMPLETA');
});

test('los artículos de compra por solicitud siempre se consideran faltantes aunque exista un código igual en stock', () => {
  const r = revisarExistencias([{ codigo: 'A', cantidad: 1, inventariable: false }], [{ codigo: 'A', cantidad: 99 }]);
  assert.equal(r.estado, 'SIN_EXISTENCIAS');
  assert.equal(r.lineas[0].faltante, 1);
});
