const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { listarMecanicos, mecanicoValido, SEDES_BODEGA } = require('../src/utils/bodegaMecanicos');

const db = { query: async (sql, params) => {
  assert.match(sql, /u\.rol = 'MECANICO'/);
  assert.match(sql, /u\.sede IN \(\?\)/);
  const permitidas = params[0];
  return [[
    { nombre: 'Rojas  Mora Luis', sede: 'Cartago' },
    { nombre: 'Rojas Mora Luis', sede: 'Transportadora' },
    { nombre: 'Arias Vega Ana', sede: 'Transportadora' },
    { nombre: 'Solano Cedi Pedro', sede: 'Alajuela' }
  ].filter(r => permitidas.includes(r.sede))];
} };

test('solo salen los mecánicos de Cartago y Transportadora', () => {
  assert.deepEqual(SEDES_BODEGA, ['Cartago', 'Transportadora']);
});

test('la lista sale de las personas ligadas a cuentas de mecánico, sin repetir ni CEDIs', async () => {
  assert.deepEqual(await listarMecanicos(db), [
    { nombre: 'Arias Vega Ana', sedes: ['Transportadora'] },
    { nombre: 'Rojas Mora Luis', sedes: ['Cartago', 'Transportadora'] }
  ]);
});

test('solo acepta mecánicos de la lista', async () => {
  assert.equal((await mecanicoValido(db, 'Arias Vega Ana')).nombre, 'Arias Vega Ana');
  assert.equal(await mecanicoValido(db, 'Solano Cedi Pedro'), null, 'un mecánico de CEDI no se acepta');
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
