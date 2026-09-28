const test = require("node:test");
const assert = require("node:assert/strict");
const { fechaActualCostaRica, fechaHoraCostaRica } = require("../src/utils/fechaCostaRica");

test("usa la fecha costarricense aunque UTC ya haya cambiado de día", () => {
  const fecha = new Date("2026-09-28T05:30:00.000Z");
  assert.equal(fechaActualCostaRica(fecha), "2026-09-27");
  assert.equal(fechaHoraCostaRica(fecha), "2026-09-27T23:30:00");
});

test("usa horario UTC-6 para horas de Costa Rica", () => {
  const fecha = new Date("2026-09-28T16:00:00.000Z");
  assert.equal(fechaHoraCostaRica(fecha), "2026-09-28T10:00:00");
});
