const test = require("node:test");
const assert = require("node:assert/strict");
const router = require("../src/routes/controlCambiosAceite.routes");
const pool = require("../src/db");

test("proyecta próxima fecha con intervalo y kilometraje mensual", () => {
  assert.equal(router.calcularFechaProximoCambio("2026-01-01", 5000, 10000), "2026-03-03");
});

test("calcula alertas de vencido, hoy, próximos 30 días y programado", () => {
  assert.equal(router.estadoProgramacion("2026-10-12", "2026-10-13").clave, "vencido");
  assert.equal(router.estadoProgramacion("2026-10-13", "2026-10-13").clave, "hoy");
  assert.equal(router.estadoProgramacion("2026-11-12", "2026-10-13").clave, "proximo");
  assert.equal(router.estadoProgramacion("2026-11-13", "2026-10-13").clave, "programado");
});

test("acepta fechas reales en formato ISO y rechaza fechas imposibles", () => {
  assert.equal(router.fechaValida("2026-02-28"), true);
  assert.equal(router.fechaValida("2026-02-30"), false);
  assert.equal(router.fechaValida("28/02/2026"), false);
});

test("inicializa solo la tabla independiente del nuevo control", async () => {
  const queryOriginal = pool.query;
  let sqlEjecutado = "";
  pool.query = async sql => { sqlEjecutado = sql; };
  try {
    await router.asegurarTablaProgramaciones();
  } finally {
    pool.query = queryOriginal;
  }
  assert.match(sqlEjecutado, /CREATE TABLE IF NOT EXISTS control_cambios_aceite_programaciones/);
  assert.doesNotMatch(sqlEjecutado, /cambios_aceite_historial|aceite_estanones|aceite_movimientos/);
});

test("incluye Granel y excluye Cisternas y Carretas del filtro Transportadora", () => {
  assert.equal(router.grupoUnidad("granel_perez_zeledon"), "granel");
  assert.equal(router.grupoUnidad("Granel"), "granel");
  assert.equal(router.grupoUnidad("Cabezales"), "transportadora");
  assert.ok(router.sedesGranel.includes("granel_alajuela"));
  assert.ok(!router.sedesTransportadora.includes("Cisternas"));
  assert.ok(!router.sedesTransportadora.includes("Carretas"));
});
