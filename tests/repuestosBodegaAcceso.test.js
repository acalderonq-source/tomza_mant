const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const ejs = require("ejs");
const path = require("node:path");
const pool = require("../src/db");
const router = require("../src/routes/repuestos.routes");

for (const rol of ["BODEGUERO", "BODEGA"]) {
  test(`${rol} consulta solicitudes de todas las sedes sin acceso a modificaciones`, async () => {
    const original = pool.query;
    let sedesConsulta;
    pool.query = async (sql, params = []) => {
      if (/INFORMATION_SCHEMA/i.test(sql)) return [[{ count: 1 }]];
      if (sql.includes("SELECT DISTINCT sede")) return [[{ sede: "Sede nueva" }]];
      if (sql.includes("FROM solicitudes_repuestos sr")) {
        sedesConsulta = params[0];
        return [[{ id: 1, sede: "Sede nueva", placa: "C123", estado: "PEDIDO" }]];
      }
      if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) throw new Error("No debe modificar solicitudes");
      return [[]];
    };
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => {
      req.session = { user: { id: 2, usuario: "bodeguero", rol, sede: "Cartago" } };
      res.render = (_view, data) => res.json(data);
      next();
    });
    app.use("/repuestos", router);
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const response = await fetch(base + "/repuestos");
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.solicitudes.length, 1);
      assert.ok(sedesConsulta.includes("Sede nueva"));
      assert.equal(data.puedeCrearSolicitud, false);
      assert.equal(data.puedeGestionar, false);
      assert.equal(data.puedeEntregar, false);
      for (const ruta of ["", "/1/entregar", "/1/salida", "/1/estado", "/1/eliminar"]) {
        assert.equal((await fetch(base + "/repuestos" + ruta, { method: "POST" })).status, 403, ruta);
      }
    } finally {
      pool.query = original;
      await new Promise(resolve => server.close(resolve));
    }
  });
}

test("el bodeguero encuentra Solicitud de repuestos en su inicio de Proveeduría", async () => {
  const html = await ejs.renderFile(path.join(__dirname, "../src/views/dashboard.ejs"), {
    user: { rol: "BODEGUERO", usuario: "bodeguero", sede: "Cartago", departamentoActivo: "PROVEEDURIA", departamentos: ["TALLER", "PROVEEDURIA"] },
    stats: {}, ejecutivo: {}, hoy: [], sedeSeleccionada: "TODAS", sedesMultiples: [], prioridadesTaller: []
  });
  assert.ok(html.includes('href="/repuestos"'));
});
