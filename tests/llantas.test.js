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

test("llantas solo permiten avanzar por estados válidos y registran cada cambio", async () => {
  const originalQuery = pool.query;
  const cambios = [];
  const historial = [];
  const solicitud = { id: 5, unidad_id: 24, placa: "C164528", sede: "Cartago", estado: "SOLICITADA" };
  let simularCambioConcurrente = false;
  pool.query = async (sql, params = []) => {
    if (/^\s*CREATE TABLE/i.test(sql)) return [[]];
    if (sql.includes("SELECT * FROM solicitudes_llantas WHERE id = ?")) return [[{ ...solicitud }]];
    if (sql.includes("SELECT DISTINCT sede") && sql.includes("FROM unidades")) return [[{ sede: "Cartago" }]];
    if (sql.includes("SELECT id, placa, sede FROM unidades WHERE id = ?")) {
      return [[{ id: 24, placa: "C164528", sede: "Cartago" }]];
    }
    if (sql.includes("UPDATE solicitudes_llantas")) {
      if (simularCambioConcurrente) {
        simularCambioConcurrente = false;
        solicitud.estado = "COTIZADA";
      }
      const nuevoEstado = sql.match(/SET estado = '([^']+)'/)?.[1];
      const permitidos = nuevoEstado === "COTIZADA"
        ? ["SOLICITADA"]
        : nuevoEstado === "COMPRADA"
          ? ["SOLICITADA", "COTIZADA"]
          : ["COMPRADA"];
      if (!permitidos.includes(solicitud.estado)) return [{ affectedRows: 0 }];
      cambios.push({ anterior: solicitud.estado, nuevo: nuevoEstado });
      solicitud.estado = nuevoEstado;
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO solicitudes_llantas_historial")) {
      historial.push(params);
      return [{ insertId: historial.length }];
    }
    throw new Error(`Consulta inesperada: ${sql}`);
  };

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.session = { user: { id: 1, usuario: "admin", rol: "ADMIN", sede: "TODAS" } };
    next();
  });
  app.use("/llantas", llantas);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });

  try {
    const base = `http://127.0.0.1:${server.address().port}/llantas/5`;
    const post = (action, data = {}) => fetch(`${base}/${action}`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(data)
    });

    assert.equal((await post("recibir")).status, 409);
    assert.equal((await post("editar", {
      unidad_id: "24", medida: "11R22.5", cantidad: "1", estado: "RECIBIDA"
    })).status, 409);
    simularCambioConcurrente = true;
    assert.equal((await post("cotizar")).status, 409);
    assert.equal(historial.length, 0);
    solicitud.estado = "SOLICITADA";
    assert.equal((await post("cotizar")).status, 302);
    assert.equal((await post("cotizar")).status, 409);
    assert.equal((await post("comprar")).status, 302);
    assert.equal((await post("recibir")).status, 302);
    assert.equal((await post("comprar")).status, 409);
    assert.deepEqual(cambios.map(cambio => cambio.nuevo), ["COTIZADA", "COMPRADA", "RECIBIDA"]);
    assert.deepEqual(historial.map(registro => registro.slice(1, 3)), [
      ["SOLICITADA", "COTIZADA"],
      ["COTIZADA", "COMPRADA"],
      ["COMPRADA", "RECIBIDA"]
    ]);
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});
