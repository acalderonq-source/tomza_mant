const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { controlarAccesoPorDepartamento } = require("../src/utils/departamentos");

async function withServer(departamento, run) {
  const app = express();
  app.use((req, _res, next) => {
    req.session = departamento ? { user: { departamentoActivo: departamento } } : {};
    next();
  });
  app.use(controlarAccesoPorDepartamento);
  app.all("/mantenimientos/:id/plan", (_req, res) => res.send("handler ejecutado"));
  app.get("/dashboard", (_req, res) => res.send("dashboard disponible"));
  app.get("/api/unidades/buscar", (_req, res) => res.json({ unidades: ["C123"] }));
  app.get("/compras/facturas/asientos", (_req, res) => res.send("asientos disponibles"));
  app.get("/compras/ordenes", (_req, res) => res.send("órdenes disponibles"));
  app.get("/bodega/inventario", (_req, res) => res.send("bodega disponible"));
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test("Express bloquea URLs directas de Taller cuando el departamento activo es Operaciones", async () => {
  await withServer("OPERACIONES", async base => {
    const response = await fetch(`${base}/mantenimientos/25/plan`, { method: "POST" });
    assert.equal(response.status, 403);
    assert.match(await response.text(), /pertenece a Taller/);
  });
});

test("Express permite los módulos de Taller en Taller y mantiene disponible el inicio en otras áreas", async () => {
  await withServer("TALLER", async base => {
    const response = await fetch(`${base}/mantenimientos/25/plan`, { method: "POST" });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "handler ejecutado");
  });

  await withServer("OPERACIONES", async base => {
    const response = await fetch(`${base}/dashboard`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "dashboard disponible");
  });
});

test("las llamadas JSON reciben un 403 estructurado si intentan abrir una ruta de Taller", async () => {
  await withServer("CONTABILIDAD", async base => {
    const response = await fetch(`${base}/mantenimientos/25/plan`, {
      headers: { Accept: "application/json" }
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("content-type")?.includes("application/json"), true);
    assert.match((await response.json()).error, /pertenece a Taller/);
  });
});

test("el buscador API de placas queda aislado en Taller", async () => {
  await withServer("OPERACIONES", async base => {
    const response = await fetch(`${base}/api/unidades/buscar?q=C1`, {
      headers: { Accept: "application/json" }
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /pertenece a Taller/);
  });

  await withServer("TALLER", async base => {
    const response = await fetch(`${base}/api/unidades/buscar?q=C1`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { unidades: ["C123"] });
  });
});

test("Contabilidad puede abrir facturas y órdenes, pero no rutas operativas de Taller", async () => {
  await withServer("CONTABILIDAD", async base => {
    const asientos = await fetch(`${base}/compras/facturas/asientos`);
    const ordenes = await fetch(`${base}/compras/ordenes`);
    const taller = await fetch(`${base}/mantenimientos/25/plan`);
    assert.equal(asientos.status, 200);
    assert.equal(await asientos.text(), "asientos disponibles");
    assert.equal(ordenes.status, 200);
    assert.equal(taller.status, 403);
  });
});

test("Proveeduría puede abrir bodega y compras sin recibir acceso a mantenimientos", async () => {
  await withServer("PROVEEDURIA", async base => {
    const bodega = await fetch(`${base}/bodega/inventario`);
    const ordenes = await fetch(`${base}/compras/ordenes`);
    const taller = await fetch(`${base}/mantenimientos/25/plan`);
    assert.equal(bodega.status, 200);
    assert.equal(await bodega.text(), "bodega disponible");
    assert.equal(ordenes.status, 200);
    assert.equal(taller.status, 403);
  });
});
