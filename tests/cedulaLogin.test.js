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

test("permite ingresar con cédula normalizada y PIN del código de trabajador", async () => {
  const pinHash = await bcrypt.hash("123", 4);
  const consultas = [];
  const user = { id: 31, usuario: "ana.mora", nombre: "Perfil Taller", rol: "TALLER", sede: "Cartago", persona_nombre: "Ana Mora", pin_hash: pinHash };

  await withLoginServer(async (sql, params = []) => {
    consultas.push({ sql, params });
    if (sql.includes("FROM usuario_cedulas")) return [[user]];
    if (sql.includes("FROM usuario_departamentos")) return [[{ departamento: "TALLER", es_principal: 1 }]];
    return [[]];
  }, async base => {
    const response = await fetch(`${base}/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        cedula: "1-2345-6789",
        pin: "123",
        departamento: "TALLER"
      })
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/dashboard");
    assert.equal(consultas[0].params[0], "123456789");
  });
});

test("obliga a establecer PIN privado cuando el perfil requiere cambio", async () => {
  const pinHash = await bcrypt.hash("123", 4);
  const user = {
    id: 33, usuario: "ana.mora", nombre: "Perfil Taller", rol: "TALLER", sede: "Cartago",
    persona_nombre: "Ana Mora", cedula_persona: "123456789", pin_hash: pinHash,
    requiere_cambio_pin: 1
  };
  await withLoginServer(async sql => {
    if (sql.includes("FROM usuario_cedulas")) return [[user]];
    if (sql.includes("FROM usuario_departamentos")) return [[{ departamento: "TALLER", es_principal: 1 }]];
    return [[]];
  }, async base => {
    const response = await fetch(`${base}/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ cedula: "123456789", pin: "123", departamento: "TALLER" })
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/cambiar-pin");
  });
});

test("permite ingresar por una cédula asociada a un perfil del Excel", async () => {
  const pinHash = await bcrypt.hash("456", 4);
  const consultas = [];
  const user = { id: 34, usuario: "mecanico_guapiles", nombre: "Mecánico Guápiles", rol: "MECANICO", sede: "Guapiles", pin_hash: pinHash };

  await withLoginServer(async (sql, params = []) => {
    consultas.push({ sql, params });
    if (sql.includes("FROM usuario_cedulas")) return [[{ ...user, persona_nombre: "Persona Excel", perfil_excel: "MECANICO_GUAPILES" }]];
    if (sql.includes("FROM usuario_departamentos")) return [[{ departamento: "TALLER", es_principal: 1 }]];
    return [[]];
  }, async base => {
    const response = await fetch(`${base}/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ cedula: "1-2345-6789", pin: "456", departamento: "TALLER" })
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/dashboard");
    assert.equal(consultas.find(call => call.sql.includes("FROM usuario_cedulas"))?.params[0], "123456789");
  });
});

test("si la cédula tiene dos perfiles, el PIN válido permite seleccionar el perfil", async () => {
  const pinHash = await bcrypt.hash("789", 4);
  await withLoginServer(async sql => {
    if (sql.includes("WHERE usuario = ?")) return [[]];
    if (sql.includes("FROM usuario_cedulas")) return [[
      { id: 4, usuario: "mecanico", nombre: "Mecánico", rol: "MECANICO", pin_hash: pinHash },
      { id: 21, usuario: "pesados", nombre: "Mecánico Pesados", rol: "MECANICO", pin_hash: pinHash }
    ]];
    return [[]];
  }, async base => {
    const response = await fetch(`${base}/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ cedula: "123456789", pin: "789", departamento: "TALLER" })
    });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /La cédula tiene acceso a más de un perfil/);
    assert.match(html, /Mecánico Pesados/);
    assert.match(html, /action="\/login\/perfil"/);
  });
});

test("redirige a cambio obligatorio al iniciar con una contraseña temporal", async () => {
  const password = await bcrypt.hash("Temporal-segura-2026", 4);
  await withLoginServer(async sql => {
    if (sql.includes("FROM usuarios u")) return [[{ id: 56, usuario: "mecanico_nicoya", nombre: "Mecánico Nicoya", rol: "MECANICO", sede: "Nicoya", password, requiere_cambio_password: 1 }]];
    if (sql.includes("FROM usuario_departamentos")) return [[{ departamento: "TALLER", es_principal: 1 }]];
    return [[]];
  }, async base => {
    const response = await fetch(`${base}/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ usuario: "mecanico_nicoya", password: "Temporal-segura-2026", departamento: "TALLER" })
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/cambiar-clave");
  });
});

test("el usuario existente sigue ingresando con su nombre de usuario", async () => {
  const password = await bcrypt.hash("Clave-segura-2026", 4);
  const user = { id: 32, usuario: "ana.mora", nombre: "Ana Mora", rol: "TALLER", sede: "Cartago", password };
  const consultas = [];

  await withLoginServer(async (sql, params = []) => {
    consultas.push({ sql, params });
    if (sql.includes("FROM usuarios u")) return [[user]];
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
    assert.equal(consultas.some(call => call.sql.includes("NOT EXISTS (SELECT 1 FROM usuario_cedulas")), true);
  });
});
