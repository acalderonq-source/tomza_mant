const assert = require("node:assert/strict");
const express = require("express");
const ejs = require("ejs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright");

async function main() {
  const app = express();
  const unidades = [
    { id: 1, placa: "C164528", sede: "granel_la_cruz", marca: "Hino", modelo: "500" },
    { id: 2, placa: "C164529", sede: "La Cruz", marca: "Hino", modelo: "300" }
  ];
  app.get("/bodega/api/placas", (req, res) => {
    const q = String(req.query.q || "").toUpperCase();
    res.json(unidades.filter(unidad => unidad.placa.includes(q)));
  });
  app.get("/bodega/entregas", async (_req, res) => {
    const articulo = { id: 1, codigo_taller: "0001", nombre: "Filtro", stock_actual: 5, unidad_medida: "UND" };
    const html = await ejs.renderFile(path.join(__dirname, "../src/views/bodega.ejs"), {
      user: { usuario: "bodeguero", rol: "BODEGUERO" },
      q: "", origen: "", articulos: [articulo], proveedores: [], articulosCompatibilidad: [],
      articulosEntrega: [articulo], compatibilidades: [], articulosSinCompatibilidad: [],
      unidadesSinFicha: 0, porComprar: [], suministros: [], movimientos: [], prestamos: [],
      stats: { articulos: 1, stock_bajo: 0, agotados: 0, valor_total: 0, propios: 1,
        valor_propio: 0, consignacion: 0, valor_consignacion: 0, suministros: 0,
        movimientos_hoy: 0, herramientas_prestadas: 0 },
      tiposArticulo: [], tiposTrabajo: ["MANTENIMIENTO"], origenesInventario: [],
      proveedorConsignacionDefault: "MAXI REPUESTOS", proximoCodigoTaller: "0002",
      pagina: "entregas", puedeAjustar: false, success: "", error: ""
    });
    res.send(html);
  });
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/bodega/entregas`);
    assert.equal(await page.locator(".placa-picker").count(), 4);

    const input = page.locator("#placa-entrega");
    await input.fill("C1645");
    await page.locator("#placa-entrega + .placa-options .placa-option").first().waitFor();
    assert.equal(await page.locator("#placa-entrega + .placa-options .placa-option").count(), 2);
    await page.screenshot({ path: path.join(os.tmpdir(), "bodega-placas-desktop.png") });
    await page.locator("#placa-entrega + .placa-options .placa-option").first().click();
    assert.equal(await input.inputValue(), "C164528");
    assert.equal(await input.evaluate(element => element.validity.valid), true);

    await input.fill("C16452X");
    await page.locator("#placa-entrega + .placa-options .placa-empty").waitFor();
    assert.equal(await input.evaluate(element => element.validity.valid), false);

    await page.setViewportSize({ width: 390, height: 844 });
    await input.fill("C1645");
    await page.locator("#placa-entrega + .placa-options .placa-option").first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(os.tmpdir(), "bodega-placas-mobile.png") });
    await input.press("ArrowDown");
    await input.press("Enter");
    assert.equal(await input.inputValue(), "C164528");
    assert.deepEqual(errors, []);
    console.log("Bodega plate picker OK: desktop, mobile, typo rejection and keyboard selection.");
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
