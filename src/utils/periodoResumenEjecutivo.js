function normalizarPeriodoCierre(value) {
  const limpio = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(limpio) ? limpio : "";
}

function rangoFechasDesdePeriodo(periodo) {
  const limpio = normalizarPeriodoCierre(periodo);
  if (!limpio) return { desde: "", hasta: "" };

  const [year, month] = limpio.split("-").map(Number);
  const ultimoDia = new Date(year, month, 0).getDate();
  return {
    desde: `${limpio}-01`,
    hasta: `${limpio}-${String(ultimoDia).padStart(2, "0")}`
  };
}

function resolverFiltrosPeriodoResumen({ fechaDesde, fechaHasta, periodoCierre, periodoActual }) {
  const periodo = normalizarPeriodoCierre(periodoCierre);
  if (periodo) {
    const rango = rangoFechasDesdePeriodo(periodo);
    return { fechaDesde: rango.desde, fechaHasta: rango.hasta, periodoCierre: periodo };
  }

  const desde = String(fechaDesde || "").trim();
  const hasta = String(fechaHasta || "").trim();
  if (desde || hasta) return { fechaDesde: desde, fechaHasta: hasta, periodoCierre: "" };

  const rangoActual = rangoFechasDesdePeriodo(periodoActual);
  return { fechaDesde: rangoActual.desde, fechaHasta: rangoActual.hasta, periodoCierre: "" };
}

module.exports = { normalizarPeriodoCierre, rangoFechasDesdePeriodo, resolverFiltrosPeriodoResumen };
