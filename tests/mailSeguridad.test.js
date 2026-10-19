const { test } = require('node:test');
const assert = require('node:assert/strict');
const mail = require('../src/utils/mail');
test('seguridad exige su propio usuario y contrasena, sin mezclar credenciales generales', t => {
  const valores = { APP_ENV:'test', MAIL_ENABLED:'true', EMAIL_USER:'general@example.invalid', EMAIL_PASS:'general-test',
    EMAIL_USER_FACTURAS:'facturas@example.invalid', EMAIL_PASS_FACTURAS:'facturas-test',
    EMAIL_USER_SEGURIDAD:undefined, EMAIL_PASS_SEGURIDAD:undefined };
  const anteriores = Object.fromEntries(Object.keys(valores).map(key=>[key,process.env[key]]));
  t.after(()=>{for(const [key,value] of Object.entries(anteriores)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  for(const [key,value] of Object.entries(valores)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  assert.equal(mail.estaConfigurado('seguridad'),false);
  assert.equal(mail.obtenerRemitente('seguridad'),'');
  process.env.EMAIL_USER_SEGURIDAD='seguridad@example.invalid';
  assert.equal(mail.estaConfigurado('seguridad'),false,'no utiliza la contrasena general');
  process.env.EMAIL_PASS_SEGURIDAD='seguridad-test';
  assert.equal(mail.estaConfigurado('seguridad'),true);
  assert.equal(mail.obtenerRemitente('seguridad'),'seguridad@example.invalid');
  delete process.env.EMAIL_USER_SEGURIDAD;
  assert.equal(mail.estaConfigurado('seguridad'),false,'no utiliza el usuario general');
  assert.equal(mail.estaConfigurado('facturas'),true,'no altera el perfil de facturas');
});
