const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { listarMecanicos, mecanicoValido } = require('../src/utils/bodegaMecanicos');

const db = { query: async sql => {
  assert.match(sql, /u\.rol = 'MECANICO'/);
  return [[
    { nombre: 'Rojas  Mora Luis', sede: 'Cartago' },
    { nombre: 'Rojas Mora Luis', sede: 'Transportadora' },
    { nombre: 'Arias Vega Ana', sede: 'Alajuela' }
  ]];
} };

test('la lista sale de las personas ligadas a cuentas de mecánico, sin repetir', async () => {
  assert.deepEqual(await listarMecanicos(db), [
    { nombre: 'Arias Vega Ana', sedes: ['Alajuela'] },
    { nombre: 'Rojas Mora Luis', sedes: ['Cartago', 'Transportadora'] }
  ]);
});

test('solo acepta mecánicos de la lista', async () => {
  assert.equal((await mecanicoValido(db, 'Arias Vega Ana')).nombre, 'Arias Vega Ana');
  assert.equal(await mecanicoValido(db, 'Alguien Inventado'), null);
  assert.equal(await mecanicoValido(db, ''), null);
});

test('el formulario de entrega usa una lista cerrada, sin campo de texto libre', () => {
  const vista = fs.readFileSync(path.join(__dirname, '../src/views/bodega.ejs'), 'utf8');
  assert.match(vista, /<select class="form-select" id="mecanico-entrega" name="mecanico" required>/);
  assert.doesNotMatch(vista, /<input[^>]*name="mecanico"/);
  const ruta = fs.readFileSync(path.join(__dirname, '../src/routes/bodega.routes.js'), 'utf8');
  assert.match(ruta, /mecanicoValido\(conn, mecanico\)/);
});
