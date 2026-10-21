// Captura diaria automática: Reporte General del día + cobranza digitada ->
// las 11 capturas de ventas y cartera con el formato original.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const { parseReport, isReport } = require('./reporteGeneral');
const { generateMonth, summarizeDay, loadTemplates, templateMonth, FILES, TEMPLATE_DIR, daysIn } = require('./llenado');
const { createStore, fail } = require('./estado');
const { UPLOAD_ROOT } = require('../../utils/uploadStorage');

// El servidor acepta cuerpos JSON de hasta 10 MB; en base64 esto queda por debajo.
const MAX_BYTES = 7 * 1024 * 1024;
const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const DAY = /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TEMPLATE_FILES = Object.values(FILES);

// Las plantillas tienen datos internos y no van en el repositorio público:
// se suben una vez y quedan en el disco privado del servidor.
async function complete(dir) {
  try { const names = new Set(await fs.readdir(dir)); return TEMPLATE_FILES.every(f => names.has(f)); } catch { return false; }
}

// Captura General recibida: solo se usa para comparar los kilos de cada día.
function readGeneralReference(workbook, filename) {
  const sheet = workbook.Sheets['VENTAS TOTALES'];
  if (!sheet || workbook.Sheets['Cuadro de Ventas']) return null;
  const out = {};
  for (let d = 1; d <= 31; d++) {
    const date = sheet[XLSX.utils.encode_cell({ r: 8, c: d })]?.v;
    const kg = sheet[XLSX.utils.encode_cell({ r: 24, c: d })]?.v;
    if (typeof date !== 'number' || typeof kg !== 'number' || !kg) continue;
    const p = XLSX.SSF.parse_date_code(date);
    out[`${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`] = { kg, filename };
  }
  return out;
}

function readFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > 5) throw fail('Adjunte el Reporte General (y si quiere la Captura General): máximo 5 archivos.');
  if (files.reduce((s, f) => s + f.buffer.length, 0) > MAX_BYTES) throw fail('Los archivos superan 7 MB en total.');
  const reports = [], references = [];
  for (const file of files) {
    const ext = path.extname(file.filename).toLowerCase();
    if (!['.xls', '.xlsx'].includes(ext)) throw fail(`${file.filename}: use archivos .xls o .xlsx.`);
    let workbook;
    try { workbook = XLSX.read(file.buffer, { type: 'buffer' }); } catch { throw fail(`${file.filename}: no se pudo leer el Excel.`); }
    if (isReport(workbook)) { reports.push(parseReport(file.buffer, file.filename)); continue; }
    const reference = readGeneralReference(workbook, file.filename);
    if (reference) { references.push(reference); continue; }
    throw fail(`${file.filename}: no es un Reporte General ni una Captura General.`);
  }
  if (!reports.length && !references.length) throw fail('No se encontró ningún Reporte General.');
  return { reports, references };
}

function totals(rows) {
  const t = { documentos: rows.length, kg: 0, gross: 0, discount: 0, net: 0 };
  for (const r of rows) { t.kg += r.kg; t.gross += r.gross; t.discount += r.discount; t.net += r.net; }
  return t;
}

