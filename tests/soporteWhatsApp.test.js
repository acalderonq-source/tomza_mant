const test = require('node:test');
const assert = require('node:assert/strict');
const { injectSupport } = require('../src/utils/soporteWhatsApp');
const { injectSecurityAssets } = require('../src/middleware/security');

test('soporte aparece una sola vez en paginas incluso sin token de sesion', () => {
  const page = '<html><head></head><body><form method="post"></form></body></html>';
  const html = injectSecurityAssets(page, null);
  assert.match(html, /https:\/\/wa.me\/50661531228\?text=/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /soporte-whatsapp.css/);
  assert.equal((injectSupport(html).match(/id="tomza-soporte"/g) || []).length, 1);
  assert.match(injectSecurityAssets(page, 'token'), /name="_csrf"/);
});

test('soporte no altera respuestas no HTML o fragmentos', () => {
  for (const value of [null, undefined, Buffer.from('pdf'), '{"ok":true}', '<div>Fragmento</div>']) {
    assert.equal(injectSupport(value), value);
  }
});
