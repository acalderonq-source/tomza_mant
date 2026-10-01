const test = require("node:test");
const assert = require("node:assert/strict");
const { DEPARTAMENTOS, departamentosInicialesPorRol, esDepartamentoValido } = require("../src/utils/departamentos");

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
