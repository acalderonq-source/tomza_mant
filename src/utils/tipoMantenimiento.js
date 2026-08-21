const TIPOS_MANTENIMIENTO = ["CORRECTIVO", "PREVENTIVO", "SUMINISTROS"];

const PALABRAS_PREVENTIVO = [
  "revision general",
  "revisión general",
  "mantenimiento",
  "programado",
  "preventivo",
  "aceite",
  "engrase",
  "filtro",
  "filtros",
  "ajuste de frenos",
  "revisar frenos",
  "revision de frenos",
  "revisión de frenos",
  "revision de luces",
  "revisión de luces",
  "chequeo",
  "inspeccion",
  "inspección"
];

const PALABRAS_CORRECTIVO = [
  "fuga",
  "no arranca",
  "no enciende",
  "quebrado",
  "quebrada",
  "dañado",
  "danado",
  "golpe",
  "falla",
  "fallando",
  "ruido",
  "varado",
  "urgente",
  "reparar",
  "reparacion",
  "reparación",
  "cambiar bomba",
  "bomba mala",
  "clutch patinando",
  "problema",
  "no funciona",
  "malo",
  "mala",
  "roto",
  "rota",
  "reventado",
  "reventada"
];

function normalizarTipoMantenimiento(value, fallback = "CORRECTIVO") {
  const tipo = String(value || "").trim().toUpperCase();
  return TIPOS_MANTENIMIENTO.includes(tipo) ? tipo : fallback;
}

function normalizarTextoTipo(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function puntuarTexto(texto, palabras) {
  const normalizado = normalizarTextoTipo(texto);
  return palabras.reduce((total, palabra) => {
    const limpia = normalizarTextoTipo(palabra);
    if (!limpia || !normalizado.includes(limpia)) return total;
    return total + (limpia.includes(" ") ? 3 : 1);
  }, 0);
}

function detectarTipoMantenimiento(texto, opciones = {}) {
  const origen = String(opciones.origen || "").trim().toUpperCase();
  const fallback = normalizarTipoMantenimiento(opciones.fallback, "CORRECTIVO");

  if (origen === "PROGRAMADO" || origen === "AGENDA" || origen === "PREVENTIVO") return "PREVENTIVO";
  if (["REPORTE", "AVERIA", "AVERÍA", "VARADO", "PRIORIDAD", "CORRECTIVO"].includes(origen)) return "CORRECTIVO";

  const textoCompleto = Array.isArray(texto) ? texto.join(" ") : String(texto || "");
  const puntosPreventivo = puntuarTexto(textoCompleto, PALABRAS_PREVENTIVO);
  const puntosCorrectivo = puntuarTexto(textoCompleto, PALABRAS_CORRECTIVO);

  if (puntosPreventivo > puntosCorrectivo) return "PREVENTIVO";
  if (puntosCorrectivo > puntosPreventivo) return "CORRECTIVO";
  return fallback;
}

async function tableExists(pool, table) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [table]
  );
  return Number(row.total || 0) > 0;
}

async function columnExists(pool, table, column) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(row.total || 0) > 0;
}

async function addColumnIfMissing(pool, table, column, definition) {
  if (!(await tableExists(pool, table))) return;
  if (!(await columnExists(pool, table, column))) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function ensureTipoMantenimientoColumns(pool) {
  await addColumnIfMissing(pool, "ordenes_compra", "tipo_mantenimiento", "VARCHAR(20) NOT NULL DEFAULT 'CORRECTIVO' AFTER placa_unidad");
  await addColumnIfMissing(pool, "ordenes_motor", "tipo_mantenimiento", "VARCHAR(20) NOT NULL DEFAULT 'CORRECTIVO' AFTER placa_unidad");
  await addColumnIfMissing(pool, "correctivos", "tipo_mantenimiento", "VARCHAR(20) NOT NULL DEFAULT 'CORRECTIVO' AFTER sede");
  await addColumnIfMissing(pool, "mantenimientos", "creado_por", "INT NULL AFTER fecha_cierre");
  await addColumnIfMissing(pool, "reportes_supervisores", "tipo_mantenimiento", "VARCHAR(20) NOT NULL DEFAULT 'CORRECTIVO' AFTER semana_reporte");
  await addColumnIfMissing(pool, "reportes_supervisores", "mantenimiento_id", "INT NULL AFTER correctivo_id");
}

module.exports = {
  TIPOS_MANTENIMIENTO,
  normalizarTipoMantenimiento,
  detectarTipoMantenimiento,
  ensureTipoMantenimientoColumns
};
