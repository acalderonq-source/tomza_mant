const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const pool = require("../src/db");
const llantas = require("../src/routes/llantas.routes");

test("solicitudes de llantas rechazan cantidades invalidas y guardan unidad, cantidad e historial", async () => {
  const originalQuery = pool.query;
  const writes = [];
  pool.query = async (sql, params = []) => {
    if (/^\s*CREATE TABLE/i.test(sql)) return [[]];
    if (sql.includes("SELECT sede FROM usuarios_sedes")) return [[]];
    if (sql.includes("SELECT id, placa, sede FROM unidades WHERE id = ?")) {
      return params[0] === 24 ? [[{ id: 24, placa: "C164528", sede: "Cartago" }]] : [[]];
    }
    if (/^\s*INSERT INTO solicitudes_llantas(?:_historial)?/i.test(sql)) {
      writes.push({ sql, params });
      return [{ insertId: writes.length === 1 ? 81 : 82 }];
    }
    throw new Error(`Consulta inesperada: ${sql}`);
  };

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.session = { user: { id: 7, usuario: "mecanico_cartago", rol: "MECANICO", sede: "Cartago" } };
    next();
  });
  app.use("/llantas", llantas);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });

  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = data => fetch(`${base}/llantas/solicitar`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(data)
    });

    for (const cantidad of ["", "0", "-1", "1.5", "abc"]) {
      const response = await post({ unidad_id: "24", medida: " 11R22.5 ", cantidad });
      assert.equal(response.status, 400, `cantidad ${JSON.stringify(cantidad)} debe rechazarse`);
    }
    assert.equal((await post({ unidad_id: "24", medida: "   ", cantidad: "1" })).status, 400);
    assert.equal((await post({ unidad_id: "24.5", medida: "11R22.5", cantidad: "1" })).status, 400);
    assert.equal(writes.length, 0);

    const response = await post({ unidad_id: "24", medida: " 11R22.5 ", cantidad: "2" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/llantas");
    assert.equal(writes.length, 2);
    assert.match(writes[0].sql, /INSERT INTO solicitudes_llantas/);
    assert.deepEqual(writes[0].params.slice(0, 5), [24, "C164528", "Cartago", "11R22.5", 2]);
    assert.match(writes[1].sql, /INSERT INTO solicitudes_llantas_historial/);
    assert.deepEqual(writes[1].params.slice(0, 4), [81, null, "SOLICITADA", 7]);
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});
