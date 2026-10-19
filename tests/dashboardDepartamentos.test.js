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

test("Seguridad Ocupacional muestra Solicitud de suministros como primer módulo con formato de Taller", async () => {
  for (const rol of ["ADMIN", "SUPERVISOR"]) {
    const html = await renderDashboard("SEGURIDAD_OCUPACIONAL", rol);
    const grid = html.match(/<div class="module-grid">([\s\S]*?)<\/section>/);
    assert.ok(grid, "El área debe mostrar la misma cuadrícula de módulos de Taller");
    assert.match(grid[1], /class="module-card"/);
    assert.match(grid[1], /class="module-title">Solicitud de suministros<\/div>/);
    assert.equal([...grid[1].matchAll(/href="([^"]+)"/g)][0][1], "/proveeduria/mis-solicitudes");
    assert.doesNotMatch(html, /Área en preparación|Solicitudes a Proveeduría/);
    assert.doesNotMatch(html, /href="\/mantenimientos"/);
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

test("Proveeduría-Taller ve sus módulos de compras y todas las opciones de Taller", async () => {
  const html = await renderDashboard("PROVEEDURIA", "PROVEEDURIA_TALLER", "proveeduria");
  for (const href of [
    "/compras/ordenes", "/compras/facturas", "/bodega", "/repuestos-semanales", "/repuestos",
    "/mantenimientos", "/unidades", "/taller/dashboard", "/lavado-unidades", "/dekra",
    "/minae", "/aceite", "/aires", "/llantas", "/reportes-supervisores", "/dashboard/resumen-ejecutivo"
  ]) {
    assert.ok(html.includes(`href="${href}"`), `Falta el acceso autorizado ${href} para Proveeduría-Taller`);
  }
});

test("Proveeduría sin perfil Taller mantiene el acceso limitado a sus módulos", async () => {
  const html = await renderDashboard("PROVEEDURIA", "PROVEEDURIA", "proveeduria");
  assert.ok(!html.includes('href="/mantenimientos"'));
  assert.ok(!html.includes('href="/unidades"'));
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
        puedeAbrirRutaPorDepartamento(caso.departamento, pathname, caso.rol),
        true,
        `${caso.rol} ve ${pathname} en ${caso.departamento}, pero el middleware lo bloquea`
      );
    }
  }
});
