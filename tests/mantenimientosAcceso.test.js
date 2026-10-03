const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const pool = require("../src/db");
const mantenimientos = require("../src/routes/mantenimientos.routes");

async function withServer(user, poolHandlers, run) {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  pool.query = poolHandlers.query || (async () => [[]]);
  pool.getConnection = poolHandlers.getConnection || originalGetConnection;

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.session = { user, sedeSeleccionada: "Cartago" };
    next();
  });
  app.use("/mantenimientos", mantenimientos);
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

function post(base, path, values) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
  }
  return fetch(base + path, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
}

test("guardar plan requiere que la unidad del mantenimiento pertenezca a la sede activa", async () => {
  const updates = [];
  let unidadSede = "Guapiles";
  await withServer({ id: 1, usuario: "taller", rol: "TALLER", sede: "Cartago" }, {
    query: async (sql, params = []) => {
      if (sql.includes("SELECT m.id, u.placa, u.sede")) return [[{ id: 20, placa: "C1", sede: unidadSede }]];
      if (sql.includes("UPDATE mantenimientos m")) {
        updates.push({ sql, params });
        return [{ affectedRows: 1 }];
      }
      return [[]];
    }
  }, async base => {
    const denied = await post(base, "/mantenimientos/20/plan", { plan: "No autorizado" });
    assert.equal(denied.status, 403);
    assert.equal(updates.length, 0);

    unidadSede = "Cartago";
    const allowed = await post(base, "/mantenimientos/20/plan", { plan: "Revisar frenos" });
    assert.equal(allowed.status, 302);
    assert.equal(updates.length, 1);
    assert.match(updates[0].sql, /u\.sede IN \(\?\)/);
    assert.equal(updates[0].params[0], "Revisar frenos");
  });
});

test("el cierre exige trabajo realizado y rechaza mecánicos fuera de la sede", async () => {
  let unidadSede = "Guapiles";
  const tx = { writes: [], committed: false, rolledBack: false, released: false };
  const connection = {
    async beginTransaction() {},
    async query(sql, params = []) {
      if (sql.includes("SELECT m.id, m.estado, u.placa, u.sede")) {
        return [[{ id: 20, estado: "PROGRAMADO", placa: "C1", sede: unidadSede }]];
      }
      if (sql.includes("SELECT id FROM mecanicos")) return [[{ id: 7 }]];
      tx.writes.push({ sql, params });
      if (sql.includes("UPDATE mantenimientos m")) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    },
    async commit() { tx.committed = true; },
    async rollback() { tx.rolledBack = true; },
    release() { tx.released = true; }
  };

  await withServer({ id: 1, usuario: "admin", rol: "ADMIN", sede: "Cartago" }, {
    getConnection: async () => connection
  }, async base => {
    const missingExecution = await post(base, "/mantenimientos/20/ejecucion", { mecanicos: ["7"] });
    assert.equal(missingExecution.status, 400);
    assert.equal(tx.committed, false);

    const denied = await post(base, "/mantenimientos/20/ejecucion", { ejecucion: "Cambio de filtro", mecanicos: ["7"] });
    assert.equal(denied.status, 403);
    assert.equal(tx.writes.length, 0);
    assert.equal(tx.rolledBack, true);

    unidadSede = "Cartago";
    tx.rolledBack = false;
    const unauthorizedMechanic = await post(base, "/mantenimientos/20/ejecucion", { ejecucion: "Cambio de filtro", mecanicos: ["8"] });
    assert.equal(unauthorizedMechanic.status, 403);
    assert.equal(tx.writes.length, 0);
    assert.equal(tx.rolledBack, true);
  });
  assert.equal(tx.released, true);
});

