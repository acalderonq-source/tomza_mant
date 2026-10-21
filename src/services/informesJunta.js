const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const MAX_ROWS = 20000;
const fail = message => Object.assign(new Error(message), { status: 400 });
const clean = value => String(value ?? '').replace(/&(?:amp;)*nbsp;|\u00a0/g, ' ').trim();
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
function scalar(value) {
  if (value && typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) return value.result;
    if (value.richText) return value.richText.map(item => item.text).join('');
    if ('text' in value) return value.text;
  }
  return value;
}
function numeric(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) throw fail(`${label}: se esperaba un número válido. Revisá el archivo original.`);
  return round(value);
}

async function importWorkbook(buffer, filename) {
  if (!/\.xlsx$/i.test(filename) || !Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 6 * 1024 * 1024) throw fail('Seleccioná un archivo .xlsx de hasta 6 MB.');
  let workbook;
  try {
    const zip = await JSZip.loadAsync(buffer);
    // Check expanded size before ExcelJS allocates worksheet objects.
    const expanded = Object.values(zip.files).reduce((sum, entry) => sum + (entry._data?.uncompressedSize || 0), 0);
    if (expanded > 50 * 1024 * 1024) throw fail('El archivo expandido supera 50 MB. Exportá un reporte más pequeño.');
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
  } catch (error) {
    if (error.status) throw error;
    throw fail('No se pudo leer el Excel. Guardalo como .xlsx e intentá otra vez.');
  }
  const required = ['CODIGO', 'NOMBRE_COMERCIAL', 'GRUPO', 'DIVISION', 'CANAL'];
  const matches = [];
  for (const candidate of workbook.worksheets) {
    for (let n = 1; n <= Math.min(20, candidate.rowCount); n++) {
      const names = candidate.getRow(n).values.map(v => clean(scalar(v)).toUpperCase());
      if (required.every(name => names.includes(name))) {
        matches.push({ sheet: candidate, columns: names, headerRow: n }); break;
      }
    }
  }
  if (!matches.length) throw fail(`No se encontró una hoja con las columnas ${required.join(', ')}.`);
  if (matches.reduce((total, match) => total + match.sheet.rowCount - match.headerRow, 0) > MAX_ROWS) throw fail(`El máximo de prueba es ${MAX_ROWS.toLocaleString('es-CR')} filas entre todas las hojas.`);
  let months;
  const records = [], seen = new Set();
  const sources = [];
  let emptyAmounts = 0, repeatedKeys = 0, unclassifiedChannels = 0;
  for (const { sheet, columns, headerRow } of matches) {
  const sheetMonths = columns.filter(name => MONTH.test(name)).sort();
  if (!sheetMonths.length || sheetMonths.length > 60 || new Set(sheetMonths).size !== sheetMonths.length) throw fail('Se requieren de 1 a 60 columnas mensuales únicas con formato AAAA-MM.');
  if (months && JSON.stringify(months) !== JSON.stringify(sheetMonths)) throw fail('Todas las hojas deben contener los mismos meses para consolidarlas.');
  months = sheetMonths;
  if (required.some(name => columns.filter(v => v === name).length !== 1)) throw fail('Hay encabezados obligatorios repetidos.');
  const start = records.length;
  for (let n = headerRow + 1; n <= sheet.rowCount; n++) {
    const row = sheet.getRow(n);
    if (!row.hasValues) continue;
    const read = name => scalar(row.getCell(columns.indexOf(name)).value);
    const record = {
      codigo: clean(read('CODIGO')), nombre: clean(read('NOMBRE_COMERCIAL')),
      grupo: clean(read('GRUPO')), division: clean(read('DIVISION')), canal: clean(read('CANAL')),
      ruta: columns.includes('RUTA') ? clean(read('RUTA')) : '',
      cc: columns.includes('CC') ? clean(read('CC')).toUpperCase() : '',
      sourceFile: path.basename(filename), sourceSheet: sheet.name, sourceRow: n, values: {}
    };
    if (Object.values(record).some(value => typeof value === 'string' && value.length > 250)) throw fail(`Fila ${n}: texto demasiado largo.`);
    if (!record.codigo || !record.nombre || !record.grupo || !record.division) throw fail(`Hoja ${sheet.name}, fila ${n}: faltan código, nombre, grupo o división. Quitá subtotales y filas de pie.`);
    if (!record.canal) { record.canal = 'Sin clasificación'; unclassifiedChannels++; }
    const key = JSON.stringify([record.codigo, record.grupo, record.division, record.ruta, record.canal, record.cc]);
    // Preserve source rows. Repeated customer keys may represent valid allocations.
    if (seen.has(key)) repeatedKeys++;
    seen.add(key);
    for (const month of months) {
      const value = read(month);
      if (value == null || value === '') { record.values[month] = 0; emptyAmounts++; }
      else record.values[month] = numeric(value, `Fila ${n}, ${month}`);
    }
    records.push(record);
  }
  sources.push({ filename: path.basename(filename), sheet: sheet.name, count: records.length - start });
  }
  if (!records.length) throw fail('El archivo no contiene registros de clientes.');
  return { filename: path.basename(filename), sheet: matches.map(match => match.sheet.name).join(', '), sources, months, records, emptyAmounts, repeatedKeys, unclassifiedChannels, demo: false };
}

