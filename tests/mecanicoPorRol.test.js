const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { esUsuarioMecanico } = require('../src/utils/sedes');
const { departamentosInicialesPorRol } = require('../src/utils/departamentos');

test('el acceso de mecánico depende del rol y no del nombre de usuario', () => {
  assert.equal(esUsuarioMecanico({ rol: 'MECANICO', usuario: 'juan' }), true);
  assert.equal(esUsuarioMecanico({ rol: 'TALLER', usuario: 'mecanico_falso' }), false);
  assert.deepEqual(departamentosInicialesPorRol('CONTABILIDAD', 'mecanico_falso'), ['CONTABILIDAD']);
});

test('la migración asigna el rol MECANICO a las cuentas que antes se limitaban por nombre', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '202610210003_mecanicos_por_rol.sql'), 'utf8');
  assert.match(sql, /SET rol = 'MECANICO'/);
  assert.match(sql, /LIKE 'mecanico%'/);
});
