const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const pool = require("../src/db");
const bodega = require("../src/routes/bodega.routes");

test("Bodega suggests active plates and rejects invented plates before changing stock", async () => {
  const originalQuery = pool.query;
  const originalConnection = pool.getConnection;
  const writes = [];
  const session = { user: { id: 1, usuario: "bodeguero", rol: "BODEGUERO" } };
  pool.query = async (sql, params = []) => {
    if (sql.includes("INFORMATION_SCHEMA.COLUMNS") || sql.includes("INFORMATION_SCHEMA.STATISTICS") && sql.includes("COUNT(*)")) {
      return [[{ total: 1 }]];
    }
    if (sql.includes("SELECT s.INDEX_NAME")) return [[]];
    if (sql.includes("MAX(CAST(codigo_taller")) return [[{ ultimo: 1 }]];
    if (sql.includes("FROM unidades") && sql.includes("LIKE ?")) {
      return [[{ id: 1, placa: "C164528", sede: "granel_la_cruz", marca: "Hino", modelo: "500" }]];
    }
    if (sql.includes("FROM unidades") && sql.includes("WHERE REPLACE(UPPER(TRIM(placa))")) {
      return [params[0] === "C164528"
        ? [{ id: 1, placa: "C164528", sede: "granel_la_cruz", marca: "Hino", modelo: "500" }]
        : []];
    }
    if (sql.includes("FROM bodega_articulos WHERE id = ?")) {
      return [[{ id: 1, stock_actual: 5, origen_inventario: "PROPIO" }]];
    }
    if (/^\s*(?:INSERT|UPDATE|DELETE)\b/.test(sql)) writes.push({ sql, params });
    return [[]];
  };
  pool.getConnection = async () => ({
    query: (...args) => pool.query(...args),
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {}
  });
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use("/bodega", bodega);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const search = await fetch(base + "/bodega/api/placas?q=1645");
    assert.equal(search.status, 200);
    assert.deepEqual((await search.json()).map(unidad => unidad.placa), ["C164528"]);
    const post = (path, data) => fetch(base + path, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(data)
    });
    assert.equal((await post("/bodega/entregar", {
      placa: "C16452X", mecanico: "Prueba", articulo_id: "1", cantidad: "1"
    })).status, 302);
    assert.match(session.error, /placa activa/);
    assert.equal((await post("/bodega/devolver", {
      placa: "C16452X", articulo_id: "1", cantidad: "1"
    })).status, 302);
    assert.match(session.error, /placa activa/);
    assert.equal((await post("/bodega/compatibilidad", {
      placa: "C16452X", articulo_id: "1", cantidad: "1"
    })).status, 302);
    assert.match(session.error, /unidad activa/);
    assert.equal(writes.length, 0);

    assert.equal((await post("/bodega/devolver", { articulo_id: "1", cantidad: "1" })).status, 302);
    const devolucion = writes.find(call => call.sql.includes("INSERT INTO bodega_movimientos"));
    assert.ok(devolucion);
    assert.equal(devolucion.params[5], null);
  } finally {
    pool.query = originalQuery;
    pool.getConnection = originalConnection;
    await new Promise(resolve => server.close(resolve));
  }
});
