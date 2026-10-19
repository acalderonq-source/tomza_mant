const { test } = require('node:test');
const assert = require('node:assert/strict');
const outlook = require('../src/utils/seguridadOutlook');
test('Seguridad Outlook cifra cache, detecta manipulacion y exige cuenta autorizada',()=>{
  process.env.MS_SEGURIDAD_CLIENT_ID='test'; process.env.MS_SEGURIDAD_CLIENT_SECRET='secreto-prueba';
  process.env.EMAIL_USER_SEGURIDAD='gastomzasis@outlook.com';
  try {
    const encoded=outlook.cifrar('refresh-token-privado');
    assert.equal(encoded.includes('refresh-token'),false);
    assert.equal(outlook.descifrar(encoded),'refresh-token-privado');
    const parts=encoded.split('.'); parts[1]=Buffer.alloc(16).toString('base64');
    assert.throws(()=>outlook.descifrar(parts.join('.')));
    assert.throws(()=>outlook.validarCuenta('otra@outlook.com'),{code:'OUTLOOK_CUENTA_INCORRECTA'});
    outlook.validarCuenta('GASTOMZASIS@OUTLOOK.COM');
  } finally { delete process.env.MS_SEGURIDAD_CLIENT_ID; delete process.env.MS_SEGURIDAD_CLIENT_SECRET; delete process.env.EMAIL_USER_SEGURIDAD; }
});
test('Estado OAuth es de un solo uso, expira y rechaza callback ajeno',()=>{
  const session={seguridadOAuth:{state:'correcto',fecha:Date.now(),verifier:'pkce'}};
  assert.throws(()=>outlook.consumirEstado(session,'ajeno'),{code:'OUTLOOK_ESTADO_INVALIDO'});
  assert.equal(session.seguridadOAuth,undefined);
  assert.throws(()=>outlook.consumirEstado({seguridadOAuth:{state:'ok',fecha:Date.now()-600001}},'ok'));
  assert.equal(outlook.consumirEstado({seguridadOAuth:{state:'ok',fecha:Date.now(),verifier:'v'}},'ok').verifier,'v');
});
test('Sin conexion persistida no envia ni usa SMTP de otra persona',async()=>{
  let calls=0;
  await assert.rejects(outlook.enviar({query:async()=>[[]]},'a@tomza.com','Aviso','Hola',async()=>{calls++;}),{code:'OUTLOOK_NO_VINCULADO'});
  assert.equal(calls,0);
});
