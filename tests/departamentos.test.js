const test = require("node:test");
const assert = require("node:assert/strict");
const { DEPARTAMENTOS, departamentosInicialesPorRol, esDepartamentoValido, ensurePortalDepartmentSchema } = require("../src/utils/departamentos");

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
  assert.ok(departamentosInicialesPorRol("SUPERVISOR").includes("OPERACIONES"));
  assert.deepEqual(departamentosInicialesPorRol("CONTABILIDAD"), ["CONTABILIDAD"]);
  assert.deepEqual(departamentosInicialesPorRol("ADMIN"), DEPARTAMENTOS.map(item => item.key));
});

test("la validación de clave de área no acepta valores arbitrarios", () => {
  assert.equal(esDepartamentoValido("taller"), true);
  assert.equal(esDepartamentoValido("ADMIN"), false);
  assert.equal(esDepartamentoValido("../../admin"), false);
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