test("el cierre autorizado actualiza y asigna mecánicos en una sola transacción", async () => {
  const tx = { writes: [], committed: false, rolledBack: false, released: false };
  const connection = {
    async beginTransaction() {},
    async query(sql, params = []) {
      if (sql.includes("SELECT m.id, m.estado, u.placa, u.sede")) {
        return [[{ id: 20, estado: "PROGRAMADO", placa: "C1", sede: "Cartago" }]];
      }
      if (sql.includes("SELECT id FROM mecanicos")) return [[{ id: 7 }]];
      tx.writes.push({ sql, params });
      if (sql.includes("UPDATE mantenimientos m")) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    },
    async commit() { tx.committed = true; },
    async rollback() { tx.rolledBack = true; },
    release() { tx.released = true; }
  };

  await withServer({ id: 1, usuario: "admin", rol: "ADMIN", sede: "Cartago" }, {
    getConnection: async () => connection
  }, async base => {
    const response = await post(base, "/mantenimientos/20/ejecucion", {
      ejecucion: "Cambio de filtro y revisión de fugas",
      pendiente: "",
      mecanicos: ["7"]
    });
    assert.equal(response.status, 302);
    assert.equal(tx.committed, true);
    assert.equal(tx.rolledBack, false);
    assert.equal(tx.writes.length, 3);
    assert.match(tx.writes[0].sql, /UPDATE mantenimientos m/);
    assert.match(tx.writes[1].sql, /DELETE FROM mantenimiento_mecanicos/);
    assert.match(tx.writes[2].sql, /INSERT INTO mantenimiento_mecanicos/);
    assert.equal(tx.writes[0].params[0], "Cambio de filtro y revisión de fugas");
  });
  assert.equal(tx.released, true);
});

test("un mecanico sin sede asignada no puede cerrar mantenimientos de otras sedes", async () => {
  const tx = { writes: [], committed: false, rolledBack: false, released: false };
  const connection = {
    async beginTransaction() {},
    async query(sql) {
      tx.writes.push(sql);
      if (sql.includes("SELECT m.id, m.estado, u.placa, u.sede")) {
        return [[{ id: 20, estado: "PROGRAMADO", placa: "C1", sede: "Cartago" }]];
      }
      return [[]];
    },
    async commit() { tx.committed = true; },
    async rollback() { tx.rolledBack = true; },
    release() { tx.released = true; }
  };

  await withServer({ id: 9, usuario: "mecanico_sin_sede", rol: "MECANICO", sede: "" }, {
    getConnection: async () => connection
  }, async base => {
    const response = await post(base, "/mantenimientos/20/ejecucion", {
      ejecucion: "Trabajo no autorizado",
      mecanicos: ["7"]
    });
    assert.equal(response.status, 403);
    assert.equal(tx.committed, false);
    assert.equal(tx.rolledBack, true);
    assert.equal(tx.writes.length, 1);
  });
  assert.equal(tx.released, true);
});

test("un mecanico de sede puede cerrar el mantenimiento de su sede", async () => {
  const tx = { writes: [], committed: false, rolledBack: false, released: false };
  const connection = {
    async beginTransaction() {},
    async query(sql, params = []) {
      tx.writes.push({ sql, params });
      if (sql.includes("SELECT m.id, m.estado, u.placa, u.sede")) {
        return [[{ id: 20, estado: "PROGRAMADO", placa: "A1", sede: "Alajuela" }]];
      }
      if (sql.includes("SELECT id FROM mecanicos")) return [[{ id: 7 }]];
      if (sql.includes("UPDATE mantenimientos m")) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    },
    async commit() { tx.committed = true; },
    async rollback() { tx.rolledBack = true; },
    release() { tx.released = true; }
  };

  await withServer({ id: 10, usuario: "mecanico_alajuela", rol: "MECANICO", sede: "" }, {
    getConnection: async () => connection
  }, async base => {
    const response = await post(base, "/mantenimientos/20/ejecucion", {
      ejecucion: "Mantenimiento preventivo",
      mecanicos: ["7"]
    });
    assert.equal(response.status, 302);
    assert.equal(tx.committed, true);
    assert.equal(tx.rolledBack, false);
    const mecanicosQuery = tx.writes.find(item => item.sql.includes("SELECT id FROM mecanicos"));
    assert.ok(mecanicosQuery.params.flat().includes("Alajuela"));
  });
  assert.equal(tx.released, true);
});

