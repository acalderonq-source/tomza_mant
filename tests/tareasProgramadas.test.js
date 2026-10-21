const test = require('node:test');
const assert = require('node:assert/strict');
const { tareaSinEncimar } = require('../src/utils/tareaUnica');

const silencioso = { warn: () => {}, error: () => {} };

test('una tarea lenta no se encima con la siguiente vuelta', async () => {
  let liberar;
  let llamadas = 0;
  const tarea = tareaSinEncimar('prueba', () => { llamadas += 1; return new Promise(r => { liberar = r; }); }, { log: silencioso });
  const primera = tarea();
  const segunda = await tarea();
  assert.equal(segunda.omitida, true);
  liberar('ok');
  assert.deepEqual(await primera, { omitida: false, resultado: 'ok' });
  const tercera = tarea(); liberar('ok'); await tercera;
  assert.equal(llamadas, 2);
});

test('un error en la tarea se registra y no bloquea la siguiente vuelta', async () => {
  let falla = true;
  const tarea = tareaSinEncimar('prueba', async () => { if (falla) throw new Error('caída'); return 1; }, { log: silencioso });
  const resultado = await tarea();
  assert.equal(resultado.error.message, 'caída');
  falla = false;
  assert.equal((await tarea()).resultado, 1);
});

test('un recordatorio MINAE que falla no impide enviar los demás', async () => {
  const cronPath = require.resolve('node-cron');
  require.cache[cronPath] = { id: cronPath, filename: cronPath, loaded: true, exports: { schedule: () => {} } };
  for (const modulo of ['../src/db', '../src/utils/emailService', '../src/utils/proveedorHaciendaPendientes', '../src/routes/facturasCorreo.routes', '../src/utils/portalCruceAutomatico']) {
    const ruta = require.resolve(modulo);
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: {} };
  }
  const { revisarRecordatoriosMinae } = require('../src/cronJobs');
  const actualizados = [];
  const db = {
    query: async (sql, params) => {
      if (/^SELECT/.test(sql.trim())) return [[{ id: 1, fecha_cita: '2026-11-05' }, { id: 2, fecha_cita: '2026-11-05' }, { id: 3, fecha_cita: '2026-11-05' }]];
      actualizados.push(params[0]);
      return [{ affectedRows: 1 }];
    }
  };
  const enviar = async cita => { if (cita.id === 2) throw new Error('SMTP caído'); };
  const errorOriginal = console.error; const logOriginal = console.log;
  console.error = () => {}; console.log = () => {};
  try {
    const resultado = await revisarRecordatoriosMinae(db, enviar, new Date('2026-10-21T12:00:00'));
    assert.deepEqual(resultado[15], { enviados: 2, fallidos: 1 });
    assert.deepEqual(resultado[2], { enviados: 2, fallidos: 1 });
  } finally {
    console.error = errorOriginal; console.log = logOriginal;
  }
  assert.deepEqual(actualizados, [1, 3, 1, 3]);
});
