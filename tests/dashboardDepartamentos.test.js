const { test } = require("node:test");
const assert = require("node:assert/strict");
const ejs = require("ejs");
const path = require("node:path");
const { puedeAbrirRutaPorDepartamento, rutaPerteneceATaller } = require("../src/utils/departamentos");

const dashboardPath = path.join(__dirname, "..", "src", "views", "dashboard.ejs");

async function renderDashboard(departamentoActivo, rol = "ADMIN", usuario = "admin") {
  return ejs.renderFile(dashboardPath, {
    user: {
      usuario,
      rol,
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
    "/dashboard/resumen-ejecutivo",
    "/mantenimientos",
    "/kpis/mecanicos",
    "/reportes-supervisores",
    "/reportes-supervisores/rutas",
    "/unidades",
    "/taller/dashboard",
    "/taller/prioridades-historial",
    "/logistica-taller",
    "/lavado-unidades",
    "/revision-ruta",
    "/giras",
    "/llantas",
    "/repuestos",
    "/repuestos-semanales",
    "/bodega",
    "/ordenes-motor",
    "/oficina-dia-dia",
    "/dekra",
    "/minae",
    "/aceite",
    "/aires",
    "/aresep",
    "/compras/ordenes",
    "/compras/facturas"
  ]) {
    assert.ok(html.includes(`href="${href}"`), `Falta el acceso ${href} en Taller`);
  }
});

test("el rol TALLER conserva sus accesos de trabajo al seleccionar Taller", async () => {
  const html = await renderDashboard("TALLER", "TALLER", "taller");
  for (const href of [
    "/mantenimientos",
    "/unidades",
    "/reportes-supervisores",
    "/reportes-supervisores/rutas",
    "/taller/dashboard",
    "/lavado-unidades",
    "/revision-ruta",
    "/dekra",
    "/minae",
    "/bodega",
    "/repuestos-semanales",
    "/compras/ordenes",
    "/compras/facturas"
  ]) {
    assert.ok(html.includes(`href="${href}"`), `Falta el acceso ${href} para el rol TALLER`);
  }
});

test("el dashboard de Operaciones no mezcla modulos ni indicadores de Taller", async () => {
  const html = await renderDashboard("OPERACIONES");
  for (const href of [
    "/mantenimientos",
    "/dashboard/resumen-ejecutivo",
    "/kpis/mecanicos",
    "/unidades",
    "/reportes-supervisores",
    "/reportes-supervisores/rutas",
    "/taller/dashboard",
    "/taller/prioridades-historial",
    "/logistica-taller",
    "/lavado-unidades",
    "/revision-ruta",
    "/giras",
    "/llantas",
    "/repuestos",
    "/repuestos-semanales",
    "/dekra",
    "/minae",
    "/bodega",
    "/ordenes-motor",
    "/oficina-dia-dia",
    "/aceite",
    "/aires",
    "/aresep",
    "/compras/ordenes",
    "/compras/facturas"
  ]) {
    assert.ok(!html.includes(`href="${href}"`), `Operaciones muestra el acceso de Taller ${href}`);
  }
  assert.ok(!html.includes("Módulos"));
  assert.ok(!html.includes("Mantenimientos de hoy"));
});

test("Contabilidad ve facturas y asientos sin ver módulos operativos de Taller", async () => {
  const html = await renderDashboard("CONTABILIDAD", "CONTABILIDAD", "contabilidad");
  assert.ok(html.includes('href="/compras/facturas"'));
  assert.ok(html.includes('href="/compras/facturas/asientos"'));
  assert.ok(!html.includes('href="/mantenimientos"'));
  assert.ok(!html.includes('href="/unidades"'));
});

test("Proveeduría ve compras y bodega con sus módulos visibles", async () => {
  const html = await renderDashboard("PROVEEDURIA", "PROVEEDURIA_TALLER", "proveeduria");
  for (const href of ["/compras/ordenes", "/compras/facturas", "/bodega", "/repuestos-semanales", "/repuestos"]) {
    assert.ok(html.includes(`href="${href}"`), `Falta el acceso autorizado ${href} en Proveeduría`);
  }
  assert.ok(!html.includes('href="/mantenimientos"'));
  assert.ok(!html.includes('href="/unidades"'));
  assert.ok(!html.includes('href="/dashboard/resumen-ejecutivo"'));
});

test("cada módulo visible que pertenece a Taller es accesible desde el área activa", async () => {
  const casos = [
    { departamento: "TALLER", rol: "ADMIN", usuario: "admin" },
    { departamento: "OPERACIONES", rol: "ADMIN", usuario: "admin" },
    { departamento: "CONTABILIDAD", rol: "CONTABILIDAD", usuario: "contabilidad" },
    { departamento: "PROVEEDURIA", rol: "PROVEEDURIA_TALLER", usuario: "proveeduria" },
    { departamento: "PROVEEDURIA", rol: "PROVEEDURIA", usuario: "proveeduria" },
    { departamento: "PROVEEDURIA", rol: "BODEGUERO", usuario: "bodeguero" }
  ];

  for (const caso of casos) {
    const html = await renderDashboard(caso.departamento, caso.rol, caso.usuario);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    for (const href of hrefs) {
      const pathname = new URL(href, "http://localhost").pathname;
      if (!rutaPerteneceATaller(pathname)) continue;
      assert.equal(
        puedeAbrirRutaPorDepartamento(caso.departamento, pathname),
        true,
        `${caso.rol} ve ${pathname} en ${caso.departamento}, pero el middleware lo bloquea`
      );
    }
  }
});
