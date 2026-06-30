const PALABRAS_VACIAS = new Set([
  "de", "del", "la", "las", "el", "los", "un", "una", "y", "o", "con", "por",
  "para", "en", "al", "se", "que", "tiene", "tienen", "hay", "esta", "este",
  "revisar", "revision", "ajustar", "ajuste", "cambiar", "cambio", "hacer"
]);

const CORRECCIONES = [
  [/\bfrenos?\b/gi, "frenos"],
  [/\bengrase\b/gi, "engrase"],
  [/\baceyte\b/gi, "aceite"],
  [/\bdirrec?cion\b/gi, "dirección"],
  [/\bhidraulico\b/gi, "hidráulico"],
  [/\bbateria\b/gi, "batería"],
  [/\bradiador\b/gi, "radiador"],
  [/\bmanib?ela\b/gi, "manivela"],
  [/\bclucth\b/gi, "clutch"],
  [/\bcaja\b/gi, "caja"],
  [/\bdiferencial\b/gi, "diferencial"],
  [/\bfuga\b/gi, "fuga"],
  [/\bluces?\b/gi, "luces"],
  [/\bquemad[ao]s?\b/gi, "quemadas"],
  [/\basientos?\b/gi, "asientos"],
  [/\bllantas?\b/gi, "llantas"],
  [/\btemperatura\b/gi, "temperatura"],
  [/\bconsumo\b/gi, "consumo"],
  [/\bgradas?\b/gi, "gradas"]
];

const SINONIMOS = {
  freno: "frenos",
  frenos: "frenos",
  frenar: "frenos",
  aceite: "aceite",
  fuga: "fuga",
  fugando: "fuga",
  direccion: "direccion",
  hidráulico: "hidraulico",
  hidraulico: "hidraulico",
  motor: "motor",
  radiador: "radiador",
  agua: "agua",
  temperatura: "temperatura",
  bateria: "bateria",
  batería: "bateria",
  luces: "luces",
  luz: "luces",
  llanta: "llantas",
  llantas: "llantas",
  clutch: "clutch",
  embrague: "clutch",
  caja: "caja",
  diferencial: "diferencial",
  engrase: "engrase",
  engrasar: "engrase",
  asiento: "asientos",
  asientos: "asientos",
  manivela: "manivela",
  gradas: "gradas",
  rotulas: "rotulas",
  rótulas: "rotulas"
};

function quitarAcentos(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizarTexto(texto) {
  return quitarAcentos(texto)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizar(texto) {
  return normalizarTexto(texto)
    .split(" ")
    .map(token => SINONIMOS[token] || token)
    .filter(token => token.length > 2 && !PALABRAS_VACIAS.has(token));
}

function limpiarTextoReporte(texto) {
  let limpio = String(texto || "").trim();
  limpio = limpio.replace(/\s+/g, " ");
  limpio = limpio.replace(/\s*,\s*/g, ", ");
  limpio = limpio.replace(/\s*\.\s*/g, ". ");

  CORRECCIONES.forEach(([regex, reemplazo]) => {
    limpio = limpio.replace(regex, reemplazo);
  });

  if (!limpio) return "";
  limpio = limpio.charAt(0).toUpperCase() + limpio.slice(1);
  if (!/[.!?]$/.test(limpio)) limpio += ".";
  return limpio;
}

function analizarCoincidenciaReporteCorrectivo(reporte, correctivo) {
  const textoReporte = `${reporte.descripcion_limpia || ""} ${reporte.descripcion_original || ""}`;
  const textoCorrectivo = `${correctivo.trabajo_realizado || ""} ${correctivo.pendiente || ""}`;
  const tokensReporte = [...new Set(tokenizar(textoReporte))];
  const tokensCorrectivo = new Set(tokenizar(textoCorrectivo));

  if (!tokensReporte.length || !tokensCorrectivo.size) {
    return { coincide: false, confianza: 0, motivo: "No hay texto suficiente para comparar." };
  }

  const coincidencias = tokensReporte.filter(token => tokensCorrectivo.has(token));
  const confianza = coincidencias.length / Math.max(tokensReporte.length, 1);
  const palabrasClave = coincidencias.slice(0, 8).join(", ");
  const coincide = confianza >= 0.28 || coincidencias.length >= 2;

  return {
    coincide,
    confianza: Number(Math.min(confianza, 1).toFixed(2)),
    motivo: coincide
      ? `Coincide por placa, fecha posterior y palabras relacionadas: ${palabrasClave}.`
      : `Coincidencia baja. Palabras encontradas: ${palabrasClave || "ninguna"}.`
  };
}

module.exports = {
  limpiarTextoReporte,
  analizarCoincidenciaReporteCorrectivo
};
