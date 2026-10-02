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
  let origenArticulo = "PROPIO";
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
      return [[{ id: 1, stock_actual: 5, origen_inventario: origenArticulo, proveedor_consignacion: origenArticulo === "CONSIGNACION" ? "MAXI" : null, ubicacion: "A-02", precio_unitario: 100, nombre: "Filtro", codigo_taller: "0001", codigo: "F-1", tipo_articulo: "REPUESTO" }]];
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

    assert.equal((await post("/bodega/ajustar", {
      articulo_id: "1", conteo_fisico: "texto", sede: "Cartago", motivo: "Conteo físico"
    })).status, 302);
    assert.match(session.error, /conteo físico y motivo/);
    assert.equal(writes.length, 0);

    assert.equal((await post("/bodega/articulos", {
      nombre: "Precio inválido", stock_actual: "0", precio_unitario: "-1"
    })).status, 302);
    assert.match(session.error, /mínimos, máximos y precio/);
    assert.equal((await post("/bodega/recibir", {
      articulo_id: "1", cantidad: "1", precio_unitario: "texto", sede: "Cartago"
    })).status, 302);
    assert.match(session.error, /precio recibido debe ser un monto no negativo/);
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

    origenArticulo = "CONSIGNACION";
    const writesBeforeEdicion = writes.length;
    assert.equal((await post("/bodega/articulos/1/editar", {
      nombre: "Filtro actualizado", codigo: "PROV-2", tipo_articulo: "REPUESTO", grupo_bodega: "INVENTARIO",
      categoria: "Filtros", marca: "Hino", numero_parte: "LF-2", tipo_unidad: "Hino 500", unidad_medida: "UND",
      stock_minimo: "1", stock_maximo: "10", ubicacion: "A-03", precio_unitario: "125,50",
      proveedor_id: "", proveedor_nombre: "Proveedor nuevo", proveedor_consignacion: "MAXI REPUESTOS", observacion: "Ficha revisada"
    })).status, 302);
    assert.match(session.success, /existencias no se modificaron/);
    const actualizacionFicha = writes.find((call, index) => index >= writesBeforeEdicion && call.sql.includes("UPDATE bodega_articulos"));
    assert.ok(actualizacionFicha);
    assert.doesNotMatch(actualizacionFicha.sql, /stock_actual|origen_inventario|codigo_taller/);
    assert.match(actualizacionFicha.sql, /proveedor_consignacion/);
    assert.equal(actualizacionFicha.params[15], "MAXI REPUESTOS");
    assert.ok(writes.some((call, index) => index >= writesBeforeEdicion && call.sql.includes("INSERT INTO auditoria_sistema")));

    session.user.rol = "BODEGA";
    assert.equal((await post("/bodega/articulos/1/editar", {
      nombre: "No autorizado", tipo_articulo: "REPUESTO", grupo_bodega: "INVENTARIO",
      stock_minimo: "0", stock_maximo: "0", precio_unitario: "0"
    })).status, 403);
  } finally {
    pool.query = originalQuery;
    pool.getConnection = originalConnection;
    await new Promise(resolve => server.close(resolve));
  }
});
