const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const path = require("node:path");
const pool = require("../src/db");
const carnetsRoutes = require("../src/routes/carnets.routes");

async function withServer(queryHandler, role, run) {
  const originalQuery = pool.query;
  pool.query = queryHandler;
  const app = express();
  app.set("views", path.join(__dirname, "..", "src", "views"));
  app.set("view engine", "ejs");
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => {
    req.session = { user: role ? { id: 1, rol: role } : null };
    next();
  });
  app.use("/", carnetsRoutes);
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

test("administra carnets y no expone el hash del PIN", async () => {
  const token = "a".repeat(64);
  await withServer(async sql => {
    if (sql.includes("FROM carnets_trabajador")) {
      return [[{ qr_token: token, nombre: "Trabajador Prueba", codigo_trabajador: "2790", perfil: "TALLER", tiene_foto: 0 }]];
    }
    if (sql.includes("FROM usuarios")) return [[{ id: 4, usuario: "taller", nombre: "Jefatura de Taller", rol: "TALLER", sede: "Cartago" }]];
    throw new Error("Consulta inesperada");
  }, "ADMIN", async base => {
    const response = await fetch(`${base}/admin/carnets-trabajadores`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Trabajador Prueba/);
    assert.match(html, /PIN \/ código de trabajador/);
    assert.match(html, /data:image\/png;base64,/);
    assert.match(html, new RegExp(`data-token="${token}"`));
    assert.match(html, /Crear acceso y carnet/);
    assert.match(html, /Jefatura de Taller/);
    assert.doesNotMatch(html, /pin_hash/i);
  });
});

test("ADMIN crea acceso con código-PIN, perfiles y carnet QR en una transacción", async () => {
  const originalQuery = pool.query;
  const originalConnection = pool.getConnection;
  const events = [];
  const inserts = [];
  let carnet;
  pool.query = async () => [[]];
  pool.getConnection = async () => ({
    beginTransaction: async () => events.push("begin"),
    commit: async () => events.push("commit"),
    rollback: async () => events.push("rollback"),
    release: () => {},
    query: async (sql, params = []) => {
      if (sql.includes("SELECT id, usuario, nombre, rol") && sql.includes("WHERE id IN")) {
        return [[
          { id: 2, usuario: "mecanico", nombre: "Mecánico", rol: "MECANICO" },
          { id: 3, usuario: "pesados", nombre: "Pesados", rol: "SUPERVISOR_PESADO" }
        ]];
      }
      if (sql.includes("FROM usuario_cedulas WHERE cedula")) return [[]];
      if (sql.includes("FROM usuarios WHERE cedula")) return [[]];
      if (sql.includes("FROM usuario_cedulas WHERE codigo_trabajador")) return [[]];
      if (sql.includes("INSERT INTO usuario_cedulas")) {
        inserts.push({ sql, params });
        return [{ insertId: inserts.length }];
      }
      if (sql.includes("INSERT INTO carnets_trabajador")) {
        carnet = params;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    }
  });

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => { req.session = { user: { id: 1, rol: "ADMIN" } }; next(); });
  app.use("/", carnetsRoutes);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const invalido = await fetch(`http://127.0.0.1:${server.address().port}/admin/carnets-trabajadores`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ nombre: "Sin cédula", codigo_trabajador: "88", usuario_ids: "2" })
    });
    assert.equal(invalido.status, 302);
    assert.deepEqual(events, []);

    const body = new URLSearchParams({
      nombre: "Trabajador Nuevo",
      cedula: "1-0808-0596",
      codigo_trabajador: "2874",
      perfil: "Enderezado y Pintura"
    });
    body.append("usuario_ids", "2");
    body.append("usuario_ids", "3");
    const response = await fetch(`http://127.0.0.1:${server.address().port}/admin/carnets-trabajadores`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/admin/carnets-trabajadores");
    assert.deepEqual(events, ["begin", "commit"]);
    assert.equal(inserts.length, 2);
    assert.deepEqual(inserts.map(item => item.params.slice(0, 4)), [
      ["108080596", 2, "Trabajador Nuevo", "2874"],
      ["108080596", 3, "Trabajador Nuevo", "2874"]
    ]);
    assert.equal(inserts[0].params[4], inserts[1].params[4]);
    assert.ok(carnet);
    assert.equal(carnet[0], "108080596");
    assert.match(carnet[1], /^[a-f0-9]{64}$/);
  } finally {
    pool.query = originalQuery;
    pool.getConnection = originalConnection;
    await new Promise(resolve => server.close(resolve));
  }
});

test("rechaza el panel de carnets para perfiles que no son admin", async () => {
  await withServer(async () => { throw new Error("No debe consultar datos."); }, "MECANICO", async base => {
    const response = await fetch(`${base}/admin/carnets-trabajadores`);
    assert.equal(response.status, 403);
  });
});

test("descarga un carnet individual como PDF y adjunto", async () => {
  const token = "c".repeat(64);
  await withServer(async sql => {
    if (sql.includes("MAX(uc.persona_nombre)")) {
      return [[{ cedula: "no-expuesta", qr_token: token, nombre: "Nombre de Prueba", codigo_trabajador: "2790", perfil: "TALLER" }]];
    }
    if (sql.includes("SELECT foto_data")) return [[{ foto_data: null }]];
    throw new Error("Consulta no esperada");
  }, "ADMIN", async base => {
    const response = await fetch(`${base}/admin/carnets-trabajadores/${token}.pdf`);
    const pdf = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/pdf/);
    assert.match(response.headers.get("content-disposition"), /attachment; filename="carnet_2790_Nombre_de_Prueba\.pdf"/);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  });
});

test("solo acepta una fotografía JPEG válida y limitada", async () => {
  const token = "b".repeat(64);
  let saved = false;
  await withServer(async (sql, params) => {
    assert.match(sql, /UPDATE carnets_trabajador/);
    assert.equal(params[1], "image/jpeg");
    saved = true;
    return [{ affectedRows: 1 }];
  }, "ADMIN", async base => {
    const bad = await fetch(`${base}/admin/carnets-trabajadores/${token}/foto`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ foto: "not-an-image" })
    });
    assert.equal(bad.status, 400);
    assert.equal(saved, false);

    const validJpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64")}`;
    const response = await fetch(`${base}/admin/carnets-trabajadores/${token}/foto`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ foto: validJpeg })
    });
    assert.equal(response.status, 200);
    assert.equal(saved, true);
  });
});
