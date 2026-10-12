const { test } = require("node:test");
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");

test("el servicio de correo permite CC y adjuntar PDF/comprobante", async t => {
  const originalCreateTransport = nodemailer.createTransport;
  const variables = ["EMAIL_USER_FACTURAS", "EMAIL_PASS_FACTURAS", "EMAIL_HOST_FACTURAS", "EMAIL_PORT_FACTURAS", "EMAIL_USER_DEKRA", "EMAIL_PASS_DEKRA", "EMAIL_HOST_DEKRA", "EMAIL_PORT_DEKRA"];
  const originales = Object.fromEntries(variables.map(nombre => [nombre, process.env[nombre]]));
  Object.assign(process.env, {
    EMAIL_USER_FACTURAS: "facturas@tomza.test",
    EMAIL_PASS_FACTURAS: "facturas-secret",
    EMAIL_HOST_FACTURAS: "smtp.facturas.test",
    EMAIL_PORT_FACTURAS: "587",
    EMAIL_USER_DEKRA: "dekra@tomza.test",
    EMAIL_PASS_DEKRA: "dekra-secret",
    EMAIL_HOST_DEKRA: "smtp.dekra.test",
    EMAIL_PORT_DEKRA: "465"
  });
  const transportes = [];
  nodemailer.createTransport = config => {
    const transporte = { config, mensaje: null, sendMail: async options => { transporte.mensaje = options; } };
    transportes.push(transporte);
    return transporte;
  };
  const modulePath = require.resolve("../src/utils/mail");
  delete require.cache[modulePath];
  const enviarCorreo = require("../src/utils/mail");
  t.after(() => {
    nodemailer.createTransport = originalCreateTransport;
    for (const nombre of variables) {
      if (originales[nombre] === undefined) delete process.env[nombre];
      else process.env[nombre] = originales[nombre];
    }
    delete require.cache[modulePath];
  });

  const attachments = [
    { filename: "colilla.pdf", content: Buffer.from("pdf") },
    { filename: "comprobante.jpg", path: "C:/uploads/comprobante.jpg" }
  ];
  await enviarCorreo("proveedor@tomza.test", "Pago", "Detalle", {
    perfil: "facturas",
    replyTo: "emily@tomza.test",
    cc: ["contabilidad@tomza.test", "proveeduria@tomza.test", "taller@tomza.test"],
    attachments
  });
  await enviarCorreo("supervisor@tomza.test", "DEKRA", "Aviso", { perfil: "dekra" });

  const [transporteFacturas, transporteDekra] = transportes;
  const mensaje = transporteFacturas.mensaje;
  assert.equal(mensaje.to, "proveedor@tomza.test");
  assert.equal(mensaje.from, '"Sistema Taller Tomza" <facturas@tomza.test>');
  assert.equal(mensaje.replyTo, "emily@tomza.test");
  assert.deepEqual(mensaje.cc, ["contabilidad@tomza.test", "proveeduria@tomza.test", "taller@tomza.test"]);
  assert.deepEqual(mensaje.attachments, attachments);
  assert.equal(transporteFacturas.config.host, "smtp.facturas.test");
  assert.equal(transporteFacturas.config.auth.user, "facturas@tomza.test");
  assert.equal(transporteDekra.config.host, "smtp.dekra.test");
  assert.equal(transporteDekra.config.auth.user, "dekra@tomza.test");
  assert.equal(transporteDekra.mensaje.from, '"Sistema Taller Tomza" <dekra@tomza.test>');
});
