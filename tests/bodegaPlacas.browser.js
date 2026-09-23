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
  app.get("/bodega/:pagina", async (req, res) => {
    const articulo = { id: 1, codigo_taller: "0001", codigo: "PROV-77", nombre: "Filtro", stock_actual: 5, unidad_medida: "UND", grupo_bodega: "SUMINISTRO", origen_inventario: "PROPIO" };
    const proveedoresConsignacion = [
      { proveedor: "MAXI REPUESTOS", total_articulos: 1 },
      { proveedor: "CONSIGNACION BATERIAS", total_articulos: 1 }
    ];
    const consignados = [
      { id: 2, codigo_taller: "0002", codigo: "MAX-1", nombre: "Retenedor", stock_actual: 2, unidad_medida: "UND", origen_inventario: "CONSIGNACION", proveedor_consignacion: "MAXI REPUESTOS" },
      { id: 3, codigo_taller: "0003", codigo: "BAT-1", nombre: "Batería", stock_actual: 4, unidad_medida: "UND", origen_inventario: "CONSIGNACION", proveedor_consignacion: "CONSIGNACION BATERIAS" }
    ];
    const proveedor = proveedoresConsignacion.find(item => item.proveedor === req.query.proveedor)?.proveedor || "";
    const html = await ejs.renderFile(path.join(__dirname, "../src/views/bodega.ejs"), {
      user: { usuario: "bodeguero", rol: "BODEGUERO" },
      q: "", origen: "", grupo: req.query.grupo || "", articulos: [articulo], proveedores: [], articulosCompatibilidad: [],
      articulosEntrega: [articulo], articulosConsignacion: proveedor ? consignados.filter(item => item.proveedor_consignacion === proveedor) : consignados,
      proveedoresConsignacion, proveedorConsignacionSeleccionado: proveedor, compatibilidades: [], articulosSinCompatibilidad: [],
      unidadesSinFicha: 0, porComprar: [], suministros: [], movimientos: [], prestamos: [],
      stats: { articulos: 1, stock_bajo: 0, agotados: 0, valor_total: 0, propios: 1,
        valor_propio: 0, consignacion: 0, valor_consignacion: 0, suministros: 0,
        movimientos_hoy: 0, herramientas_prestadas: 0 },
      tiposArticulo: [], tiposTrabajo: ["MANTENIMIENTO"], origenesInventario: [],
      proveedorConsignacionDefault: "MAXI REPUESTOS", proximoCodigoTaller: "0002",
      pagina: req.params.pagina, puedeAjustar: false, success: "", error: ""
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
    const base = `http://127.0.0.1:${server.address().port}`;
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/bodega/entregas`);
    assert.equal(await page.locator(".placa-picker").count(), 4);
    assert.equal(await page.locator('#form-entrega [name="tipo_trabajo"]').count(), 0);
    assert.match(await page.locator('#form-entrega [name="articulo_id"] option[value="1"]').textContent(), /Prov\. PROV-77/);
    assert.match(await page.evaluate(() => document.getElementById('linea-template').content.querySelector('[name="articulo_id"] option[value="1"]').textContent), /Prov\. PROV-77/);
    await page.locator('#form-entrega [name="articulo_id"]').selectOption('1');
    assert.match(await page.locator('#form-entrega .articulo-search-status').first().textContent(), /Código proveedor: PROV-77/);

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

    await page.goto(`${base}/bodega/consignacion`);
    assert.equal(await page.locator('.module-tabs a[href="/bodega/suministros"]').count(), 0);
    assert.equal(await page.locator('#consignacion .panel-body a').count(), 3);
    assert.equal(await page.locator('#consignacion tbody tr').count(), 2);
    await page.getByRole('link', { name: 'CONSIGNACION BATERIAS (1)' }).click();
    assert.equal(await page.locator('#consignacion tbody tr').count(), 1);
    assert.match(await page.locator('#consignacion tbody').textContent(), /Batería/);
    assert.doesNotMatch(await page.locator('#consignacion tbody').textContent(), /Retenedor/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#consignacion').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(os.tmpdir(), "bodega-consignacion-mobile.png") });

    await page.goto(`${base}/bodega/inventario?grupo=SUMINISTRO`);
    assert.equal(await page.locator('select[name="grupo"]').inputValue(), 'SUMINISTRO');
    assert.match(await page.locator('#inventario tbody').textContent(), /Suministro/);
    console.log("Bodega UI OK: plates, supplier tabs, inventory group and mobile layout.");
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
