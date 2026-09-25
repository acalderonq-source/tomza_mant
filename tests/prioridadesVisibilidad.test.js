const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const pool = require("../src/db");
const taller = require("../src/routes/taller.routes");
const api = require("../src/routes/api.routes");
const { ensurePrioridadesVisibilidad } = require("../src/utils/prioridadesVisibilidad");

test("la migracion de visibilidad conserva visibles las prioridades existentes", async () => {
  const queries = [];
  await ensurePrioridadesVisibilidad({ query: async sql => {
    queries.push(sql);
    return sql.includes("information_schema") ? [[{ total: 0 }]] : [{}];
  } });
  assert.match(queries[1], /mostrar_operativos TINYINT\(1\) NOT NULL DEFAULT 1/);
});

test("la busqueda global de placas solo funciona para ADMIN cuando la solicita", async () => {
  const originalQuery = pool.query;
  const searches = [];
  let user = { id: 1, usuario: "admin", rol: "ADMIN", sede: "Cartago" };
  pool.query = async (sql, params = []) => {
    if (sql.includes("FROM unidades")) {
      searches.push({ sql, params });
      return [[{ id: 7, placa: "C179927", sede: "Guapiles" }]];
    }
    return [[]];
  };
  const app = express();
  app.use((req, _res, next) => {
    req.session = { user, sedeSeleccionada: "Cartago" };
    next();
  });
  app.use("/api", api);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/api/unidades/buscar?q=C179927&todas=1`)).status, 200);
    assert.doesNotMatch(searches.at(-1).sql, /sede IN \(\?\)/);
    assert.equal((await fetch(`${base}/api/unidades/buscar?q=C179927`)).status, 200);
    assert.match(searches.at(-1).sql, /sede IN \(\?\)/);
    user = { id: 2, usuario: "mecanico_guapiles", rol: "MECANICO", sede: "Guapiles" };
    assert.equal((await fetch(`${base}/api/unidades/buscar?q=C179927&todas=1`)).status, 200);
    assert.match(searches.at(-1).sql, /sede IN \(\?\)/);
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});

test("ADMIN decide la visibilidad y mecanicos no pueden editar ni cerrar una prioridad oculta", async () => {
  const originalQuery = pool.query;
  const inserts = [];
  let user = { id: 1, usuario: "admin", rol: "ADMIN", sede: "Cartago" };
  pool.query = async (sql, params = []) => {
    if (/information_schema\.COLUMNS/i.test(sql)) return [[{ total: 1, count: 1 }]];
    if (sql.includes("FROM unidades WHERE") && sql.includes("placa")) return [[{ sede: "Guapiles" }]];
    if (sql.includes("FROM usuarios_sedes")) return [[]];
    if (sql.includes("FROM taller_prioridades tp") && sql.includes("WHERE tp.id = ?")) {
      return [[{ id: Number(params[0]), placa_actual: "C179927", sede: "Guapiles", mostrar_operativos: 0 }]];
    }
    if (sql.includes("INSERT INTO taller_prioridades")) inserts.push(params);
    return [[]];
  };

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => { req.session = { user }; next(); });
  app.use("/taller", taller);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (path, data) => fetch(base + path, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(data)
    });
    const data = { placa: "C179927", observacion: "Revisar unidad", fecha_prioridad: "2026-09-25" };
    assert.equal((await post("/taller/prioridades", data)).status, 302);
    assert.equal(inserts[0].at(-1), 0);
    assert.equal(inserts[0][1], "Guapiles");
    assert.equal((await post("/taller/prioridades", { ...data, mostrar_operativos: "1" })).status, 302);
    assert.equal(inserts[1].at(-1), 1);

    user = { id: 2, usuario: "mecanico_guapiles", rol: "MECANICO", sede: "Guapiles" };
    assert.equal((await post("/taller/prioridades/5", data)).status, 403);
    assert.equal((await post("/taller/prioridades/5/atendida", {})).status, 403);
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});