async function importWorkbooks(files) {
  if (!Array.isArray(files) || !files.length || files.length > 10 || files.reduce((sum, file) => sum + (file.buffer?.length || 0), 0) > 6 * 1024 * 1024) throw fail('Seleccioná de 1 a 10 archivos .xlsx, con un máximo total de 6 MB.');
  const hashes = new Set(), imported = [];
  for (const file of files) {
    if (!Buffer.isBuffer(file.buffer)) throw fail('Archivo inválido.');
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    if (hashes.has(hash)) throw fail('El mismo archivo está seleccionado más de una vez.');
    hashes.add(hash);
    const data = await importWorkbook(file.buffer, file.filename);
    if (imported.length && JSON.stringify(imported[0].months) !== JSON.stringify(data.months)) throw fail('Todos los archivos deben contener los mismos meses para consolidarlos.');
    imported.push(data);
  }
  const records = imported.flatMap(data => data.records);
  if (records.length > MAX_ROWS) throw fail(`El máximo de prueba es ${MAX_ROWS.toLocaleString('es-CR')} registros entre todos los archivos.`);
  const seen = new Set(); let repeatedKeys = 0;
  for (const record of records) {
    const key = JSON.stringify([record.codigo, record.grupo, record.division, record.ruta, record.canal, record.cc]);
    if (seen.has(key)) repeatedKeys++; seen.add(key);
  }
  return { ...imported[0], filename: imported.map(data => data.filename).join(' + '), sheet: imported.map(data => data.sheet).join(', '), sources: imported.flatMap(data => data.sources), records, emptyAmounts: imported.reduce((sum, data) => sum + data.emptyAmounts, 0), unclassifiedChannels: imported.reduce((sum, data) => sum + data.unclassifiedChannels, 0), repeatedKeys };
}

