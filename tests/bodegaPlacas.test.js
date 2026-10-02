const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const pool = require("../src/db");
const bodega = require("../src/routes/bodega.routes");

test("Bodega suggests active plates and rejects invented plates before changing stock", async () => {
  const originalQuery = pool.query;
  const originalConnection = pool.getConnection;
  const writes = [];
  const session = { user: { id: 1, usuario: "taller", rol: "TALLER" } };
  pool.query = async (sql, params = []) => {
    if (sql.includes("INFORMATION_SCHEMA.COLUMNS") || sql.includes("INFORMATION_SCHEMA.STATISTICS") && sql.includes("COUNT(*)")) {
      return [[{ total: 1 }]];
    }
    if (sql.includes("SELECT s.INDEX_NAME")) return [[]];
    if (sql.includes("MAX(CAST(codigo_taller")) return [[{ ultimo: 1 }]];
    if (sql.includes("FROM unidades") && sql.includes("LIKE ?")) {
      return [[{ id: 1, placa: "C164528", sede: "granel_la_cruz", marca: "Hino", modelo: "500" }]];
    }
    if (sql.includes("SELECT DISTINCT TRIM(sede) AS sede")) return [[{ sede: "Cartago" }]];
    if (sql.includes("FROM unidades") && sql.includes("WHERE REPLACE(UPPER(TRIM(placa))")) {
      return [params[0] === "C164528"
        ? [{ id: 1, placa: "C164528", sede: "granel_la_cruz", marca: "Hino", modelo: "500" }]
        : []];
    }
    if (sql.includes("FROM bodega_articulos WHERE id = ?")) {
      return [[{ id: 1, stock_actual: 5, origen_inventario: "PROPIO", ubicacion: "A-02", precio_unitario: 100, nombre: "Filtro", codigo_taller: "0001", codigo: "F-1", tipo_articulo: "REPUESTO" }]];
    }
    if (sql.includes("SELECT id, cantidad FROM bodega_existencias")) return [[{ id: 1, cantidad: 5 }]];
    if (sql.includes("SELECT COALESCE(SUM(cantidad), 0) AS total FROM bodega_existencias")) return [[{ total: 5 }]];
    if (sql.includes("SELECT * FROM bodega_movimientos WHERE id = ? AND tipo_movimiento = 'SALIDA'")) {
      return [params[0] === 77 ? [{ id: 77, articulo_id: 1, tipo_movimiento: "SALIDA", cantidad: 2, sede: "Cartago", ubicacion: "A-02", origen_inventario: "PROPIO", precio_unitario: 100, placa: null, mecanico: "Taller" }] : []];
    }
    if (sql.includes("SELECT COALESCE(SUM(cantidad), 0) AS total FROM bodega_movimientos")) return [[{ total: 0 }]];
    if (/^\s*(?:INSERT|UPDATE|DELETE)\b/.test(sql)) writes.push({ sql, params });
    if (sql.includes("INSERT INTO bodega_entregas")) return [{ insertId: 501 }];
    if (sql.includes("INSERT INTO bodega_movimientos")) return [{ insertId: 601 }];
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
      placa: "C16452X", sede: "Cartago", mecanico: "Prueba", articulo_id: "1", cantidad: "1"
    })).status, 302);
    assert.match(session.error, /placa activa/);
    assert.equal((await post("/bodega/entregar", {
      sede: "Cartago", mecanico: "Prueba", articulo_id: "1", cantidad: "1"
    })).status, 302);
    assert.match(session.error, /marque Sin placa/);
    assert.equal(writes.length, 0);

    assert.equal((await post("/bodega/entregar", {
      sin_placa: "1", sede: "Cartago", mecanico: "Prueba",
      articulo_id: ["1", "2"], cantidad: ["1", "-1"]
    })).status, 302);
    assert.match(session.error, /cada línea debe tener un producto y una cantidad mayor que cero/);
    assert.equal(writes.length, 0);

    assert.equal((await post("/bodega/articulos", { nombre: "Filtro", stock_actual: "5" })).status, 302);
    assert.match(session.error, /sin existencia/);
    assert.equal(writes.length, 0);

    assert.equal((await post("/bodega/entregar", {
      sin_placa: "1", sede: "Cartago", mecanico: "Prueba", articulo_id: "1", cantidad: "1"
    })).status, 302);
    const entrega = writes.find(call => call.sql.includes("INSERT INTO bodega_entregas"));
    const salida = writes.find(call => call.sql.includes("INSERT INTO bodega_movimientos"));
    assert.ok(entrega);
    assert.ok(salida);
    assert.equal(entrega.params[0], null);
    assert.equal(salida.params[10], null);
    assert.equal(salida.params[11], "Prueba");
    assert.equal(salida.params[5], "Cartago");

    assert.equal((await post("/bodega/compatibilidad", {
      placa: "C16452X", articulo_id: "1", cantidad: "1"
    })).status, 302);
    assert.match(session.error, /unidad activa/);

    assert.equal((await post("/bodega/devolver", { cantidad: "1" })).status, 302);
    assert.match(session.error, /salida original/);
    assert.equal((await post("/bodega/devolver", { movimiento_origen_id: "77", cantidad: "3" })).status, 302);
    assert.match(session.error, /solo tiene 2/);
    assert.equal((await post("/bodega/devolver", { movimiento_origen_id: "77", cantidad: "1" })).status, 302);
    const devolucion = writes.find(call => call.sql.includes("INSERT INTO bodega_movimientos") && call.sql.includes("'DEVOLUCION'"));
    assert.ok(devolucion);
    assert.equal(devolucion.params[4], 77);
    assert.equal(devolucion.params[5], 1);

    session.user.rol = "BODEGUERO";
    const writesBeforeBodeguero = writes.length;
    assert.equal((await post("/bodega/articulos", { nombre: "Nuevo filtro", stock_actual: "0" })).status, 302);
    assert.equal(writes.length, writesBeforeBodeguero + 1);
    assert.match(session.success, /Artículo creado/);
  } finally {
    pool.query = originalQuery;
    pool.getConnection = originalConnection;
    await new Promise(resolve => server.close(resolve));
  }
});
