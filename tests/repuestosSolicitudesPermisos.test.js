const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const pool = require("../src/db");
const router = require("../src/routes/repuestos.routes");

async function withServer(user, queryHandler, run) {
  const originalQuery = pool.query;
  pool.query = queryHandler;
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.session = { user };
    next();
  });
  app.use("/repuestos", router);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
}

async function postSolicitud(base) {
  return fetch(`${base}/repuestos`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      fecha_solicitud: "2026-10-05",
      placa: "C164528",
      solicitado_por: "Nombre inventado",
      repuesto_solicitado: "Filtro de aceite",
      cantidad: "1",
      estado: "ENTREGADO",
      proveedor_id: "44"
    })
  });
}

test("ASISTENTE TALLER puede crear solicitud, atribuida a su nombre y pendiente de compra", async () => {
  let insert;
  await withServer({
    id: 2,
    usuario: "taller",
    nombre: "Ramírez Padilla Michelle",
    cedula: "305760452",
    rol: "TALLER",
    sede: "Cartago"
  }, async (sql, params = []) => {
    if (/SELECT perfil_excel FROM usuario_cedulas/i.test(sql)) return [[{ perfil_excel: "ASISTENTE TALLER" }]];
    if (/CREATE TABLE IF NOT EXISTS solicitudes_repuestos/i.test(sql)) return [{ affectedRows: 0 }];
    if (/INFORMATION_SCHEMA\.COLUMNS/i.test(sql)) return [[{ count: 1 }]];
    if (/SELECT placa, sede\s+FROM unidades/i.test(sql)) return [[{ placa: "C164528", sede: "Cartago" }]];
    if (/INSERT INTO solicitudes_repuestos/i.test(sql)) {
      insert = { sql, params };
      return [{ insertId: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }, async base => {
    const response = await postSolicitud(base);
    assert.equal(response.status, 302);
    assert.ok(insert);
    assert.equal(insert.params[3], "Ramírez Padilla Michelle");
    assert.equal(insert.params[7], "PENDIENTE_COMPRAR");
    assert.equal(insert.params[8], null);
    assert.equal(insert.params[9], null);
  });
});

test("otros perfiles TALLER no reciben permiso de crear solicitudes automáticamente", async () => {
  await withServer({ id: 3, usuario: "mecanico", rol: "TALLER", sede: "Cartago" }, async () => {
    throw new Error("La consulta no debe ejecutarse si se niega el acceso.");
  }, async base => {
    const response = await postSolicitud(base);
    assert.equal(response.status, 403);
  });
});
