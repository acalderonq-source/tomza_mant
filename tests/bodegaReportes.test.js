const { test } = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const express = require("express");
const pool = require("../src/db");
const router = require("../src/routes/bodega.routes");
const { defaultPeriod, reportPeriod, consumption, inventoryXlsx, consignmentXlsx, ownInventoryPdf } = require("../src/utils/bodegaReportes");

const article = {
  id: 7, codigo_taller: "0007", codigo: "PR-007", nombre: "Filtro de aceite",
  origen_inventario: "PROPIO", grupo_bodega: "SUMINISTRO", unidad_medida: "UND",
  stock_actual: 5, stock_minimo: 2, stock_maximo: 10, precio_unitario: 100,
  proveedor_nombre: "Proveedor", ubicacion: "A-02"
};

test("report dates default to Monday-Sunday and reject invalid ranges", () => {
  assert.deepEqual(defaultPeriod("2026-09-23"), { desde: "2026-09-21", hasta: "2026-09-27" });
  assert.deepEqual(reportPeriod({}, "2026-09-23"), { desde: "2026-09-21", hasta: "2026-09-27" });
  assert.throws(() => reportPeriod({ fecha_desde: "2026-02-30", fecha_hasta: "2026-03-02" }, "2026-09-23"));
  assert.throws(() => reportPeriod({ fecha_desde: "2026-09-27", fecha_hasta: "2026-09-21" }, "2026-09-23"));
});

test("consignment consumption uses dispatch prices and subtracts returns", async () => {
  const movements = [
    { articulo_id: 7, codigo_taller: "0007", codigo: "PR-007", nombre: "Filtro de aceite", proveedor: "MAXI", unidad_medida: "UND", tipo_movimiento: "SALIDA", cantidad: 2, precio_unitario: 100, precio_actual: 110 },
    { articulo_id: 7, codigo_taller: "0007", codigo: "PR-007", nombre: "Filtro de aceite", proveedor: "MAXI", unidad_medida: "UND", tipo_movimiento: "SALIDA", cantidad: 2, precio_unitario: 120, precio_actual: 110 },
    { articulo_id: 7, codigo_taller: "0007", codigo: "PR-007", nombre: "Filtro de aceite", proveedor: "MAXI", unidad_medida: "UND", tipo_movimiento: "DEVOLUCION", cantidad: 1, precio_unitario: 0, precio_actual: 110 }
  ];
  const data = consumption(movements);
  assert.equal(data.summary[0].cantidad_neta, 3);
  assert.equal(data.summary[0].costo_salidas, 440);
  assert.equal(data.summary[0].costo_devoluciones, 110);
  assert.equal(data.total, 330);
  assert.equal(data.summary[0].precio_estimado, true);

  const period = { desde: "2026-09-21", hasta: "2026-09-27" };
  const excel = new ExcelJS.Workbook();
  await excel.xlsx.load(await consignmentXlsx(data, period, "MAXI"));
  assert.equal(excel.getWorksheet("Resumen semanal").getCell("C5").value, "PR-007");
  assert.equal(excel.getWorksheet("Resumen semanal").getCell("K5").value, 330);
  assert.equal(excel.getWorksheet("Movimientos").rowCount, 7);
  assert.match(excel.getWorksheet("Resumen semanal").getCell("A3").value, /devoluciones valoradas/);
});

test("inventory download keeps all codes and expected quantities; own PDF includes costs", async () => {
  const excel = new ExcelJS.Workbook();
  await excel.xlsx.load(await inventoryXlsx([article], "SUMINISTRO"));
  const row = excel.getWorksheet("Inventario").getRow(5);
  assert.equal(row.getCell(1).value, "0007");
  assert.equal(row.getCell(2).value, "PR-007");
  assert.equal(row.getCell(9).value, 5);
  assert.equal(row.getCell(13).value, 500);
  assert.equal(row.getCell(14).value, null);
  assert.match(row.getCell(15).value.formula, /N5-I5/);

  const pdf = await ownInventoryPdf([article], consumption([]), { desde: "2026-09-21", hasta: "2026-09-27" });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 2000);
});

test("download routes enforce Bodega role and include all inventory without screen limit", async () => {
  const originalQuery = pool.query;
  const queries = [];
  pool.query = async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes("INFORMATION_SCHEMA.COLUMNS") || sql.includes("INFORMATION_SCHEMA.STATISTICS") && sql.includes("COUNT(*)")) return [[{ total: 1 }]];
    if (sql.includes("SELECT s.INDEX_NAME")) return [[]];
    if (sql.includes("MAX(CAST(codigo_taller")) return [[{ ultimo: 1 }]];
    if (sql.includes("FROM bodega_movimientos bm") && sql.includes("DATE(bm.creado_en)")) return [[{
      articulo_id: 7, codigo_taller: "0007", codigo: "PR-007", nombre: "Filtro de aceite",
      proveedor: "MAXI REPUESTOS", unidad_medida: "UND", tipo_movimiento: "SALIDA",
      cantidad: 2, precio_unitario: 100, precio_actual: 100, creado_en: new Date("2026-09-22T12:00:00Z")
    }]];
    if (sql.includes("SELECT codigo_taller, codigo, nombre, origen_inventario")) return [[article]];
    if (sql.includes("WHERE activo = 1 AND origen_inventario = 'PROPIO'")) return [[article]];
    return [[]];
  };
  const app = express();
  let role = "BODEGUERO";
  app.use((req, _res, next) => { req.session = { user: { id: 1, usuario: "test", rol: role } }; next(); });
  app.use("/bodega", router);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    role = "MECANICO";
    assert.equal((await fetch(base + "/bodega/inventario/exportar.xlsx")).status, 403);
    role = "BODEGUERO";
    const inventory = await fetch(base + "/bodega/inventario/exportar.xlsx?grupo=SUMINISTRO");
    assert.equal(inventory.status, 200);
    assert.match(inventory.headers.get("content-type"), /spreadsheetml/);
    const inventorySql = queries.find(item => item.sql.includes("SELECT codigo_taller, codigo, nombre, origen_inventario"));
    assert.match(inventorySql.sql, /grupo_bodega = \?/);
    assert.doesNotMatch(inventorySql.sql, /LIMIT 300/);

    const weekly = await fetch(base + "/bodega/consignacion/consumos.xlsx?fecha_desde=2026-09-21&fecha_hasta=2026-09-27&proveedor=MAXI%20REPUESTOS");
    assert.equal(weekly.status, 200);
    const movementQuery = queries.find(item => item.sql.includes("DATE(bm.creado_en)"));
    assert.deepEqual(movementQuery.params.slice(0, 4), ["MAXI REPUESTOS", "CONSIGNACION", "2026-09-21", "2026-09-27"]);
    assert.ok(movementQuery.params.includes("MAXI REPUESTOS"));
    assert.equal((await fetch(base + "/bodega/consignacion/consumos.xlsx?fecha_desde=2026-09-28&fecha_hasta=2026-09-21")).status, 400);

    const pdf = await fetch(base + "/bodega/inventario/propio.pdf?fecha_desde=2026-09-21&fecha_hasta=2026-09-27");
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get("content-type"), /application\/pdf/);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});
