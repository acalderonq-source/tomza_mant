const { test } = require("node:test");
const assert = require("node:assert/strict");
const ejs = require("ejs");
const path = require("node:path");

const dashboardPath = path.join(__dirname, "..", "src", "views", "dashboard.ejs");

async function renderDashboard(departamentoActivo) {
  return ejs.renderFile(dashboardPath, {
    user: {
      usuario: "admin",
      rol: "ADMIN",
      sede: "TODAS",
      departamentos: ["TALLER", "OPERACIONES"],
      departamentoActivo
    },
    hoy: [],
    stats: {},
    sedeSeleccionada: "TODAS",
    sedesMultiples: [],
    usuarioPesados: false,
    sedesDashboard: [],
    etiquetaSede: sede => sede,
    ejecutivo: {},
    alertasEjecutivas: [],
    prioridadesTaller: [],
    puedeVerOficinaDiaDia: true
  });
}

test("el dashboard de Taller conserva los accesos operativos historicos para ADMIN", async () => {
  const html = await renderDashboard("TALLER");
  for (const href of [
    "/mantenimientos",
    "/unidades",
    "/reportes-supervisores/rutas",
    "/lavado-unidades",
    "/revision-ruta",
    "/dekra",
    "/minae",
    "/bodega",
    "/compras/facturas"
  ]) {
    assert.ok(html.includes(`href="${href}"`), `Falta el acceso ${href} en Taller`);
  }
});

test("el dashboard de Operaciones no mezcla modulos ni indicadores de Taller", async () => {
  const html = await renderDashboard("OPERACIONES");
  for (const href of [
    "/mantenimientos",
    "/unidades",
    "/reportes-supervisores/rutas",
    "/lavado-unidades",
    "/revision-ruta",
    "/dekra",
    "/minae",
    "/bodega",
    "/compras/facturas"
  ]) {
    assert.ok(!html.includes(`href="${href}"`), `Operaciones muestra el acceso de Taller ${href}`);
  }
  assert.ok(!html.includes("Módulos"));
  assert.ok(!html.includes("Mantenimientos de hoy"));
});
