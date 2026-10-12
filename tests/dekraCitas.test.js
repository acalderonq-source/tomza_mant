const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const pool = require("../src/db");
const dekraRoutes = require("../src/routes/dekra.routes");
const { obtenerCorreosSupervisores } = require("../src/utils/dekraMail");

test("DEKRA usa el correo del supervisor asociado a sede y negocio", () => {
  assert.deepEqual(obtenerCorreosSupervisores("Cartago", "GRANEL"), ["MGomez.M@tomza.com"]);
  assert.deepEqual(obtenerCorreosSupervisores("Alajuela", "GRANEL"), ["CBolanos.B@tomza.com"]);
  assert.deepEqual(obtenerCorreosSupervisores("Alajuela", "CILINDROS"), ["RVargas.E@tomza.com"]);
});

test("DEKRA permite detectar sedes sin correo de supervisor configurado", () => {
  assert.deepEqual(obtenerCorreosSupervisores("Orotina", "GRANEL"), []);
});

test("los supervisores no pueden programar citas DEKRA", async () => {
  const originalQuery = pool.query;
  pool.query = async () => { throw new Error("No debe consultar la base de datos"); };
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.session = { user: { id: 8, rol: "SUPERVISOR", sede: "Cartago" } };
    next();
  });
  app.use("/dekra", dekraRoutes);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/dekra/4/cita`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ fecha: "2026-10-10" })
    });
    assert.equal(response.status, 403);
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});

test("la primera cita debe quedar en el primer mes del ciclo de la unidad", async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql) => {
    calls.push(sql);
    if (sql.includes("SELECT d.sede, u.sede AS unidad_sede")) {
      return [[{ sede: "Cartago", unidad_sede: "Cartago" }]];
    }
    if (sql.includes("SELECT d.id, d.sede, d.negocio, d.mes")) {
      return [[{ id: 4, sede: "Cartago", negocio: "CILINDROS", mes: "ENE-JUL", estado: "PENDIENTE", placa: "ABC123" }]];
    }
    return [[]];
  };
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.session = { user: { id: 1, rol: "ADMIN", usuario: "admin", sede: "Cartago" } };
    next();
  });
  app.use("/dekra", dekraRoutes);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/dekra/4/cita/primera`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ fecha: "2027-02-10", correos: "supervisor@tomza.com" })
    });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Enero/);
    assert.equal(calls.some(sql => sql.includes("UPDATE dekra_control")), false);
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});
