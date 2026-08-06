function limpiarTextoPlaca(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizarPlaca(value) {
  const raw = limpiarTextoPlaca(value);
  if (!raw) return null;

  const generales = new Set(["GENERAL", "GENERALES", "GENERALTALLER", "GENERALESTALLER"]);
  if (generales.has(raw)) return "GENERALES TALLER";

  let match = raw.match(/^CLC(\d{5,6})$/);
  if (match) return `CL${match[1]}`;

  match = raw.match(/^CL(\d{5,6})$/);
  if (match) return `CL${match[1]}`;

  match = raw.match(/^SS(\d{5,6})$/);
  if (match) return `S${match[1]}`;

  match = raw.match(/^S(\d{5,6})$/);
  if (match) return `S${match[1]}`;

  match = raw.match(/^C(\d{5,6})$/);
  if (match) return `C${match[1]}`;

  match = raw.match(/^(\d{5,6})$/);
  if (match) {
    const numero = match[1];
    return /^[23]/.test(numero) ? `CL${numero}` : `C${numero}`;
  }

  match = raw.match(/(?:CL|C|S)?\d{5,6}/);
  if (match) return normalizarPlaca(match[0]);

  return raw;
}

function variantesPlaca(value) {
  const raw = limpiarTextoPlaca(value);
  const normalizada = normalizarPlaca(value);
  const valores = new Set([raw, normalizada].filter(Boolean));
  const numero = (normalizada || raw || "").match(/\d{5,6}/)?.[0] || raw.match(/\d{5,6}/)?.[0];

  if (numero) {
    valores.add(numero);
    valores.add(`C${numero}`);
    valores.add(`CL${numero}`);
    valores.add(`S${numero}`);
    valores.add(`CLC${numero}`);
    valores.add(`SS${numero}`);
  }

  return [...valores].filter(Boolean);
}

function expresionPlacaSql(column) {
  return `UPPER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(${column}, '')), ' ', ''), '-', ''), '.', ''), '_', ''))`;
}

function agregarFiltroPlacaSql(condiciones, params, column, value) {
  const variantes = variantesPlaca(value);
  if (!variantes.length) return;

  const expr = expresionPlacaSql(column);
  condiciones.push(`(${variantes.map(() => `${expr} LIKE ?`).join(" OR ")})`);
  variantes.forEach(placa => params.push(`%${placa}%`));
}

function extraerPlacasTexto(value) {
  const texto = String(value || "").toUpperCase();
  const matches = texto.match(/\b(?:CL|C|S)?\s*\d{5,6}\b/g) || [];
  const placas = matches
    .map(item => normalizarPlaca(item))
    .filter(Boolean);
  return [...new Set(placas)];
}

module.exports = {
  agregarFiltroPlacaSql,
  expresionPlacaSql,
  extraerPlacasTexto,
  limpiarTextoPlaca,
  normalizarPlaca,
  variantesPlaca
};
