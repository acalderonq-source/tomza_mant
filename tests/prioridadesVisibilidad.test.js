const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const path = require("node:path");
const pool = require("../src/db");
const taller = require("../src/routes/taller.routes");
const api = require("../src/routes/api.routes");
const { ensurePrioridadesVisibilidad } = require("../src/utils/prioridadesVisibilidad");

test("la migracion de visibilidad conserva visibles las prioridades existentes", async () => {
  const queries = [];
  await ensurePrioridadesVisibilidad({ query: async sql => {
    queries.push(sql);
    return sql.includes("information_schema") ? [[{ total: 0 }]] : [{}];
  } });
  assert.match(queries[1], /mostrar_operativos TINYINT\(1\) NOT NULL DEFAULT 1/);
});

test("la busqueda global de placas solo funciona para ADMIN cuando la solicita", async () => {
  const originalQuery = pool.query;
  const searches = [];
  let user = { id: 1, usuario: "admin", rol: "ADMIN", sede: "Cartago" };
  pool.query = async (sql, params = []) => {
    if (sql.includes("FROM unidades")) {
      searches.push({ sql, params });
      return [[{ id: 7, placa: "C179927", sede: "Guapiles" }]];
    }
    return [[]];
  };
  const app = express();
  app.use((req, _res, next) => {
    req.session = { user, sedeSeleccionada: "Cartago" };
    next();
  });
  app.use("/api", api);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/api/unidades/buscar?q=C179927&todas=1`)).status, 200);
    assert.doesNotMatch(searches.at(-1).sql, /sede IN \(\?\)/);
    assert.equal((await fetch(`${base}/api/unidades/buscar?q=C179927`)).status, 200);
    assert.match(searches.at(-1).sql, /sede IN \(\?\)/);
    user = { id: 2, usuario: "mecanico_guapiles", rol: "MECANICO", sede: "Guapiles" };
    assert.equal((await fetch(`${base}/api/unidades/buscar?q=C179927&todas=1`)).status, 200);
    assert.match(searches.at(-1).sql, /sede IN \(\?\)/);
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});

test("ADMIN decide la visibilidad y mecanicos no pueden editar ni cerrar una prioridad oculta", async () => {
  const originalQuery = pool.query;
  const inserts = [];
  let user = { id: 1, usuario: "admin", rol: "ADMIN", sede: "Cartago" };
  pool.query = async (sql, params = []) => {
    if (/information_schema\.COLUMNS/i.test(sql)) return [[{ total: 1, count: 1 }]];
    if (sql.includes("FROM unidades WHERE") && sql.includes("placa")) return [[{ sede: "Guapiles" }]];
    if (sql.includes("FROM usuarios_sedes")) return [[]];
    if (sql.includes("FROM taller_prioridades tp") && sql.includes("WHERE tp.id = ?")) {
      return [[{ id: Number(params[0]), placa_actual: "C179927", sede: "Guapiles", mostrar_operativos: 0 }]];
    }
    if (sql.includes("INSERT INTO taller_prioridades")) inserts.push(params);
    return [[]];
  };

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => { req.session = { user }; next(); });
  app.use("/taller", taller);
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
    const data = { placa: "C179927", observacion: "Revisar unidad", fecha_prioridad: "2026-09-25" };
    assert.equal((await post("/taller/prioridades", data)).status, 302);
    assert.equal(inserts[0].at(-1), 0);
    assert.equal(inserts[0][1], "Guapiles");
    assert.equal((await post("/taller/prioridades", { ...data, mostrar_operativos: "1" })).status, 302);
    assert.equal(inserts[1].at(-1), 1);

    user = { id: 2, usuario: "mecanico_guapiles", rol: "MECANICO", sede: "Guapiles" };
    assert.equal((await post("/taller/prioridades/5", data)).status, 403);
    assert.equal((await post("/taller/prioridades/5/atendida", {})).status, 403);
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});

test("TALLER ve prioridades de todas las sedes aunque esten ocultas para las pantallas operativas", async () => {
  const originalQuery = pool.query;
  let consultaPrioridades = "";
  const prioridadesInsertadas = [];
  const prioridadesActualizadas = [];
  const placaOcultaDeOtraSede = {
    id: 71,
    placa: "C179927",
    sede: "Guapiles",
    grupo_prioridad: "MECANICO",
    fecha_prioridad: "2026-10-05",
    fecha_prioridad_formato: "05/10/2026",
    dias_pendiente: 2,
    observacion: "Prioridad de prueba",
    estado: "PENDIENTE",
    mostrar_operativos: 0,
    creado_en: "2026-10-05 10:00:00",
    creado_por_nombre: "taller"
  };
  pool.query = async (sql, params = []) => {
    if (/information_schema\.COLUMNS/i.test(sql)) return [[{ count: 1, total: 1 }]];
    if (/CREATE TABLE IF NOT EXISTS/i.test(sql)) return [{}];
    if (sql.includes("FROM unidades WHERE") && sql.includes("placa")) {
      return [[{ id: 91, sede: "Guapiles" }]];
    }
    if (sql.includes("FROM taller_prioridades tp")) {
      consultaPrioridades = sql;
      return [[{ ...placaOcultaDeOtraSede, placa_actual: "C179927", sede_guardada: "Guapiles", observacion_actual: "Prioridad de prueba" }]];
    }
    if (sql.includes("INSERT INTO taller_prioridades")) {
      prioridadesInsertadas.push(params);
      return [{ insertId: prioridadesInsertadas.length }];
    }
    if (sql.includes("UPDATE taller_prioridades")) {
      prioridadesActualizadas.push(params);
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("COUNT(*) AS total")) return [[{ total: 0, en_taller: 0, disponibles: 0 }]];
    return [[]];
  };

  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "../src/views"));
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.session = {
      user: { id: 2, usuario: "taller", rol: "TALLER", sede: "Cartago" },
      sedeSeleccionada: "Cartago"
    };
    next();
  });
  app.use("/taller", taller);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/taller/dashboard`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.ok(html.includes("C179927"));
    assert.ok(html.includes("ADMIN + Jefe de Taller"));
    assert.ok(html.includes("id=\"mostrarOperativosNuevo\""));
    assert.ok(html.includes("Si no se marca, solo la verán ADMIN y Jefe de Taller."));
    assert.doesNotMatch(consultaPrioridades, /tp\.mostrar_operativos = 1/);
    assert.doesNotMatch(consultaPrioridades, /COALESCE\(NULLIF\(tp\.sede, ''\), un\.sede\)\) IN/);

    const agregar = async mostrarOperativos => fetch(`http://127.0.0.1:${server.address().port}/taller/prioridades`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ placa: "C179927", observacion: "Nueva prioridad", fecha_prioridad: "2026-10-06", ...(mostrarOperativos ? { mostrar_operativos: "1" } : {}) })
    });
    assert.equal((await agregar(false)).status, 302);
    assert.equal((await agregar(true)).status, 302);
    assert.deepEqual(prioridadesInsertadas.map(params => params.at(-1)), [0, 1]);

    const editar = await fetch(`http://127.0.0.1:${server.address().port}/taller/prioridades/71`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ placa: "C179927", observacion: "Prioridad actualizada", fecha_prioridad: "2026-10-05", mostrar_operativos: "1" })
    });
    assert.equal(editar.status, 302);
    assert.equal(prioridadesActualizadas[0][4], 1);

    const atender = await fetch(`http://127.0.0.1:${server.address().port}/taller/prioridades/71/atendida`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ fecha_salida: "2026-10-06T10:00" })
    });
    assert.equal(atender.status, 302);
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});

