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

test("el arranque crea la tabla y asigna solo usuarios que aún no tienen áreas", async () => {
  const executed = [];
  const pool = {
    async query(sql, params = []) {
      executed.push({ sql, params });
      if (sql.includes("SELECT u.id, u.rol, u.usuario")) {
        return [[{ id: 1, rol: "ADMIN", usuario: "admin" }, { id: 2, rol: "MECANICO", usuario: "mecanico_pz" }]];
      }
      return [{ affectedRows: 1 }];
    }
  };

  await ensurePortalDepartmentSchema(pool);
  assert.match(executed[0].sql, /CREATE TABLE IF NOT EXISTS usuario_departamentos/);
  assert.deepEqual(executed.slice(2).map(item => item.params[1]), [...DEPARTAMENTOS.map(item => item.key), "TALLER"]);
});