test("si falla la asignación de un mecánico, el cierre revierte todos los cambios", async () => {
  const tx = { committed: false, rolledBack: false, released: false };
  const connection = {
    async beginTransaction() {},
    async query(sql) {
      if (sql.includes("SELECT m.id, m.estado, u.placa, u.sede")) {
        return [[{ id: 20, estado: "PROGRAMADO", placa: "C1", sede: "Cartago" }]];
      }
      if (sql.includes("SELECT id FROM mecanicos")) return [[{ id: 7 }]];
      if (sql.includes("INSERT INTO mantenimiento_mecanicos")) throw new Error("fallo de prueba al asignar mecánico");
      return [{ affectedRows: 1 }];
    },
    async commit() { tx.committed = true; },
    async rollback() { tx.rolledBack = true; },
    release() { tx.released = true; }
  };

  await withServer({ id: 1, usuario: "admin", rol: "ADMIN", sede: "Cartago" }, {
    getConnection: async () => connection
  }, async base => {
    const response = await post(base, "/mantenimientos/20/ejecucion", {
      ejecucion: "Trabajo de prueba",
      mecanicos: ["7"]
    });
    assert.equal(response.status, 500);
    assert.equal(tx.committed, false);
    assert.equal(tx.rolledBack, true);
  });
  assert.equal(tx.released, true);
});

test("el correctivo identifica al trabajador de sesión sin pedir seleccionarlo y mantiene la transacción", async () => {
  let fallarDetalle = true;
  const tx = { writes: [], commits: 0, rollbacks: 0, releases: 0 };
  const connection = {
    async beginTransaction() {},
    async query(sql, params = []) {
      tx.writes.push({ sql, params });
      if (sql.includes("INSERT INTO correctivo_trabajos") && fallarDetalle) {
        throw new Error("fallo de prueba al guardar el detalle");
      }
      if (sql.includes("INSERT INTO correctivos")) return [{ insertId: 90 }];
      return [{ affectedRows: 1 }];
    },
    async commit() { tx.commits += 1; },
    async rollback() { tx.rollbacks += 1; },
    release() { tx.releases += 1; }
  };

  await withServer({ id: 1, usuario: "admin", nombre: "Mecánico Uno", rol: "ADMIN", sede: "Cartago" }, {
    query: async (sql) => {
      if (sql.toLowerCase().includes("information_schema")) return [[{ count: 1, total: 1 }]];
      if (sql.includes("UPDATE mantenimientos SET numero_mantenimiento")) return [{ affectedRows: 0 }];
      if (sql.includes("SELECT id, placa, sede FROM unidades WHERE id = ?")) {
        return [[{ id: 20, placa: "C164528", sede: "Cartago" }]];
      }
      if (sql.includes("SELECT id, nombre FROM mecanicos")) return [[{ id: 7, nombre: "Mecanico Uno" }]];
      return [[]];
    },
    getConnection: async () => connection
  }, async base => {
    const values = {
      unidad_id: "20",
      tipo_mantenimiento: "CORRECTIVO",
      pendiente: "Esperar repuesto",
      "trabajos[7]": "Cambio de filtro",
      "repuestos[7]": "Filtro de aceite"
    };

    const fallido = await post(base, "/mantenimientos/correctivos", values);
    assert.equal(fallido.status, 500, await fallido.clone().text());
    assert.equal(tx.commits, 0);
    assert.equal(tx.rollbacks, 1);
    assert.ok(tx.writes.some(write => write.sql.includes("UPDATE unidades")));
    assert.ok(tx.writes.some(write => write.sql.includes("INSERT INTO correctivos")));
    assert.ok(tx.writes.some(write => write.sql.includes("INSERT INTO correctivo_trabajos")));

    fallarDetalle = false;
    const guardado = await post(base, "/mantenimientos/correctivos", values);
    assert.equal(guardado.status, 302);
    assert.equal(tx.commits, 1);
    assert.equal(tx.rollbacks, 1);
  });
  assert.equal(tx.releases, 2);
});