test("la pantalla de mecanicos separa Cartago, Tecnicos y Taller", async () => {
  const originalQuery = pool.query;
  const consultasUnidades = [];
  let prioridades = [
    { id: 1, placa: "CARTAGO-1", sede: "Cartago", grupo_prioridad: "MECANICO", fecha_prioridad: "2026-10-06", fecha_prioridad_formato: "06/10/2026", dias_pendiente: 2, observacion: "Cartago", estado: "PENDIENTE", mostrar_operativos: 1, creado_en: "2026-10-06 08:00:00", creado_por_nombre: "admin" },
    { id: 2, placa: "TECNICOS-1", sede: "Tecnicos", grupo_prioridad: "MECANICO", fecha_prioridad: "2026-10-06", fecha_prioridad_formato: "06/10/2026", dias_pendiente: 2, observacion: "Tecnicos", estado: "PENDIENTE", mostrar_operativos: 1, creado_en: "2026-10-06 08:00:00", creado_por_nombre: "admin" },
    { id: 3, placa: "TALLER-1", sede: "Taller", grupo_prioridad: "MECANICO", fecha_prioridad: "2026-10-06", fecha_prioridad_formato: "06/10/2026", dias_pendiente: 2, observacion: "Taller", estado: "PENDIENTE", mostrar_operativos: 1, creado_en: "2026-10-06 08:00:00", creado_por_nombre: "admin" }
  ];
  pool.query = async (sql, params = []) => {
    if (/information_schema\.COLUMNS/i.test(sql)) return [[{ count: 1, total: 1 }]];
    if (/CREATE TABLE IF NOT EXISTS/i.test(sql)) return [{}];
    if (sql.includes("COUNT(*) AS total")) return [[{ total: 0, en_taller: 0, disponibles: 0 }]];
    if (sql.includes("FROM unidades u")) {
      consultasUnidades.push({ sql, params });
      return [[]];
    }
    if (sql.includes("FROM taller_prioridades tp")) return [prioridades];
    if (sql.includes("FROM solicitudes_repuestos")) return [[]];
    return [[]];
  };

  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "../src/views"));
  app.use((req, _res, next) => {
    req.session = {
      user: { id: 90, usuario: "pantalla_mecanicos", nombre: "Pantalla Mecánicos", rol: "PANTALLA_MECANICOS", sede: "Todas" }
    };
    next();
  });
  app.use("/taller", taller);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/taller/dashboard`;
    const response = await fetch(url);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Cilindreros · Cartago/);
    assert.match(html, /Técnicos/);
    assert.match(html, />Taller</);
    assert.ok(html.includes("CARTAGO-1"));
    assert.ok(html.includes("TECNICOS-1"));
    assert.ok(html.includes("TALLER-1"));
    assert.deepEqual(consultasUnidades[0].params.at(-1), ["Cartago", "Tecnicos", "Taller"]);

    prioridades = [];
    const responseSinPrioridades = await fetch(url);
    const htmlSinPrioridades = await responseSinPrioridades.text();
    assert.equal(responseSinPrioridades.status, 200);
    assert.match(htmlSinPrioridades, /Cilindreros · Cartago/);
    assert.match(htmlSinPrioridades, /Técnicos/);
    assert.match(htmlSinPrioridades, />Taller</);
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});
