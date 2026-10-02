const { test } = require("node:test");
const assert = require("node:assert/strict");
const agenda = require("../src/routes/agenda.routes");

test("agenda calcula la fecha de Costa Rica aunque UTC ya haya cambiado de día", () => {
  assert.equal(agenda.fechaCostaRica(new Date("2026-10-02T05:30:00.000Z")), "2026-10-01");
});

test("los límites de semana y días hábiles no dependen de la zona horaria del servidor", () => {
  assert.equal(agenda.lunesDeSemana("2026-10-02"), "2026-09-28");
  assert.equal(agenda.siguienteDiaHabil("2026-10-02"), "2026-10-05");
  assert.equal(agenda.sumarDias("2026-12-31", 1), "2027-01-01");
});

test("agenda rechaza fechas imposibles en formularios y filtros", () => {
  assert.equal(agenda.fechaISOValida("2026-02-29"), "");
  assert.equal(agenda.fechaISOValida("2026-09-22"), "2026-09-22");
  assert.equal(agenda.fechaISOValida("2026/09/22"), "");
});
