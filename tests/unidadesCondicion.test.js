const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");
const ejs = require("ejs");
const pool = require("../src/db");
const unidadesRouter = require("../src/routes/unidades.routes");

async function withServer(userRef, fn) {
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "../src/views"));
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => { req.session = { user: userRef.current, sedeSeleccionada: "Cartago" }; next(); });
  app.use("/unidades", unidadesRouter);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test("varadas y comodines se muestran por sede sin limitar ADMIN a la sede seleccionada", async () => {
  const originalQuery = pool.query;
  const queries = [];
  pool.query = async (sql, params = []) => {
    if (/INFORMATION_SCHEMA.COLUMNS/i.test(sql)) return [[{ count: 1 }]];
    if (sql.includes("FROM unidades WHERE activa = 1")) {
      queries.push({ sql, params });
      return [sql.includes("varada = 1")
        ? [{ placa: "C1", sede: "Guapiles", razon_varada: "Motor" }, { placa: "C2", sede: "Cartago", razon_varada: "Frenos" }]
        : [{ placa: "C3", sede: "La Cruz", marca: "Hino" }]];
    }
    return [[]];
  };
  try {
    const userRef = { current: { id: 1, usuario: "admin", rol: "ADMIN", sede: "Cartago" } };
    await withServer(userRef, async base => {
      const varadas = await (await fetch(`${base}/unidades/varadas`)).text();
      assert.match(varadas, /C1/);
      assert.match(varadas, /C2/);
      assert.match(varadas, /Motor/);
      assert.doesNotMatch(queries[0].sql, /sede IN/);
      const comodines = await (await fetch(`${base}/unidades/comodines`)).text();
      assert.match(comodines, /C3/);
      assert.match(queries[1].sql, /comodin = 1 AND varada = 0/);
    });
  } finally {
    pool.query = originalQuery;
  }
});

test("una sede limitada no consulta unidades de otras sedes", async () => {
  const originalQuery = pool.query;
  let listado;
  pool.query = async (sql, params = []) => {
    if (/INFORMATION_SCHEMA.COLUMNS/i.test(sql)) return [[{ count: 1 }]];
    if (sql.includes("FROM usuarios_sedes")) return [[]];
    if (sql.includes("FROM unidades WHERE activa = 1")) {
      listado = { sql, params };
      return [[]];
    }
    return [[]];
  };
  try {
    await withServer({ current: { id: 2, usuario: "mecanico_guapiles", rol: "MECANICO", sede: "Guapiles" } }, async base => {
      assert.equal((await fetch(`${base}/unidades/comodines`)).status, 200);
      assert.match(listado.sql, /sede IN \(\?\)/);
      assert.ok(listado.params[0].includes("Guapiles"));
    });
  } finally {
    pool.query = originalQuery;
  }
});

test("guardar cambios marca comodin, elimina varada y conserva el resto de datos", async () => {
  const originalQuery = pool.query;
  const originalConnection = pool.getConnection;
  let update;
  const actual = { id: 7, placa: "C7", sede: "Guapiles", marca: "Hino", modelo: "500", anio: 2016, activa: 1, varada: 1, comodin: 0, razon_varada: "Motor" };
  pool.query = async (sql, params = []) => {
    if (/INFORMATION_SCHEMA.COLUMNS/i.test(sql)) return [[{ count: 1 }]];
    if (sql.includes("WHERE id IN (?)")) return [[actual]];
    if (sql.includes("SELECT DISTINCT sede")) return [[{ sede: "Guapiles" }]];
    return [[]];
  };
  pool.getConnection = async () => ({
    beginTransaction: async () => {},
    query: async (sql, params) => {
      if (sql.includes("UPDATE unidades")) update = { sql, params };
      return [{}];
    },
    commit: async () => {},
    rollback: async () => {},
    release: () => {}
  });
  try {
    const userRef = { current: { id: 1, usuario: "admin", rol: "ADMIN", sede: "Cartago" } };
    await withServer(userRef, async base => {
      const response = await fetch(`${base}/unidades/guardar-masivo`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          "unidades[7][placa]": "C7",
          "unidades[7][id]": "7",
          "unidades[7][sede]": "Guapiles",
          "unidades[7][marca]": "Hino",
          "unidades[7][modelo]": "500",
          "unidades[7][anio]": "2016",
          "unidades[7][activa]": "1",
          "unidades[7][condicion]": "comodin",
          "unidades[7][razon_varada]": "Motor"
        })
      });
      assert.equal(response.status, 302);
      assert.ok(update, response.headers.get("location"));
      assert.match(update.sql, /comodin = \?/);
      assert.equal(update.params[6], 0);
      assert.equal(update.params[7], 1);
      assert.equal(update.params[8], null);
    });
  } finally {
    pool.query = originalQuery;
    pool.getConnection = originalConnection;
  }
});

test("la pantalla de unidades ofrece Comodin y enlaza los dos listados", async () => {
  const html = await ejs.renderFile(path.join(__dirname, "../src/views/unidades.ejs"), {
    unidades: [{ id: 7, placa: "C7", sede: "Guapiles", marca: "Hino", modelo: "500", anio: 2016, activa: 1, varada: 0, comodin: 1 }],
    unidadesPorNegocio: [],
    user: { rol: "ADMIN", usuario: "admin" },
    sedeSeleccionada: "TODAS",
    sedesFormulario: ["Guapiles"],
    sedesEditables: ["Guapiles"],
    etiquetaSede: sede => sede,
    puedeEditar: true,
    success: "",
    error: "",
    filtros: { estado: "activas", varado: "", placa: "" },
    resumen: { total: 1, activas: 1, inactivas: 0, varadas: 0 }
  });
  assert.match(html, /href="\/unidades\/varadas"/);
  assert.match(html, /href="\/unidades\/comodines"/);
  assert.match(html, /name="unidades\[7\]\[condicion\]"/);
  assert.match(html, /value="comodin" selected/);
});
