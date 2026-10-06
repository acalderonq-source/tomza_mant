const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizarPeriodoCierre,
  rangoFechasDesdePeriodo,
  resolverFiltrosPeriodoResumen
} = require("../src/utils/periodoResumenEjecutivo");

test("normaliza meses válidos y rechaza meses inexistentes", () => {
  assert.equal(normalizarPeriodoCierre("2026-09"), "2026-09");
  assert.equal(normalizarPeriodoCierre("2026-13"), "");
});

test("el periodo elegido reemplaza rangos de fechas anteriores", () => {
  assert.deepEqual(resolverFiltrosPeriodoResumen({
    fechaDesde: "2026-10-01",
    fechaHasta: "2026-10-31",
    periodoCierre: "2026-09",
    periodoActual: "2026-10"
  }), {
    fechaDesde: "2026-09-01",
    fechaHasta: "2026-09-30",
    periodoCierre: "2026-09"
  });
});

test("los filtros sin mes conservan fechas manuales y usan el mes actual si están vacíos", () => {
  assert.deepEqual(resolverFiltrosPeriodoResumen({ fechaDesde: "2026-08-10", fechaHasta: "2026-08-20" }), {
    fechaDesde: "2026-08-10", fechaHasta: "2026-08-20", periodoCierre: ""
  });
  assert.deepEqual(resolverFiltrosPeriodoResumen({ periodoActual: "2026-10" }), {
    fechaDesde: "2026-10-01", fechaHasta: "2026-10-31", periodoCierre: ""
  });
});

test("calcula correctamente el último día de febrero bisiesto", () => {
  assert.deepEqual(rangoFechasDesdePeriodo("2024-02"), { desde: "2024-02-01", hasta: "2024-02-29" });
});
