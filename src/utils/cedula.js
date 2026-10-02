function normalizarCedula(value) {
  return String(value || "").replace(/\D/g, "");
}

function cedulaValida(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  if (!/^[\d\s-]+$/.test(raw)) return false;
  const digits = normalizarCedula(raw);
  return digits.length >= 9 && digits.length <= 12;
}

module.exports = { normalizarCedula, cedulaValida };
