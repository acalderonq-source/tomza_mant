const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const pool = require("../src/db");
const rutas = require("../src/routes/reportesSupervisores.routes");

async function withServer(user, { query, connection }, run) {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  pool.query = query || (async () => [[]]);
  pool.getConnection = async () => connection;

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.session = { user, sedeSeleccionada: user.sede };
    next();
  });
  app.use("/reportes-supervisores", rutas);
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

function post(base, pathname, values) {
  return fetch(base + pathname, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values)
  });
}

function createConnection({ existing = null, unit = { id: 77, sede: "Cartago", placa: "C164528" } } = {}) {
  const tx = { writes: [], commits: 0, rollbacks: 0, released: false };
  const connection = {
    async beginTransaction() {},
    async query(sql, params = []) {
      if (sql.includes("SELECT id, sede, placa FROM unidades")) return [[unit]];
      if (sql.includes("SELECT * FROM supervisor_rutas_semanales")) return [[existing].filter(Boolean)];
      tx.writes.push({ sql, params });
      if (sql.includes("INSERT INTO supervisor_rutas_semanales")) return [{ insertId: 35 }];
      return [{ affectedRows: 1 }];
    },
    async commit() { tx.commits += 1; },
    async rollback() { tx.rollbacks += 1; },
    release() { tx.released = true; }
  };
  return { tx, connection };
}

test("crear una asignacion semanal registra unidad, chofer y movimiento en la misma transaccion", async () => {
  const { tx, connection } = createConnection();
  await withServer({ id: 8, usuario: "supervisor_cartago", nombre: "Supervisor Cartago", rol: "SUPERVISOR", sede: "Cartago" }, {
    query: async () => [[]],
    connection
  }, async base => {
    const response = await post(base, "/reportes-supervisores/rutas", {
      semana: "2026-W40", sede: "Cartago", ruta: "30", chofer: "Jose Chavarria", unidad_id: "77"
    });

    assert.equal(response.status, 302);
    assert.equal(tx.commits, 1);
    assert.equal(tx.rollbacks, 0);
    assert.equal(tx.writes.length, 2);
    assert.match(tx.writes[0].sql, /INSERT INTO supervisor_rutas_semanales/);
    assert.match(tx.writes[1].sql, /INSERT INTO supervisor_rutas_movimientos/);
    assert.equal(tx.writes[1].params[1], "CREAR");
    assert.equal(tx.writes[1].params[8], "Jose Chavarria");
    assert.equal(tx.writes[1].params[10], 77);
    assert.equal(tx.released, true);
  });
});

test("cambiar chofer requiere motivo y conserva el historial del cambio", async () => {
  const existing = {
    id: 35, semana_inicio: "2026-09-28", sede: "Cartago", ruta: "30", chofer: "Jose Chavarria",
    unidad_id: 77, placa_reportada: null, identificador: "C164528", observacion: null, activo: 1
  };
  const { tx, connection } = createConnection({ existing });
  await withServer({ id: 8, usuario: "supervisor_cartago", nombre: "Supervisor Cartago", rol: "SUPERVISOR", sede: "Cartago" }, {
    query: async () => [[]],
    connection
  }, async base => {
    const values = { sede: "Cartago", ruta: "30", chofer: "Luis Mora", unidad_id: "77" };
    const missingReason = await post(base, "/reportes-supervisores/rutas/35", values);
    assert.equal(missingReason.status, 302);
    assert.equal(tx.rollbacks, 1);
    assert.equal(tx.commits, 0);
    assert.equal(tx.writes.some(write => write.sql.includes("supervisor_rutas_movimientos")), false);

    const changed = await post(base, "/reportes-supervisores/rutas/35", { ...values, motivo: "Cambio semanal de chofer" });
    assert.equal(changed.status, 302);
    assert.equal(tx.commits, 1);
    const movement = tx.writes.find(write => write.sql.includes("INSERT INTO supervisor_rutas_movimientos"));
    assert.ok(movement);
    assert.equal(movement.params[1], "CAMBIO_CHOFER");
    assert.equal(movement.params[7], "Jose Chavarria");
    assert.equal(movement.params[8], "Luis Mora");
    assert.equal(movement.params[15], "Cambio semanal de chofer");
  });
});

test("un supervisor no puede registrar una ruta fuera de su sede", async () => {
  const { tx, connection } = createConnection();
  let began = false;
  connection.beginTransaction = async () => { began = true; };
  await withServer({ id: 8, usuario: "supervisor_cartago", nombre: "Supervisor Cartago", rol: "SUPERVISOR", sede: "Cartago" }, {
    query: async () => [[]],
    connection
  }, async base => {
    const response = await post(base, "/reportes-supervisores/rutas", {
      semana: "2026-W40", sede: "La Cruz", ruta: "12", chofer: "Luis Collado"
    });
    assert.equal(response.status, 302);
    assert.equal(began, false);
    assert.equal(tx.writes.length, 0);
    assert.equal(tx.commits, 0);
  });
});
