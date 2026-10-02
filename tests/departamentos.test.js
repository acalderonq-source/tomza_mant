const test = require("node:test");
const assert = require("node:assert/strict");
const { DEPARTAMENTOS, departamentosInicialesPorRol, departamentosPermitidosPorRol, esDepartamentoValido, rutaPerteneceATaller, puedeAbrirRutaPorDepartamento, ensurePortalDepartmentSchema } = require("../src/utils/departamentos");

test("el portal ofrece los siete departamentos previstos", () => {
  assert.deepEqual(DEPARTAMENTOS.map(item => item.key), [
    "TALLER",
    "OPERACIONES",
    "CONTABILIDAD",
    "SEGURIDAD_OCUPACIONAL",
    "LOGISTICA",
    "PROVEEDURIA",
    "RECURSOS_HUMANOS"
  ]);
});

test("la matriz inicial mantiene separados los accesos principales", () => {
  assert.deepEqual(departamentosInicialesPorRol("MECANICO"), ["TALLER"]);
  assert.deepEqual(departamentosInicialesPorRol("TALLER"), ["TALLER"]);
  assert.ok(departamentosInicialesPorRol("SUPERVISOR").includes("OPERACIONES"));
  assert.deepEqual(departamentosInicialesPorRol("CONTABILIDAD"), ["CONTABILIDAD"]);
  assert.deepEqual(departamentosInicialesPorRol("ADMIN"), DEPARTAMENTOS.map(item => item.key));
});

test("un nuevo usuario TALLER sin asignaciones recibe solamente Taller", async () => {
  const asignaciones = [];
  const pool = {
    async query(sql, params = []) {
      if (sql.includes("SELECT asignacion_inicial_completa")) return [[{ asignacion_inicial_completa: 1 }]];
      if (sql.includes("SELECT u.id, u.rol, u.usuario")) {
        return [[{ id: 55, rol: "TALLER", usuario: "taller_nuevo" }]];
      }
      if (sql.includes("INSERT IGNORE INTO usuario_departamentos")) asignaciones.push(params);
      return [{ affectedRows: 1 }];
    }
  };

  await ensurePortalDepartmentSchema(pool);
  assert.deepEqual(asignaciones, [[55, "TALLER", 1]]);
});

test("ADMIN conserva acceso a todos los departamentos aunque su asignación guardada esté incompleta", () => {
  assert.deepEqual(departamentosPermitidosPorRol("ADMIN", ["TALLER"]), DEPARTAMENTOS.map(item => item.key));
  assert.deepEqual(departamentosPermitidosPorRol("MECANICO", ["TALLER"]), ["TALLER"]);
});

test("la validación de clave de área no acepta valores arbitrarios", () => {
  assert.equal(esDepartamentoValido("taller"), true);
  assert.equal(esDepartamentoValido("ADMIN"), false);
  assert.equal(esDepartamentoValido("../../admin"), false);
});

test("los módulos de Taller se identifican por ruta sin confundir rutas similares", () => {
  assert.equal(rutaPerteneceATaller("/mantenimientos/25"), true);
  assert.equal(rutaPerteneceATaller("/compras/facturas"), true);
  assert.equal(rutaPerteneceATaller("/api/unidades/buscar"), true);
  assert.equal(rutaPerteneceATaller("/dashboard"), false);
  assert.equal(rutaPerteneceATaller("/talleres"), false);
  assert.equal(rutaPerteneceATaller("/departamento/activo"), false);
  assert.equal(puedeAbrirRutaPorDepartamento("OPERACIONES", "/mantenimientos"), false);
  assert.equal(puedeAbrirRutaPorDepartamento("OPERACIONES", "/compras/facturas"), false);
  assert.equal(puedeAbrirRutaPorDepartamento("OPERACIONES", "/bodega"), false);
  assert.equal(puedeAbrirRutaPorDepartamento("CONTABILIDAD", "/compras/facturas/asientos"), true);
  assert.equal(puedeAbrirRutaPorDepartamento("CONTABILIDAD", "/compras/ordenes"), true);
  assert.equal(puedeAbrirRutaPorDepartamento("CONTABILIDAD", "/aresep"), true);
  assert.equal(puedeAbrirRutaPorDepartamento("CONTABILIDAD", "/mantenimientos"), false);
  assert.equal(puedeAbrirRutaPorDepartamento("PROVEEDURIA", "/compras/facturas"), true);
  assert.equal(puedeAbrirRutaPorDepartamento("PROVEEDURIA", "/compras/ordenes/42"), true);
  assert.equal(puedeAbrirRutaPorDepartamento("PROVEEDURIA", "/bodega/inventario"), true);
  assert.equal(puedeAbrirRutaPorDepartamento("PROVEEDURIA", "/repuestos"), true);
  assert.equal(puedeAbrirRutaPorDepartamento("PROVEEDURIA", "/aceite/rellenos"), true);
  assert.equal(puedeAbrirRutaPorDepartamento("PROVEEDURIA", "/mantenimientos"), false);
  assert.equal(puedeAbrirRutaPorDepartamento("OPERACIONES", "/dashboard"), true);
  assert.equal(puedeAbrirRutaPorDepartamento("TALLER", "/mantenimientos"), true);
});

test("el primer arranque deja todos los usuarios actuales en Taller y no repite la normalización", async () => {
  const executed = [];
  let initialized = 0;
  const pool = {
    async query(sql, params = []) {
      executed.push({ sql, params });
      if (sql.includes("SELECT asignacion_inicial_completa")) return [[{ asignacion_inicial_completa: initialized }]];
      if (sql.includes("UPDATE portal_departamento_config SET")) initialized = 1;
      if (sql.includes("SELECT u.id, u.rol, u.usuario")) {
        return [[]];
      }
      return [{ affectedRows: 1 }];
    }
  };

  await ensurePortalDepartmentSchema(pool);
  assert.match(executed[0].sql, /CREATE TABLE IF NOT EXISTS usuario_departamentos/);
  assert.ok(executed.some(item => item.sql.includes("DELETE FROM usuario_departamentos WHERE departamento <> 'TALLER'")));
  assert.ok(executed.some(item => item.sql.includes("SELECT id, 'TALLER', 1 FROM usuarios")));
  assert.equal(initialized, 1);
  await ensurePortalDepartmentSchema(pool);
  assert.equal(executed.filter(item => item.sql.includes("DELETE FROM usuario_departamentos WHERE departamento <> 'TALLER'")).length, 1);
});
