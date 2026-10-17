const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verificarEntorno } = require('../src/utils/entornoEmpresa');
const { consultar, expediente } = require('../src/utils/controlEmpresa');
const { auditarOrden } = require('../src/utils/auditoriaOrdenes');
test('staging rechaza base incorrecta, correo activo y respaldo productivo', () => {
  const base = { APP_ENV: 'staging', STAGING_DATABASE_NAME: 'pruebas', MYSQLDATABASE: 'pruebas', PRODUCTION_DATABASE_NAME: 'productiva', MAIL_ENABLED: 'false' };
  assert.doesNotThrow(() => verificarEntorno(base));
  for (const cambios of [{ MYSQLDATABASE: 'productiva' }, { MAIL_ENABLED: 'true' }, { BACKUP_ENABLED: 'true' }]) assert.throws(() => verificarEntorno({ ...base, ...cambios }));
});
test('no oculta error de una fuente como historial vacio', async () => {
  const result = await consultar({ query: async () => { throw Error('DB'); } }, 'SELECT 1');
  assert.ok(result.error); assert.deepEqual(result.filas, []);
});
test('expediente usa parametros de placa e ID y limita cada fuente', async () => {
  const consultas = [];
  const db = { query: async (sql, params) => {
    consultas.push({ sql, params });
    return [sql.includes('FROM unidades WHERE') ? [{ id: 9, placa: 'C12345' }] : []];
  } };
  const result = await expediente(db, 'C12345');
  assert.equal(result.secciones.length, 8);
  assert.ok(consultas.every(c => c.sql.includes('LIMIT')));
  assert.ok(consultas.every(c => c.params[0] === 9 || c.params[0] === 'C12345'));
});
test('bitacora guarda antes y despues en la conexion entregada y propaga fallos', async () => {
  let values;
  await auditarOrden({ query: async (_sql, params) => { values = params; } }, { id: 3, nombre: 'Persona' }, 5, { total: 1 }, { total: 2 });
  assert.equal(values[2], 5); assert.equal(values[5], '{"total":1}'); assert.equal(values[6], '{"total":2}'); assert.equal(values[8], 'Persona');
  await assert.rejects(auditarOrden({ query: async () => { throw Error('fallo'); } }, { id: 3 }, 5, null, { total: 2 }));
});
