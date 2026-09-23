const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const pool = require("../src/db");
const minae = require("../src/routes/minae.routes");
const dekra = require("../src/routes/dekra.routes");

test("Granel La Cruz can create local records but cannot change another site's records", async () => {
  const originalQuery = pool.query;
  const calls = [];
  const user = { id: 55, usuario: "granel_la_cruz", rol: "SUPERVISOR", sede: "granel_la_cruz" };
  let sessionUser = user;
  pool.query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("FROM unidades WHERE id = ?")) {
      const sede = String(params[0]) === "2" ? "La Cruz" : "granel_la_cruz";
      return [[{ id: Number(params[0]), sede, negocio: "Granel" }]];
    }
    if (sql.includes("FROM minae_tramites mt") && sql.includes("WHERE mt.id = ?")) {
      return [[{ id: Number(params[0]), unidad_id: 2, sede: "La Cruz", unidad_sede: "La Cruz" }]];
    }
    if (sql.includes("FROM dekra_control d") && sql.includes("WHERE d.id = ?")) {
      return [[{ sede: "La Cruz", unidad_sede: "La Cruz" }]];
    }
    return [[]];
  };

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => { req.session = { user: sessionUser }; next(); });
  app.use("/minae", minae);
  app.use("/dekra", dekra);
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

    assert.equal((await post("/minae/nuevo", { unidad_id: 2, tipo: "Permiso" })).status, 403);
    assert.equal((await fetch(base + "/minae/1/cita")).status, 403);
    assert.equal((await post("/minae/1/cita", { fecha_cita: "2026-09-24" })).status, 403);
    assert.equal((await post("/dekra/nuevo", { unidad_id: 2, mes: "2026-09", negocio: "Granel" })).status, 403);
    assert.equal((await post("/dekra/1/realizado", {})).status, 403);
    assert.equal((await post("/dekra/1/no-realizado", { observacion: "Prueba" })).status, 403);
    assert.equal(calls.some(call => /\b(?:INSERT|UPDATE)\b/.test(call.sql)), false);

    assert.equal((await post("/minae/nuevo", { unidad_id: 1, tipo: "Permiso" })).status, 302);
    assert.equal((await post("/dekra/nuevo", { unidad_id: 1, mes: "2026-09", negocio: "Granel" })).status, 302);
    sessionUser = { ...user, usuario: "otro_supervisor", sede: "La Cruz" };
    assert.equal((await fetch(base + "/minae", { redirect: "manual" })).status, 403);
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});
