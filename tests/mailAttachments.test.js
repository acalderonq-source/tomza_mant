const { test } = require("node:test");
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");

test("el servicio de correo permite CC y adjuntar PDF/comprobante", async t => {
  const originalCreateTransport = nodemailer.createTransport;
  let mensaje;
  nodemailer.createTransport = () => ({ sendMail: async options => { mensaje = options; } });
  const modulePath = require.resolve("../src/utils/mail");
  delete require.cache[modulePath];
  const enviarCorreo = require("../src/utils/mail");
  t.after(() => {
    nodemailer.createTransport = originalCreateTransport;
    delete require.cache[modulePath];
  });

  const attachments = [
    { filename: "colilla.pdf", content: Buffer.from("pdf") },
    { filename: "comprobante.jpg", path: "C:/uploads/comprobante.jpg" }
  ];
  await enviarCorreo("proveedor@tomza.test", "Pago", "Detalle", {
    cc: ["contabilidad@tomza.test", "proveeduria@tomza.test", "taller@tomza.test"],
    attachments
  });

  assert.equal(mensaje.to, "proveedor@tomza.test");
  assert.deepEqual(mensaje.cc, ["contabilidad@tomza.test", "proveeduria@tomza.test", "taller@tomza.test"]);
  assert.deepEqual(mensaje.attachments, attachments);
});
