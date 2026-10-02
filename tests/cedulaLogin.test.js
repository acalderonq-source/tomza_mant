const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const pool = require("../src/db");
const authRoutes = require("../src/routes/auth.routes");
const { normalizarCedula, cedulaValida } = require("../src/utils/cedula");

test("normaliza cédulas escritas con espacios o guiones y valida identificadores de 9 a 12 dígitos", () => {
  assert.equal(normalizarCedula("1-2345-6789"), "123456789");
  assert.equal(cedulaValida("1-2345-6789"), true);
  assert.equal(cedulaValida("12345678"), false);
  assert.equal(cedulaValida("1234567890123"), false);
  assert.equal(cedulaValida("12ABC6789"), false);
  assert.equal(cedulaValida(""), true);
});

async function withLoginServer(queryHandler, run) {
  const originalQuery = pool.query;
  pool.query = queryHandler;

  const app = express();
  app.set("views", path.join(__dirname, "..", "src", "views"));
  app.set("view engine", "ejs");
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.session = {
      regenerate(callback) {
        req.session = {};
        callback(null);
      }
    };
    next();
  });
  app.use("/", authRoutes);
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

test("permite ingresar con cédula normalizada y conserva la cuenta y sus departamentos", async () => {
  const password = await bcrypt.hash("Clave-segura-2026", 4);
  const consultas = [];
  const user = { id: 31, usuario: "ana.mora", nombre: "Ana Mora", rol: "TALLER", sede: "Cartago", cedula: "123456789", password };

  await withLoginServer(async (sql, params = []) => {
    consultas.push({ sql, params });
    if (sql.includes("WHERE usuario = ?")) return [[]];
    if (sql.includes("WHERE cedula = ?")) return [[user]];
    if (sql.includes("FROM usuario_departamentos")) return [[{ departamento: "TALLER", es_principal: 1 }]];
    return [[]];
  }, async base => {
    const response = await fetch(`${base}/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        usuario: "1-2345-6789",
        password: "Clave-segura-2026",
        departamento: "TALLER"
      })
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/dashboard");
    assert.equal(consultas[0].params[0], "1-2345-6789");
    assert.equal(consultas[1].params[0], "123456789");
  });
});

test("el usuario existente sigue ingresando con su nombre de usuario", async () => {
  const password = await bcrypt.hash("Clave-segura-2026", 4);
  const user = { id: 32, usuario: "ana.mora", nombre: "Ana Mora", rol: "TALLER", sede: "Cartago", password };
  const consultas = [];

  await withLoginServer(async (sql, params = []) => {
    consultas.push({ sql, params });
    if (sql.includes("WHERE usuario = ?")) return [[user]];
    if (sql.includes("FROM usuario_departamentos")) return [[{ departamento: "TALLER", es_principal: 1 }]];
    return [[]];
  }, async base => {
    const response = await fetch(`${base}/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ usuario: "ana.mora", password: "Clave-segura-2026", departamento: "TALLER" })
    });

    assert.equal(response.status, 302);
    assert.equal(consultas.some(call => call.sql.includes("WHERE cedula = ?")), false);
  });
});