function createService({ store = createStore(), templateRoot = path.join(UPLOAD_ROOT, '.captura-diaria', 'plantillas'), bundledDir = TEMPLATE_DIR } = {}) {
  let cachedBase = null;
  async function templateDir() {
    if (await complete(templateRoot)) return templateRoot;
    if (await complete(bundledDir)) return bundledDir;
    throw fail('Faltan las plantillas de las capturas. Súbalas una vez en la sección "Plantillas" de esta pantalla.', 409);
  }
  async function baseMonth() {
    const dir = await templateDir();
    if (cachedBase?.dir !== dir) cachedBase = { dir, month: templateMonth(await loadTemplates(dir)) };
    return cachedBase.month;
  }
  async function plantillas() {
    const disk = await complete(templateRoot), bundled = await complete(bundledDir);
    let present = [];
    try { present = (await fs.readdir(templateRoot)).filter(f => TEMPLATE_FILES.includes(f)); } catch {}
    return { ready: disk || bundled, source: disk ? 'servidor' : bundled ? 'copia local' : null, required: TEMPLATE_FILES, present };
  }
  async function subirPlantillas(files) {
    if (!Array.isArray(files) || !files.length || files.length > TEMPLATE_FILES.length) throw fail(`Suba los ${TEMPLATE_FILES.length} archivos .xlsx de plantilla.`);
    if (files.reduce((s, f) => s + f.buffer.length, 0) > MAX_BYTES) throw fail('Las plantillas superan 7 MB en total; súbalas en dos tandas.');
    const staged = [];
    for (const file of files) {
      if (!TEMPLATE_FILES.includes(file.filename)) throw fail(`${file.filename}: el nombre debe ser uno de: ${TEMPLATE_FILES.join(', ')}.`);
      try { await require('./xlsxLibro').loadBook(file.buffer, file.filename); } catch { throw fail(`${file.filename}: no es un .xlsx válido.`); }
      staged.push(file);
    }
    await fs.mkdir(templateRoot, { recursive: true });
    for (const file of staged) {
      const temp = path.join(templateRoot, `${crypto.randomUUID()}.tmp`);
      await fs.writeFile(temp, file.buffer, { mode: 0o600 });
      await fs.rename(temp, path.join(templateRoot, file.filename));
    }
    cachedBase = null;
    if (await complete(templateRoot)) {
      // Comprueba que el juego completo se pueda usar antes de darlo por bueno.
      const books = await loadTemplates(templateRoot);
      templateMonth(books);
    }
    return plantillas();
  }

  async function importar(files, actor, revision) {
    const { reports, references } = readFiles(files);
    const base = await baseMonth();
    const days = new Set();
    const state = await store.update(revision, actor, s => {
      for (const report of reports) for (const day of report.days) {
        if (day.slice(0, 7) < base) throw fail(`${report.filename}: el día ${day} es anterior a las plantillas (${base}).`);
        const rows = report.rows.filter(r => r.day === day);
        s.days[day] = { ...summarizeDay(rows), ...totals(rows), filename: report.filename, importedAt: new Date().toISOString() };
        days.add(day);
      }
      for (const ref of references) Object.assign(s.referencia, ref);
      return `Importó ${[...days].sort().join(', ') || 'captura general de referencia'}`;
    });
    const month = [...days].sort().at(-1)?.slice(0, 7) || Object.keys(references[0] || {}).sort().at(-1)?.slice(0, 7);
    return { state, month };
  }

  async function guardarCobranza(day, values, actor, revision) {
    if (!DAY.test(day || '') || new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) !== day) throw fail('Fecha inválida.');
    const clean = {};
    for (const key of ['GT', 'SG']) {
      const v = values?.[key];
      if (v === '' || v === null || v === undefined) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1e12) throw fail('La cobranza debe ser un monto válido.');
      clean[key] = Math.round(n * 100) / 100;
    }
    return store.update(revision, actor, s => {
      if (Object.keys(clean).length) s.cobranza[day] = clean; else delete s.cobranza[day];
      return `Cobranza ${day}: GT ${clean.GT ?? '—'} · SG ${clean.SG ?? '—'}`;
    });
  }

  async function guardarSaldo(month, values, actor, revision) {
    if (!MONTH.test(month || '')) throw fail('Mes inválido.');
    const clean = {};
    for (const key of ['GT', 'SG']) {
      const v = values?.[key];
      if (v === '' || v === null || v === undefined) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || Math.abs(n) > 1e14) throw fail('El saldo inicial debe ser un monto válido.');
      clean[key] = Math.round(n * 100) / 100;
    }
    return store.update(revision, actor, s => {
      if (Object.keys(clean).length) s.saldos[month] = clean; else delete s.saldos[month];
      return `Saldo inicial ${month}: GT ${clean.GT ?? 'automático'} · SG ${clean.SG ?? 'automático'}`;
    });
  }

  async function vista(requested) {
    const state = await store.load();
    let base = null;
    try { base = await baseMonth(); } catch (error) { if (error.status !== 409) throw error; }
    const now = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' }).slice(0, 7);
    const months = [...new Set([base || now, ...Object.keys(state.days).map(d => d.slice(0, 7)), ...Object.keys(state.cobranza).map(d => d.slice(0, 7))])].sort();
    const month = requested && MONTH.test(requested) ? requested : months.at(-1);
    if (base && month < base) throw fail(`Las plantillas empiezan en ${base}.`);
    const days = Array.from({ length: daysIn(month) }, (_, i) => {
      const day = `${month}-${String(i + 1).padStart(2, '0')}`;
      const r = state.days[day];
      return {
        day,
        reporte: r ? { filename: r.filename, documentos: r.documentos, kg: r.kg, gross: r.gross, discount: r.discount, net: r.net, importedAt: r.importedAt } : null,
        cobranza: state.cobranza[day] || null,
        referencia: state.referencia[day] || null,
      };
    });
    return { month, months, baseMonth: base, revision: state.revision, updatedAt: state.updatedAt || null, saldos: state.saldos[month] || null, days, plantillas: await plantillas() };
  }

  async function revisar(month) {
    return generateMonth(await store.load(), month, { onlySummary: true, templateDir: await templateDir() });
  }

  async function descargar(month) {
    const result = await generateMonth(await store.load(), month, { templateDir: await templateDir() });
    const zip = new JSZip();
    const folder = `Capturas ${month}`;
    for (const f of result.files) zip.file(`${folder}/${f.filename}`, f.buffer);
    const lines = [
      `Capturas generadas ${new Date().toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' })} para ${month}.`,
      'Mantenga los 11 archivos juntos en la misma carpeta: la General y las Carteras están vinculadas a las capturas.',
      '', 'AVISOS:', ...(result.warnings.length ? result.warnings : ['Ninguno.']),
      '', 'NOTAS:', ...(result.notes.length ? result.notes : ['Ninguna.']),
    ];
    zip.file(`${folder}/LEEME - avisos.txt`, lines.join('\r\n'));
    return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }), result };
  }

  return { importar, guardarCobranza, guardarSaldo, vista, revisar, descargar, plantillas, subirPlantillas, store };
}

module.exports = { createService, FILES };
