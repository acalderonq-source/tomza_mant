const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const pool = require("../src/db");
const bodega = require("../src/routes/bodega.routes");

test("Bodega groups consignment by supplier and alerts only own supplies", async () => {
  const originalQuery = pool.query;
  const queries = [];
  pool.query = async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes("INFORMATION_SCHEMA.COLUMNS") || sql.includes("INFORMATION_SCHEMA.STATISTICS") && sql.includes("COUNT(*)")) return [[{ total: 1 }]];
    if (sql.includes("SELECT s.INDEX_NAME")) return [[]];
    if (sql.includes("MAX(CAST(codigo_taller")) return [[{ ultimo: 1 }]];
    if (sql.includes("AS stock_bajo")) return [[{ articulos: 3, stock_bajo: 1, agotados: 0 }]];
    if (sql.includes("AS proveedor,") && sql.includes("total_articulos")) return [[
      { proveedor: "MAXI REPUESTOS", total_articulos: 2 },
      { proveedor: "CONSIGNACION BATERIAS", total_articulos: 1 }
    ]];
    if (sql.includes("ORDER BY nombre, codigo_taller")) return [[
      { id: 10, nombre: "Batería", proveedor_consignacion: "CONSIGNACION BATERIAS" }
    ]];
    if (sql.includes("COUNT(*) AS total")) return [[{ total: 0 }]];
    return [[]];
  };
  const app = express();
  app.use((req, res, next) => {
    req.session = { user: { id: 1, usuario: "bodeguero", rol: "BODEGUERO" } };
    res.render = (_view, data) => res.json(data);
    next();
  });
  app.use("/bodega", bodega);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const anterior = await fetch(base + "/bodega/suministros", { redirect: "manual" });
    assert.equal(anterior.status, 302);
    assert.equal(anterior.headers.get("location"), "/bodega/inventario?grupo=SUMINISTRO");

    const inventario = await fetch(base + "/bodega/inventario?grupo=SUMINISTRO");
    assert.equal(inventario.status, 200);
    assert.equal((await inventario.json()).grupo, "SUMINISTRO");
    const listado = queries.find(item => item.sql.includes("ORDER BY") && item.sql.includes("LIMIT 300"));
    assert.match(listado.sql, /grupo_bodega = \?/);
    assert.ok(listado.params.includes("SUMINISTRO"));

    const consignacion = await fetch(base + "/bodega/consignacion?proveedor=CONSIGNACION%20BATERIAS");
    assert.equal(consignacion.status, 200);
    const data = await consignacion.json();
    assert.equal(data.proveedorConsignacionSeleccionado, "CONSIGNACION BATERIAS");
    assert.equal(data.proveedoresConsignacion.length, 2);
    assert.equal(data.articulosConsignacion[0].nombre, "Batería");
    const consultaProveedor = queries.find(item => item.sql.includes("ORDER BY nombre, codigo_taller"));
    assert.ok(consultaProveedor.params.includes("CONSIGNACION BATERIAS"));

    const resumen = queries.find(item => item.sql.includes("AS stock_bajo"));
    const alertas = queries.find(item => item.sql.includes("AS cantidad_comprar"));
    for (const query of [resumen, alertas]) {
      assert.match(query.sql, /grupo_bodega = 'SUMINISTRO'/);
      assert.match(query.sql, /origen_inventario = 'PROPIO'/);
    }
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});
