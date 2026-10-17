const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { plan } = require('../src/scripts/planMigraciones');
test('plan de migraciones detecta pendiente y checksum alterado sin escribir DB', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tomza-migration-plan-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const content = 'SELECT 1;';
  for (const name of ['aplicada.sql', 'cambiada.sql', 'pendiente.sql']) await fs.writeFile(path.join(directory, name), content);
  const db = { query: async sql => {
    assert.ok(sql.startsWith('SELECT'));
    if (sql.includes('INFORMATION_SCHEMA')) return [[{ TABLE_NAME: 'schema_migrations' }]];
    return [[{ filename: 'aplicada.sql', checksum: crypto.createHash('sha256').update(content).digest('hex') }, { filename: 'cambiada.sql', checksum: 'incorrecto' }]];
  } };
  assert.deepEqual((await plan(db, directory)).map(r => r.estado), ['APLICADA', 'CHECKSUM_DIFERENTE', 'PENDIENTE']);
});
test('staging no puede enviar SMTP aunque existan credenciales configuradas', async t => {
  const antes = process.env.APP_ENV;
  process.env.APP_ENV = 'staging';
  t.after(() => { if (antes == null) delete process.env.APP_ENV; else process.env.APP_ENV = antes; });
  const mail = require('../src/utils/mail');
  assert.equal(mail.estaConfigurado('facturas'), false);
  await assert.rejects(mail('nadie@example.invalid', 'Prueba', 'No enviar'), { code: 'MAIL_DISABLED' });
});
