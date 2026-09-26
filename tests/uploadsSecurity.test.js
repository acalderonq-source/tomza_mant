const test = require("node:test");
const assert = require("node:assert/strict");
const { canViewUploads, isSafeUploadPath } = require("../src/routes/uploads.routes");

test("private uploads require a business role", () => {
  assert.equal(canViewUploads(null), false);
  assert.equal(canViewUploads({ rol: "MECANICO" }), false);
  assert.equal(canViewUploads({ rol: "CONTABILIDAD" }), true);
  assert.equal(canViewUploads({ rol: "admin" }), true);
});

test("private uploads accept only invoice and quotation filenames", () => {
  assert.equal(isSafeUploadPath("/facturas/recibo-01.pdf"), true);
  assert.equal(isSafeUploadPath("/cotizaciones/orden_1.jpg"), true);
  assert.equal(isSafeUploadPath("/facturas/../secret.pdf"), false);
  assert.equal(isSafeUploadPath("/public/secret.pdf"), false);
  assert.equal(isSafeUploadPath("/facturas/a/b.pdf"), false);
});
