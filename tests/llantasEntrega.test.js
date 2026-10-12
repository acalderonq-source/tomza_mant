const test = require("node:test");
const assert = require("node:assert/strict");
const { destinoEntrega, nombreCedi, prepararCotizacion } = require("../src/utils/llantasEntrega");

test("llanta delivery locations match the Cartago, Alajuela and Guanacaste groups", () => {
  assert.equal(destinoEntrega("Cartago"), "CARTAGO");
  assert.equal(destinoEntrega("Perez Zeledon"), "CARTAGO");
  assert.equal(destinoEntrega("Granel Cartago"), "CARTAGO");
  for (const sede of ["Guapiles", "Orotina", "Alajuela", "San Carlos", "Rio Claro", "Granel Alajuela"]) {
    assert.equal(destinoEntrega(sede), "ALAJUELA", sede);
  }
  for (const sede of ["Nicoya", "La Cruz", "Granel La Cruz"]) {
    assert.equal(destinoEntrega(sede), "GUANACASTE", sede);
  }
});

test("delivery form normalizes CEDI labels, orders merged destinations, and totals tires", () => {
  assert.equal(nombreCedi("Granel Perez Zeledon"), "PZ");
  assert.equal(nombreCedi("Granel Guapiles"), "Guapiles");
  const result = prepararCotizacion([
    { sede: "La Cruz", placa: "C300", cantidad: 2, medida: "11R22.5", marca_sugerida: "X", posicion: "Tracción" },
    { sede: "Guapiles", placa: "C200", cantidad: 1, medida: "11R22.5" },
    { sede: "Perez Zeledon", placa: "C100", cantidad: 4, medida: "295/80R22.5" }
  ]);
  assert.deepEqual(result.grupos.map(grupo => grupo.entregar), ["CARTAGO", "ALAJUELA", "GUANACASTE"]);
  assert.deepEqual(result.grupos.map(grupo => grupo.filas[0].cedi), ["PZ", "Guapiles", "La Cruz"]);
  assert.equal(result.grupos[2].filas[0].descripcion, "11R22.5, X, Tracción");
  assert.equal(result.totalUnidades, 7);
});
