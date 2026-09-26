const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { parseXmlInvoice, encryptCache, decryptCache } = require("../src/routes/facturasCorreo.routes");

test("parseXmlInvoice extracts Costa Rican electronic invoice identifiers and total", () => {
  const xml = `<?xml version="1.0"?><FacturaElectronica xmlns="urn:example">
    <Clave>50626092600310123456700100001010000012345123456789</Clave>
    <NumeroConsecutivo>00100001010000012345</NumeroConsecutivo>
    <FechaEmision>2026-09-26T10:15:00-06:00</FechaEmision>
    <Emisor><Nombre>Proveedor de Prueba</Nombre></Emisor>
    <ResumenFactura><TotalComprobante>12345.67</TotalComprobante></ResumenFactura>
  </FacturaElectronica>`;
  const invoice = parseXmlInvoice(xml);
  assert.equal(invoice.clave, "50626092600310123456700100001010000012345123456789");
  assert.equal(invoice.consecutivo, "00100001010000012345");
  assert.equal(invoice.emisor, "Proveedor de Prueba");
  assert.equal(invoice.monto, 12345.67);
  assert.equal(invoice.fecha, "2026-09-26 16:15:00");
});

test("Microsoft token cache encryption authenticates and round-trips", () => {
  const originalKey = process.env.MAIL_TOKEN_ENCRYPTION_KEY;
  process.env.MAIL_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  try {
    const cache = JSON.stringify({ accessToken: "private-test-value" });
    const encrypted = encryptCache(cache);
    assert.notEqual(encrypted, cache);
    assert.equal(decryptCache(encrypted), cache);
    assert.throws(() => decryptCache(`${encrypted.slice(0, -3)}abc`));
  } finally {
    if (originalKey === undefined) delete process.env.MAIL_TOKEN_ENCRYPTION_KEY;
    else process.env.MAIL_TOKEN_ENCRYPTION_KEY = originalKey;
  }
});
