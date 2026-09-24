const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const express = require("express");
const ejs = require("ejs");
const { chromium } = require("playwright");

async function main() {
  const app = express();
  app.get("/compras/facturas/asientos", async (_req, res) => {
    const html = await ejs.renderFile(path.join(__dirname, "../src/views/compras/asientos_pasivos.ejs"), {
      user: { usuario: "admin", rol: "ADMIN" },
      facturas: [
        { id: 1, tipo: "orden", fecha: new Date("2026-09-22T12:00:00Z"), po_numero: "2026-100", numero_factura: "001001", proveedor_nombre: "Proveedor Uno", placa_recepcion: "C164528", sede_recepcion: "Cartago", negocio_recepcion: "Cilindrero", monto: 1250, nota_credito_monto: 0, fecha_vencimiento_factura: new Date("2026-10-22T12:00:00Z") },
        { id: 2, tipo: "independiente", fecha: new Date("2026-09-21T12:00:00Z"), numero_factura: "001002", proveedor_nombre: "Proveedor Dos", monto: 300, nota_credito_monto: 0, lote_asiento_id: 4 }
      ],
      proveedores: [{ id: 1, nombre: "Proveedor Uno" }],
      filtros: { proveedor_id: "", fecha_desde: "", fecha_hasta: "", q: "", estado: "todos" },
      historial: [{ id: 4, creado_en: new Date("2026-09-22T12:00:00Z"), creado_por_usuario: "admin", cantidad_facturas: 1, monto_total: 300 }],
      paginaHistorial: 1, totalPaginas: 1, totalHistorial: 1, descargarCreado: null,
      plantillaDisponible: true, success: "", error: "",
      montoAsientoFactura: factura => Number(factura.monto) - Number(factura.nota_credito_monto || 0)
    });
    res.send(html);
  });
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/compras/facturas/asientos`);
    assert.equal(await page.locator('.factura-check').count(), 2);
    assert.deepEqual(await page.locator('.table-facturas thead th').allTextContents(), ['', 'PO Número', 'Proveedor', 'Fecha', 'Recepción', 'N° Factura', 'Factura electrónica', 'Monto', 'Fecha Vencimiento', 'Estado', 'Acciones']);
    assert.match(await page.locator('.table-facturas tbody tr').first().textContent(), /Cilindrero/);
    assert.match(await page.locator('.table-facturas tbody tr').first().textContent(), /Sin cruce/);
    assert.equal(await page.locator('.factura-check:not(:disabled)').count(), 1);
    assert.equal(await page.locator('#generar-asiento').isDisabled(), true);
    await page.locator('.factura-check:not(:disabled)').check();
    assert.equal(await page.locator('#generar-asiento').isEnabled(), true);
    assert.equal(await page.locator('#cantidad-seleccionada').textContent(), '1');
    assert.match(await page.locator('#monto-seleccionado').textContent(), /1.250,00/);
    assert.equal(await page.getByRole('link', { name: '#4' }).count(), 2);
    await page.screenshot({ path: path.join(os.tmpdir(), "asientos-pasivos-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(os.tmpdir(), "asientos-pasivos-mobile.png"), fullPage: true });
    assert.deepEqual(errors, []);
    console.log("Asientos UI OK: selection, included invoices, history and mobile layout.");
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
