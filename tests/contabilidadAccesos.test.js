const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const ejs = require("ejs");
const path = require("node:path");
const { crearAccesos } = require("../src/scripts/crearAccesosContabilidad");
const { puedeAbrirRutaPorDepartamento } = require("../src/utils/departamentos");
const compras = require("../src/routes/compras.routes");

test("Contabilidad puede consultar compras y sus reportes sin permisos de modificar órdenes", () => {
  for (const ruta of ["/dashboard", "/dashboard/proveedores/pdf", "/facturas", "/ordenes", "/facturas/asientos"]) {
    assert.equal(puedeAbrirRutaPorDepartamento("CONTABILIDAD", "/compras" + ruta), true);
    const layer = compras.stack.find(item => item.route?.path === ruta && item.route.methods.get);
    assert.ok(layer, ruta);
    let allowed = false;
    layer.route.stack[1].handle({ session: { user: { rol: "CONTABILIDAD" } } }, {
      status() { throw new Error("No debe rechazar Contabilidad"); }
    }, () => { allowed = true; });
    assert.equal(allowed, true, ruta);
  }
  assert.equal(puedeAbrirRutaPorDepartamento("CONTABILIDAD", "/mantenimientos"), false);
});

test("el inicio de Contabilidad muestra los cuatro apartados solicitados", async () => {
  const html = await ejs.renderFile(path.join(__dirname, "../src/views/dashboard.ejs"), {
    user: { rol: "CONTABILIDAD", usuario: "contabilidad", sede: "TODAS", departamentoActivo: "CONTABILIDAD", departamentos: ["CONTABILIDAD"] },
    stats: {}, ejecutivo: {}, hoy: [], sedeSeleccionada: "TODAS", sedesMultiples: [], prioridadesTaller: []
  });
  for (const ruta of ["/compras/dashboard", "/compras/ordenes", "/compras/facturas", "/compras/facturas/asientos"]) assert.ok(html.includes(`href="${ruta}"`), ruta);
});

test("crea acceso con PIN cifrado, departamento y carnet en una transacción", async () => {
  const writes = [];
  let committed = false;
  const db = { async getConnection() { return {
    async beginTransaction() {},
    async query(sql, params) {
      if (sql.trim().startsWith("SELECT")) return [[]];
      writes.push({ sql, params });
      return [{ insertId: 77 }];
    },
    async commit() { committed = true; }, async rollback() {}, release() {}
  }; } };
  await crearAccesos([{ nombre: "Persona de prueba", cedula: "123456789", codigo: "1234", usuario: "prueba.contabilidad" }], true, db);
  const cedula = writes.find(item => item.sql.includes("INSERT INTO usuario_cedulas"));
  assert.equal(await bcrypt.compare("1234", cedula.params[4]), true);
  assert.ok(writes.some(item => item.sql.includes("usuario_departamentos") && item.sql.includes("CONTABILIDAD")));
  assert.ok(writes.some(item => item.sql.includes("carnets_trabajador")));
  assert.equal(committed, true);
});

test("no modifica una cédula vinculada a otro perfil", async () => {
  let rollback = false;
  const db = { async getConnection() { return {
    async beginTransaction() {},
    async query(sql) {
      assert.ok(sql.trim().startsWith("SELECT"));
      return [[{ id: 1, usuario: "admin", rol: "ADMIN" }]];
    },
    async commit() { throw new Error("No debe confirmar"); }, async rollback() { rollback = true; }, release() {}
  }; } };
  await assert.rejects(crearAccesos([{ nombre: "Prueba", cedula: "123456789", codigo: "1234", usuario: "prueba.contabilidad" }], true, db), /otro perfil/);
  assert.equal(rollback, true);
});
