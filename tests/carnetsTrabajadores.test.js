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

test("administra carnets y el QR no expone cédula ni PIN", async () => {
  const token = "a".repeat(64);
  await withServer(async sql => {
    assert.match(sql, /FROM carnets_trabajador/);
    return [[{ qr_token: token, nombre: "Trabajador Prueba", codigo_trabajador: "2790", perfil: "TALLER", tiene_foto: 0 }]];
  }, "ADMIN", async base => {
    const response = await fetch(`${base}/admin/carnets-trabajadores`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Trabajador Prueba/);
    assert.match(html, /PIN inicial \/ código de trabajador/);
    assert.match(html, /data:image\/png;base64,/);
    assert.match(html, new RegExp(`data-token="${token}"`));
    assert.doesNotMatch(html, /cedula|pin_hash/i);
  });
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
