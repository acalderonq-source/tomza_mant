const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const pool = require("../src/db");
const adminRoutes = require("../src/routes/admin.routes");

async function withServer(user, handlers, run) {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  pool.query = handlers.query || (async () => [[]]);
  pool.getConnection = handlers.getConnection || originalGetConnection;

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => { req.session = { user }; next(); });
  app.use("/", adminRoutes);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });

  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    pool.query = originalQuery;
    pool.getConnection = originalGetConnection;
    await new Promise(resolve => server.close(resolve));
  }
}

function post(base, values) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
  }
  return fetch(`${base}/admin/departamentos/42`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
}

test("solo ADMIN puede modificar departamentos y valores invalidos no abren transaccion", async () => {
  let connections = 0;
  const getConnection = async () => { connections += 1; throw new Error("No debe abrir conexion"); };
  await withServer({ id: 8, rol: "TALLER" }, { getConnection }, async base => {
    const forbidden = await post(base, { departamentos: "TALLER" });
    assert.equal(forbidden.status, 403);
  });

  await withServer({ id: 1, rol: "ADMIN" }, {
    getConnection
  }, async base => {
    const invalid = await withServerRequest(base, { departamentos: "NO_EXISTE" });
    assert.equal(invalid.status, 400);
  });
  assert.equal(connections, 0);
});

test("ADMIN guarda asignaciones de departamento en una transaccion con Taller principal", async () => {
  const writes = [];
  const state = { committed: false, rolledBack: false, released: false };
  const connection = {
    async beginTransaction() {},
    async query(sql, params = []) {
      if (sql.includes("SELECT id, rol FROM usuarios")) return [[{ id: 42, rol: "TALLER" }]];
      writes.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
    async commit() { state.committed = true; },
    async rollback() { state.rolledBack = true; },
    release() { state.released = true; }
  };

  await withServer({ id: 1, rol: "ADMIN" }, { getConnection: async () => connection }, async base => {
    const response = await post(base, { departamentos: ["TALLER", "OPERACIONES"] });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/admin/departamentos?guardado=1");
  });

  assert.equal(state.committed, true);
  assert.equal(state.rolledBack, false);
  assert.equal(state.released, true);
  assert.ok(writes.some(item => item.sql.includes("DELETE FROM usuario_departamentos")));
  assert.deepEqual(writes.filter(item => item.sql.includes("INSERT INTO usuario_departamentos")).map(item => item.params), [
    [42, "TALLER", 1],
    [42, "OPERACIONES", 0]
  ]);
});

test("ADMIN guarda la cédula normalizada junto con los departamentos", async () => {
  const writes = [];
  const connection = {
    async beginTransaction() {},
    async query(sql, params = []) {
      if (sql.includes("SELECT id, rol FROM usuarios")) return [[{ id: 42, rol: "TALLER" }]];
      if (sql.includes("SELECT id FROM usuarios WHERE cedula")) return [[]];
      writes.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
    async commit() {},
    async rollback() {},
    release() {}
  };

  await withServer({ id: 1, rol: "ADMIN" }, { getConnection: async () => connection }, async base => {
    const response = await post(base, { cedula: "1-2345-6789", departamentos: "TALLER" });
    assert.equal(response.status, 302);
  });

  assert.deepEqual(writes.find(item => item.sql.includes("UPDATE usuarios SET cedula"))?.params, ["123456789", 42]);
});

test("ADMIN rechaza una cédula duplicada sin modificar departamentos", async () => {
  let rolledBack = false;
  const writes = [];
  const connection = {
    async beginTransaction() {},
    async query(sql, params = []) {
      if (sql.includes("SELECT id, rol FROM usuarios")) return [[{ id: 42, rol: "TALLER" }]];
      if (sql.includes("SELECT id FROM usuarios WHERE cedula")) return [[{ id: 99 }]];
      writes.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
    async commit() {},
    async rollback() { rolledBack = true; },
    release() {}
  };

  await withServer({ id: 1, rol: "ADMIN" }, { getConnection: async () => connection }, async base => {
    const response = await post(base, { cedula: "123456789", departamentos: "TALLER" });
    assert.equal(response.status, 409);
    assert.match(await response.text(), /ya está asignada/);
  });

  assert.equal(rolledBack, true);
  assert.equal(writes.length, 0);
});

test("una cédula inválida se rechaza antes de abrir transacción", async () => {
  let connections = 0;
  await withServer({ id: 1, rol: "ADMIN" }, {
    getConnection: async () => { connections += 1; throw new Error("No debe abrir conexion"); }
  }, async base => {
    const response = await post(base, { cedula: "12ABC6789", departamentos: "TALLER" });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /cédula/);
  });
  assert.equal(connections, 0);
});

test("si falla una insercion la asignacion anterior se revierte", async () => {
  const state = { committed: false, rolledBack: false, released: false };
  let inserts = 0;
  const connection = {
    async beginTransaction() {},
    async query(sql) {
      if (sql.includes("SELECT id, rol FROM usuarios")) return [[{ id: 42, rol: "TALLER" }]];
      if (sql.includes("INSERT INTO usuario_departamentos") && ++inserts === 2) throw new Error("fallo simulado");
      return [{ affectedRows: 1 }];
    },
    async commit() { state.committed = true; },
    async rollback() { state.rolledBack = true; },
    release() { state.released = true; }
  };

  await withServer({ id: 1, rol: "ADMIN" }, { getConnection: async () => connection }, async base => {
    const response = await post(base, { departamentos: ["TALLER", "OPERACIONES"] });
    assert.equal(response.status, 500);
  });

  assert.equal(state.committed, false);
  assert.equal(state.rolledBack, true);
  assert.equal(state.released, true);
});

async function withServerRequest(base, values) {
  const body = new URLSearchParams(values);
  return fetch(`${base}/admin/departamentos/42`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
}
