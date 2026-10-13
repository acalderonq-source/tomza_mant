const test = require("node:test");
const assert = require("node:assert/strict");
const router = require("../src/routes/controlCambiosAceite.routes");

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
