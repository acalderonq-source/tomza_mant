const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  correoValido,
  agruparFacturasPorProveedor,
  construirCorreoPago
} = require("../src/utils/pagoProveedorCorreo");

test("el correo del proveedor valida una sola dirección por campo", () => {
  assert.equal(correoValido("pagos@proveedor.cr"), true);
  assert.equal(correoValido("pagos@proveedor.cr, otro@proveedor.cr"), false);
  assert.equal(correoValido("sin-arroba"), false);
});

test("el pago múltiple separa facturas y contactos por proveedor", () => {
  const grupos = agruparFacturasPorProveedor([
    { proveedor_id: 8, proveedor_nombre: "Proveedor A", proveedor_email: "pagos@a.cr", factura: "A-1", total: 100 },
    { proveedor_id: 8, proveedor_nombre: "Proveedor A", proveedor_email: "pagos@a.cr", factura: "A-2", total: 50 },
    { proveedor_id: 9, proveedor_nombre: "Proveedor B", proveedor_email: "pagos@b.cr", factura: "B-1", total: 200 }
  ]);

  assert.equal(grupos.length, 2);
  assert.deepEqual(grupos.map(grupo => grupo.facturas.map(factura => factura.factura)), [["A-1", "A-2"], ["B-1"]]);
  assert.deepEqual(grupos.map(grupo => grupo.proveedor_email), ["pagos@a.cr", "pagos@b.cr"]);
});

test("el mensaje resume solo las facturas del proveedor y escapa datos externos", () => {
  const correo = construirCorreoPago({
    proveedor: "Proveedor <Uno>",
    facturas: [{ factura: "F-1", monto_pago: 1250 }],
    reciboNumero: "RP-20261012-123456",
    fechaPago: "2026-10-12",
    totalPagado: 1250,
    tipoPago: "abono",
    comprobanteNumero: "TR-98"
  });

  assert.match(correo.subject, /Proveedor <Uno>/);
  assert.match(correo.html, /Proveedor &lt;Uno&gt;/);
  assert.match(correo.html, /F-1/);
  assert.match(correo.html, /TR-98/);
  assert.doesNotMatch(correo.html, /otra factura/);
});
