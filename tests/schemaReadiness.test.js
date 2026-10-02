const { test } = require("node:test");
const assert = require("node:assert/strict");
const { verificarColumnasRequeridas } = require("../src/utils/schemaReadiness");

test("readiness accepts the required workshop schema", async () => {
  const result = await verificarColumnasRequeridas(async (sql, params) => {
    assert.match(sql, /INFORMATION_SCHEMA\.COLUMNS/);
    assert.deepEqual(params, ["unidades", "bodega_ordenes_consumo"]);
    return [[
      ...["id", "placa", "sede", "activa", "varada", "comodin"].map(columna => ({ tabla: "unidades", columna })),
      ...["orden_compra_id", "proveedor_id", "fecha_desde", "fecha_hasta", "contacto_confirmacion", "referencia_confirmacion", "confirmado_por", "confirmado_en"]
        .map(columna => ({ tabla: "bodega_ordenes_consumo", columna }))
    ]];
  }, {
    unidades: ["id", "placa", "sede", "activa", "varada", "comodin"],
    bodega_ordenes_consumo: ["orden_compra_id", "proveedor_id", "fecha_desde", "fecha_hasta", "contacto_confirmacion", "referencia_confirmacion", "confirmado_por", "confirmado_en"]
  });

  assert.deepEqual(result, { listo: true, faltantes: [] });
});

test("readiness identifies absent columns rather than trusting database connectivity", async () => {
  const result = await verificarColumnasRequeridas(async () => [[
    { tabla: "unidades", columna: "id" },
    { tabla: "unidades", columna: "placa" }
  ]], {
    unidades: ["id", "placa", "comodin"],
    bodega_ordenes_consumo: ["contacto_confirmacion", "confirmado_en"]
  });

  assert.equal(result.listo, false);
  assert.deepEqual(result.faltantes, [
    { tabla: "unidades", columna: "comodin" },
    { tabla: "bodega_ordenes_consumo", columna: "contacto_confirmacion" },
    { tabla: "bodega_ordenes_consumo", columna: "confirmado_en" }
  ]);
});

test("readiness handles an empty requirements set", async () => {
  const result = await verificarColumnasRequeridas(async () => {
    throw new Error("no query should be made");
  }, {});
  assert.deepEqual(result, { listo: true, faltantes: [] });
});