function previousMonth(month) {
  const [year, number] = month.split('-').map(Number);
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`;
}
function validateParams(input, data) {
  const params = {
    title: clean(input.title || 'Informe de resultados'),
    period: clean(input.period), unit: clean(input.unit || 'Unidad por confirmar'),
    days: input.days === '' || input.days == null ? null : Number(input.days),
    target: input.target === '' || input.target == null ? null : Number(input.target),
    reference: input.reference === '' || input.reference == null ? null : Number(input.reference),
    notes: String(input.notes || '').trim()
  };
  if (!MONTH.test(params.period) || !data.months.includes(params.period)) throw fail('Seleccioná un mes disponible en la fuente.');
  if (!params.title || params.title.length > 120 || params.unit.length > 60 || params.notes.length > 4000) throw fail('Título, unidad u observaciones exceden el tamaño permitido.');
  if (params.days !== null && (!Number.isInteger(params.days) || params.days < 1 || params.days > 31)) throw fail('Los días de operación deben estar entre 1 y 31.');
  for (const key of ['target', 'reference']) {
    if (params[key] !== null && (!Number.isFinite(params[key]) || params[key] < 0 || params[key] > 1e12)) throw fail('Meta y referencia deben ser números positivos o quedar vacías.');
  }
  return params;
}

function summarize(data, params) {
  const month = params.period, previous = previousMonth(month), hasPrevious = data.months.includes(previous);
  const totals = new Map(data.months.map(m => [m, 0]));
  const dimensions = { grupo: new Map(), canal: new Map(), division: new Map(), cc: new Map() };
  let active = 0, withoutPrevious = 0, withoutCurrent = 0;
  for (const record of data.records) {
    for (const m of data.months) totals.set(m, totals.get(m) + Math.round(record.values[m] * 100));
    const current = Math.round(record.values[month] * 100), before = hasPrevious ? Math.round(record.values[previous] * 100) : 0;
    if (current > 0) active++;
    if (hasPrevious && current > 0 && before === 0) withoutPrevious++;
    if (hasPrevious && current === 0 && before > 0) withoutCurrent++;
    for (const key of Object.keys(dimensions)) {
      const category = record[key] || 'Sin clasificación';
      const item = dimensions[key].get(category) || { name: category, current: 0, previous: 0, records: 0 };
      item.current += current; item.previous += before; item.records++;
      dimensions[key].set(category, item);
    }
  }
  const total = totals.get(month) / 100, prior = hasPrevious ? totals.get(previous) / 100 : null;
  const breakdown = Object.fromEntries(Object.entries(dimensions).map(([key, values]) => [key, [...values.values()].map(item => ({
    ...item, current: item.current / 100, previous: hasPrevious ? item.previous / 100 : null,
    difference: hasPrevious ? (item.current - item.previous) / 100 : null,
    percent: hasPrevious && item.previous !== 0 ? (item.current - item.previous) / item.previous : null
  })).sort((a, b) => b.current - a.current)]));
  return {
    total, prior, previous, hasPrevious, difference: hasPrevious ? round(total - prior) : null,
    percent: hasPrevious && prior !== 0 ? (total - prior) / prior : null,
    daily: params.days ? total / params.days : null,
    targetDifference: params.target === null ? null : round(total - params.target),
    referenceDifference: params.reference === null ? null : round(total - params.reference),
    active, withoutPrevious, withoutCurrent, breakdown,
    history: [...totals].map(([period, cents]) => ({ period, total: cents / 100 }))
  };
}

function demoData() {
  return {
    filename: 'Ejemplo ficticio.xlsx', sheet: 'Demo', demo: true, emptyAmounts: 0, repeatedKeys: 0,
    months: ['2026-08', '2026-09'],
    records: [
      ['D001', 'Restaurante de ejemplo A', 'Cartago', 'Horeca', 500, 650],
      ['D002', 'Hotel de ejemplo B', 'La Cruz', 'HOTELES', 1000, 950],
      ['D003', 'Industria de ejemplo C', 'Alajuela', 'Industria', 2200, 2400],
      ['D004', 'Restaurante de ejemplo D', 'Cartago', 'Horeca', 0, 300],
      ['D005', 'Granja de ejemplo E', 'Alajuela', 'GRANJAS', 450, 0]
    ].map(([codigo, nombre, division, canal, august, september]) => ({ codigo, nombre, division, canal, grupo: 'Granel', ruta: 'DEMO', values: { '2026-08': august, '2026-09': september } }))
  };
}

function createStore(root) {
  const locks = new Map();
  function directory(userId) {
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) < 1) throw fail('Usuario inválido.');
    return path.join(root, String(Number(userId)));
  }
  function filename(userId, id) {
    if (!/^[a-f0-9-]{36}$/.test(String(id))) throw fail('Informe inválido.');
    return path.join(directory(userId), `${id}.json`);
  }
  async function get(userId, id) {
    try { return JSON.parse(await fs.readFile(filename(userId, id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw Object.assign(new Error('Informe no encontrado.'), { status: 404 }); throw error; }
  }
  async function atomicSave(userId, report) {
    await fs.mkdir(directory(userId), { recursive: true });
    const destination = filename(userId, report.id), temp = `${destination}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temp, JSON.stringify(report), { mode: 0o600 }); await fs.rename(temp, destination); }
    finally { await fs.unlink(temp).catch(() => {}); }
  }
  return {
    get,
    async list(userId) {
      let files;
      try { files = await fs.readdir(directory(userId)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const reports = await Promise.all(files.filter(f => /^[a-f0-9-]{36}\.json$/.test(f)).map(f => get(userId, f.slice(0, -5))));
      return reports.map(({ id, params, updatedAt, data, revision }) => ({ id, params, updatedAt, revision, filename: data.filename, demo: data.demo, count: data.records.length })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async create(userId, data) {
      const now = new Date().toISOString();
      const report = { id: randomUUID(), revision: 1, createdAt: now, updatedAt: now, data,
        params: validateParams({ period: data.months.at(-1) }, data) };
      await atomicSave(userId, report); return report;
    },
    async update(userId, id, revision, input, templateEdits) {
      const key = filename(userId, id), previous = locks.get(key) || Promise.resolve();
      const task = previous.catch(() => {}).then(async () => {
        const report = await get(userId, id);
        if (report.revision !== Number(revision)) throw Object.assign(new Error('Este informe cambió en otra pestaña. Volvé a abrirlo antes de guardar.'), { status: 409 });
        report.params = validateParams(input, report.data);
        if (templateEdits !== undefined) report.templateEdits = templateEdits;
        report.updatedAt = new Date().toISOString(); report.revision++;
        await atomicSave(userId, report); return report;
      });
      locks.set(key, task);
      try { return await task; } finally { if (locks.get(key) === task) locks.delete(key); }
    }
  };
}

function scopeText(report) {
  return `${report.data.demo ? 'DATOS FICTICIOS. ' : ''}RELLENO AUTOMÁTICO · PRUEBA PARCIAL. Fuente: ${report.data.filename}. ${report.data.repeatedKeys || 0} claves repetidas conservadas; en productividad se agrupan por código de cliente. ${report.data.emptyAmounts || 0} valores vacíos tratados como cero. Excel y PPT se rellenan automáticamente en los formatos originales (43 hojas y 29 diapositivas). Las cifras sin fuente se identifican como Pendiente; los totales incompletos no reutilizan números viejos. Las secciones no vinculadas conservan su contenido original como referencia y muestran PEND. en la PPT.`;
}

const exportExcel = report => require('./informesJuntaPlantillas').exportTemplate(report, 'xlsx');
const exportPowerPoint = report => require('./informesJuntaPlantillas').exportTemplate(report, 'pptx');

module.exports = { importWorkbook, importWorkbooks, summarize, validateParams, demoData, createStore, exportExcel, exportPowerPoint, scopeText };
