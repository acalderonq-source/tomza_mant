const { test } = require("node:test");
const assert = require("node:assert/strict");
const { verificarColumnasRequeridas, COLUMNAS_ESENCIALES_TALLER } = require("../src/utils/schemaReadiness");

test("readiness accepts the required Taller and Bodega schema", async () => {
  const result = await verificarColumnasRequeridas(async (sql, params) => {
    assert.match(sql, /INFORMATION_SCHEMA\.COLUMNS/);
    assert.deepEqual(params, Object.keys(COLUMNAS_ESENCIALES_TALLER));
    return [Object.entries(COLUMNAS_ESENCIALES_TALLER).flatMap(([tabla, columnas]) =>
      columnas.map(columna => ({ tabla, columna }))
    )];
  }, COLUMNAS_ESENCIALES_TALLER);

  assert.deepEqual(result, { listo: true, faltantes: [] });
});

test("readiness identifies absent inventory columns rather than trusting database connectivity", async () => {
  const columnas = COLUMNAS_ESENCIALES_TALLER.bodega_existencias;
  const result = await verificarColumnasRequeridas(async () => [[
    { tabla: "bodega_existencias", columna: "id" },
    { tabla: "bodega_existencias", columna: "articulo_id" }
  ]], { bodega_existencias: columnas });

  assert.equal(result.listo, false);
  assert.deepEqual(result.faltantes, columnas.slice(2).map(columna => ({ tabla: "bodega_existencias", columna })));
});

test("readiness handles an empty requirements set", async () => {
  const result = await verificarColumnasRequeridas(async () => {
    throw new Error("no query should be made");
  }, {});
  assert.deepEqual(result, { listo: true, faltantes: [] });
});
