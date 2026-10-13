const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const ejs = require("ejs");
const path = require("node:path");
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

test("ADMIN puede filtrar DEKRA por sede además de ciclo y negocio", async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("SELECT DISTINCT sede") && sql.includes("FROM dekra_control")) {
      return [[{ sede: "Cartago" }, { sede: "La Cruz" }]];
    }
    if (sql.includes("FROM dekra_control d") && sql.includes("JOIN unidades u")) return [[]];
    throw new Error(`Consulta inesperada: ${sql}`);
  };
  const app = express();
  app.use((req, res, next) => {
    req.session = { user: { id: 1, rol: "ADMIN", usuario: "admin" } };
    res.render = (_view, locals) => res.json({
      registros: locals.registros,
      sedesDisponibles: locals.sedesDisponibles,
      sedeSeleccionada: locals.sedeSeleccionada
    });
    next();
  });
  app.use("/dekra", dekraRoutes);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/dekra?sede=La%20Cruz&mes=ENE-JUL&negocio=GRANEL`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.sedesDisponibles, ["Cartago", "La Cruz"]);
    assert.equal(payload.sedeSeleccionada, "La Cruz");
    const listado = calls.find(call => call.sql.includes("FROM dekra_control d") && call.sql.includes("JOIN unidades u"));
    assert.match(listado.sql, /AND d\.sede = \?/);
    assert.deepEqual(listado.params, ["La Cruz", "ENE-JUL", "GRANEL"]);
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});

test("el filtro DEKRA no permite a un supervisor cambiar su sede autorizada", async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("FROM dekra_control d") && sql.includes("JOIN unidades u")) return [[]];
    throw new Error(`Consulta inesperada: ${sql}`);
  };
  const app = express();
  app.use((req, res, next) => {
    req.session = { user: { id: 8, rol: "SUPERVISOR", usuario: "supervisor", sede: "Cartago" } };
    res.render = (_view, locals) => res.json({ sedeSeleccionada: locals.sedeSeleccionada, sedesDisponibles: locals.sedesDisponibles });
    next();
  });
  app.use("/dekra", dekraRoutes);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/dekra?sede=La%20Cruz`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.sedeSeleccionada, "Cartago");
    assert.deepEqual(payload.sedesDisponibles, ["Cartago"]);
    const listado = calls.find(call => call.sql.includes("FROM dekra_control d") && call.sql.includes("JOIN unidades u"));
    assert.deepEqual(listado.params, ["Cartago"]);
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});

test("la pantalla DEKRA muestra el selector de sede con la selección activa", async () => {
  const html = await ejs.renderFile(path.join(__dirname, "../src/views/dekra.ejs"), {
    registros: [],
    user: { rol: "ADMIN" },
    mesSeleccionado: "ENE-JUL",
    negocioSeleccionado: "GRANEL",
    estadoSeleccionado: "",
    sedeSeleccionada: "La Cruz",
    sedesDisponibles: ["Cartago", "La Cruz"],
    citaAviso: "",
    mesesPorCiclo: { "ENE-JUL": ["Enero", "Julio"] },
    hoyCostaRica: "2026-10-13",
    resumen: { total: 0, realizados: 0, noRealizados: 0, pendientes: 0, cumplimiento: 0 }
  });
  assert.match(html, /<label class="filter-label">Sede<\/label>/);
  assert.match(html, /<option value="La Cruz" selected>La Cruz<\/option>/);
  assert.match(html, /<select name="mes"/);
  assert.match(html, /<select name="negocio"/);
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
