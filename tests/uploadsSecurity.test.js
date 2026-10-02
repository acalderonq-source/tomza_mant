const test = require("node:test");
const assert = require("node:assert/strict");
const { canViewUploads, isSafeUploadPath } = require("../src/routes/uploads.routes");

test("private uploads require a business role", () => {
  const factura = "/facturas/recibo-01.pdf";
  assert.equal(canViewUploads(null, factura), false);
  assert.equal(canViewUploads({ rol: "MECANICO", departamentoActivo: "TALLER" }, factura), false);
  assert.equal(canViewUploads({ rol: "admin", departamentoActivo: "TALLER" }, factura), true);
  assert.equal(canViewUploads({ rol: "ADMIN", departamentoActivo: "OPERACIONES" }, factura), false);
});

test("adjuntos de compras respetan los departamentos y roles de sus pantallas", () => {
  assert.equal(canViewUploads({ rol: "CONTABILIDAD", departamentoActivo: "CONTABILIDAD" }, "/facturas/f-01.xml"), true);
  assert.equal(canViewUploads({ rol: "CONTABILIDAD", departamentoActivo: "CONTABILIDAD" }, "/cotizaciones/c-01.pdf"), true);
  assert.equal(canViewUploads({ rol: "PROVEEDURIA_TALLER", departamentoActivo: "PROVEEDURIA" }, "/cotizaciones/c-01.pdf"), true);
  assert.equal(canViewUploads({ rol: "BODEGUERO", departamentoActivo: "PROVEEDURIA" }, "/cotizaciones/c-01.pdf"), true);
  assert.equal(canViewUploads({ rol: "BODEGUERO", departamentoActivo: "PROVEEDURIA" }, "/facturas/f-01.pdf"), false);
  assert.equal(canViewUploads({ rol: "CONTABILIDAD", departamentoActivo: "OPERACIONES" }, "/facturas/f-01.pdf"), false);
});

test("private uploads accept only invoice and quotation filenames", () => {
  assert.equal(isSafeUploadPath("/facturas/recibo-01.pdf"), true);
  assert.equal(isSafeUploadPath("/cotizaciones/orden_1.jpg"), true);
  assert.equal(isSafeUploadPath("/facturas/../secret.pdf"), false);
  assert.equal(isSafeUploadPath("/public/secret.pdf"), false);
  assert.equal(isSafeUploadPath("/facturas/a/b.pdf"), false);
  assert.equal(canViewUploads({ rol: "ADMIN", departamentoActivo: "TALLER" }, "/facturas/../secret.pdf"), false);
});
