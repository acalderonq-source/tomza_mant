const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const originalUploadRoot = process.env.UPLOAD_ROOT;
const temporaryUploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tomza-uploads-test-"));
process.env.UPLOAD_ROOT = temporaryUploadRoot;
const { canViewUploads, isSafeUploadPath } = require("../src/routes/uploads.routes");

fs.mkdirSync(path.join(temporaryUploadRoot, "facturas"), { recursive: true });
fs.mkdirSync(path.join(temporaryUploadRoot, "cotizaciones"), { recursive: true });
fs.writeFileSync(path.join(temporaryUploadRoot, "facturas", "factura.pdf"), "documento de prueba");
fs.writeFileSync(path.join(temporaryUploadRoot, "cotizaciones", "cotizacion.pdf"), "cotizacion de prueba");

async function withUploadServer(run) {
  const app = express();
  app.use((req, _res, next) => {
    const role = req.get("x-test-role");
    req.session = role
      ? { user: { rol: role, departamentoActivo: req.get("x-test-department") } }
      : {};
    next();
  });
  app.use("/uploads", require("../src/routes/uploads.routes"));

  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test.after(() => {
  fs.rmSync(temporaryUploadRoot, { recursive: true, force: true });
  if (originalUploadRoot === undefined) delete process.env.UPLOAD_ROOT;
  else process.env.UPLOAD_ROOT = originalUploadRoot;
});

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

test("la ruta HTTP entrega solo adjuntos autorizados por departamento y rol", async () => {
  await withUploadServer(async base => {
    const factura = await fetch(`${base}/uploads/facturas/factura.pdf`, {
      headers: { "x-test-role": "CONTABILIDAD", "x-test-department": "CONTABILIDAD" }
    });
    assert.equal(factura.status, 200);
    assert.equal(await factura.text(), "documento de prueba");
    assert.equal(factura.headers.get("cache-control"), "private, no-store");

    const cotizacion = await fetch(`${base}/uploads/cotizaciones/cotizacion.pdf`, {
      headers: { "x-test-role": "BODEGUERO", "x-test-department": "PROVEEDURIA" }
    });
    assert.equal(cotizacion.status, 200);
    assert.equal(await cotizacion.text(), "cotizacion de prueba");

    const bloqueado = await fetch(`${base}/uploads/facturas/factura.pdf`, {
      headers: { "x-test-role": "ADMIN", "x-test-department": "OPERACIONES" }
    });
    assert.equal(bloqueado.status, 403);

    const sinSesion = await fetch(`${base}/uploads/facturas/factura.pdf`);
    assert.equal(sinSesion.status, 401);
  });
});
