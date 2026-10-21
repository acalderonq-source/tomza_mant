const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const { UPLOAD_ROOT } = require('../utils/uploadStorage');

const MAX_BYTES = 6 * 1024 * 1024;
const MAX_EXPANDED = 100 * 1024 * 1024;
const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const fail = message => Object.assign(new Error(message), { status: 400 });
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
const money = value => Math.round((value + Number.EPSILON) * 100) / 100;
const execFileAsync = promisify(execFile);
function number(value, where) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) throw fail(`${where}: falta un número válido.`);
  return value;
}
function date(value) {
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) value = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  } else if (value instanceof Date) value = value.toISOString().slice(0, 10);
  let text = clean(value);
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  if (m) text = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text + 'T12:00:00Z')) || new Date(text + 'T12:00:00Z').toISOString().slice(0, 10) !== text) return null;
  return text;
}
function payment(value) {
  const text = norm(value);
  if (text === 'CONTADO') return 'CONTADO';
  if (['CREDITO', 'CRDITO'].includes(text)) return 'CREDITO'; // Some source exports already contain a replacement character.
  throw fail(`Forma de pago sin reconocer: ${clean(value)}.`);
}
function category(value, summary = false) {
  const text = norm(value);
  if (summary) {
    if (text.includes('PLANTADISTRIBUIDOR')) return 1;
    if (text.includes('PLANTAPUBLICO') || text === 'LACRUZPLANTA') return 2;
    if (text.includes('CAMIONCF')) return 5;
    if (text.includes('GRANGRANEL')) return 9;
    if (text.includes('CARBURACION')) return 11;
    if (text.includes('GRANEL')) return 8;
    if (text.includes('TIENDA')) return 7;
    if (text.includes('DISTRIBUIDOR')) return 3;
    if (text.includes('HINOS') || text.includes('PULPERIAS') || text === 'CEDIATLANTICO') return 4;
  }
  const groups = { MINIPLANTA: 0, DISTRIBUIDORMINIPLANTA: 0, DISTRIBUIDORPLANTA: 1, PLANTA: 2, DISTRIBUIDOR: 3, PULPERIAS: 4, VIP: 5, CAMIONCF: 5, VIPCF: 6, AGENCIAS: 7, TIENDAS: 7, GRANEL: 8, GRANGRANEL: 9, GRANELPETRO: 10, CARBURACION: 11, CARBURACIONCOMERCIAL: 12 };
  if (Object.hasOwn(groups, text)) return groups[text];
  throw fail(`Clasificación sin reconocer: ${clean(value)}. Revisá la clasificación contable del archivo.`);
}
const val = (sheet, row, col) => {
  const c = sheet[XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })];
  // Unrelated template formulas may already contain errors. Required business numbers are checked by number().
  if (c?.t === 'e') return undefined;
  return c?.v;
};
const routeCode = value => (clean(value).match(/\d+/) || [''])[0].replace(/^0+(?=\d)/, '');
function region(value) {
  const text = norm(value);
  for (const [key, words] of Object.entries({
    CARTAGO: ['CARTAGO'], ALAJUELA: ['ALAJUELA'], LACRUZ: ['LACRUZ'],
    ATLANTICO: ['ATLANTICO', 'GUAPILES', 'LIMON'], ZONASUR: ['ZONASUR', 'PEREZZELEDON'],
    SANCARLOS: ['SANCARLOS'], PACIFICO: ['PACIFICO', 'PUNTARENAS'],
  })) if (words.some(word => text.includes(word))) return key;
  return '';
}
function loadTemplateDefinition() {
  const filename = path.join(__dirname, '../templates/captura-general/original.xls');
  const workbook = XLSX.readFile(filename, { cellFormula: true, cellHTML: false });
  const categories = Array.from({ length: 13 }, (_, index) => clean(val(workbook.Sheets['VENTAS TOTALES'], 12 + index, 1)));
  const mapping = [
    ['DISTRIBUIDORES MINI-PLANTA', 'DISTRIBUIDORES MINI-PLANTA', 5],
    ['PLANTA DISTRIBUIDORES', 'PLANTA DISTRIBUIDORES', 5],
    ['PLANTA C.F.', 'PLANTA C.F.', 5],
    ['CAMION DISTRIBUIDORES', 'CAMION DISTRIBUIDORES', 7],
    ['CAMION PULPERIAS', 'CAMION PULPERIAS', 5],
    ['CAMION C.F.', 'CAMION C.F.', 7],
    ['VIP C.F.', 'VIP C.F.', 6],
    ['AGENCIAS', 'AGENCIAS', 6],
    ['GRANEL COMERCIAL', 'GRANEL COMERCIAL', 9],
    ['GRAN GRANEL', 'GRAN GRANEL', 9],
    ['GRANEL PETRO', 'CAMION DISTRIBUIDOR', 9],
    ['CARBURACION ESTACIONES', 'CARBURACION ESTACIONES', 7],
    ['CARBURACION  COMERCIAL', 'CARBURACION COMERCIAL', 7],
  ];
  const sheets = mapping.map(([categoryName, name, firstRow]) => {
    const sheet = workbook.Sheets[name];
    const bounds = XLSX.utils.decode_range(sheet['!ref']);
    let startColumn = 0;
    for (let row = 1; row <= 6 && !startColumn; row++) for (let col = 1; col <= bounds.e.c + 1; col++) {
      if (val(sheet, row, col) === 1) { startColumn = col; break; }
    }
    if (!startColumn) throw new Error(`No se encontró el inicio de días en ${name}.`);
    let lastRow = bounds.e.r + 1;
    for (let row = firstRow; row <= bounds.e.r + 1; row++) {
      const labels = Array.from({ length: startColumn - 1 }, (_, col) => norm(val(sheet, row, col + 1)));
      if (labels.some(label => /^TOTAL(?:ES)?$/.test(label) || label.startsWith('TOTALTOMZ'))) { lastRow = row - 1; break; }
    }
    const labelColumn = name === 'CAMION C.F.' ? 1 : startColumn - 1;
    const plateColumn = name === 'CAMION C.F.' ? 2 : startColumn > 3 ? startColumn - 2 : (['GRANEL COMERCIAL', 'GRAN GRANEL'].includes(name) ? 1 : null);
    const slots = [];
    for (let row = firstRow; row <= lastRow; row++) {
      const label = clean(val(sheet, row, labelColumn));
      const route = routeCode(val(sheet, row, 1));
      slots.push({ row, label, route, free: !label || label === '0', labelColumn, plateColumn });
    }
    return { name, category: categoryName, startColumn, slots };
  });
  return { manifest: { categories, sheets }, routeCode, region };
}
// La plantilla se lee al usar Captura general, no al arrancar: si falta en el
// servidor, solo esta pantalla avisa el error y el resto del sistema sigue en línea.
let captureCache;
const capture = new Proxy({}, { get: (_target, prop) => (captureCache ??= loadTemplateDefinition())[prop] });
function parseWorkbook(workbook, filename) {
  const records = [], references = [], portfolios = [], sources = [];
  let recognized = false;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet['!ref']) continue;
    const bounds = XLSX.utils.decode_range(sheet['!ref']);
    if (bounds.e.r >= 20000 || bounds.e.c >= 200) throw fail(`${filename}: la hoja ${name} supera 20 000 filas o 200 columnas.`);
    let columns, header;
    for (let r = 1; r <= Math.min(10, bounds.e.r + 1); r++) {
      const names = Array.from({ length: bounds.e.c + 1 }, (_, c) => norm(val(sheet, r, c + 1)));
      if (['NODOCUMENTO', 'FECHA', 'UNIDADNEGOCIO', 'FORMAPAGO', 'TOTALGENERAL', 'TOTALDESCUENTOS', 'TOTALLITROS', 'TOTALKILOS', 'BRUTO', 'CLASIFICACIONCONTABILIDAD'].every(n => names.includes(n))) {
        if (new Set(names.filter(Boolean)).size !== names.filter(Boolean).length) throw fail(`${name}: encabezados repetidos.`);
        columns = names; header = r; break;
      }
    }
    if (columns) {
      recognized = true;
      for (let r = header + 1; r <= bounds.e.r + 1; r++) {
        const get = n => val(sheet, r, columns.indexOf(n) + 1);
        const id = clean(get('NODOCUMENTO'));
        if (!id) {
          if (clean(get('FECHA')) || ['TOTALGENERAL','BRUTO'].some(n => get(n) != null && get(n) !== '' && get(n) !== 0)) throw fail(`${name}, fila ${r}: falta el número de documento. Quitá subtotales del reporte.`);
          continue;
        }
        const day = date(get('FECHA')); if (!day) throw fail(`${name}, fila ${r}: fecha inválida.`);
        const unit = clean(get('UNIDADNEGOCIO')); if (!unit) throw fail(`${name}, fila ${r}: falta Unidad Negocio.`);
        const read = n => number(get(n), `${name}, fila ${r}, ${n}`);
        const gross = read('BRUTO'), discount = read('TOTALDESCUENTOS'), net = read('TOTALGENERAL');
        if (Math.abs(gross - discount - net) > .02) throw fail(`${name}, fila ${r}: bruto menos descuento no coincide con Total General.`);
        const record = { day, id, unit, route: clean(get('RUTA')), client: clean(get('IDENTIFICACION')), name: clean(get('NOMBRECLIENTE')), commercial: clean(get('NOMBRECOMERCIAL')), category: category(get('CLASIFICACIONCONTABILIDAD')), payment: payment(get('FORMAPAGO')), liters: read('TOTALLITROS'), kg: read('TOTALKILOS'), gross, discount, net, filename, sheet: name, row: r, kind: 'general' };
        records.push(record);
      }
      sources.push({ filename, sheet: name, kind: 'general' });
      continue;
    }
    // Daily report: locate the actual summary header instead of relying on a fixed row number.
    for (let r = 1; r <= Math.min(150, bounds.e.r + 1); r++) {
      if (norm(val(sheet, r, 1)) !== 'RESUMENVENTA' || norm(val(sheet, r, 2)) !== 'LITROS' || norm(val(sheet, r, 6)) !== 'LITROS') continue;
      recognized = true;
      const day = date(val(sheet, 3, 1));
      if (!day) break; // Placeholder day, never a zero-sales observation.
      const firstValues = Array.from({length:8},(_,c)=>val(sheet,r+1,c+2));
      if (firstValues.every(v=>v==null||v==='')) break;
      let count = 0, total;
      const sums = Array(8).fill(0);
      for (let row = r + 1; row <= Math.min(r + 100, bounds.e.r + 1); row++) {
        const label = clean(val(sheet, row, 1)); if (!label) continue;
        if (norm(label) === 'TOTALES') { total = Array.from({ length: 8 }, (_, c) => number(val(sheet, row, c + 2), `${name}, total`)); break; }
        const group = category(label, true);
        const values = Array.from({ length: 8 }, (_, c) => number(val(sheet, row, c + 2), `${name}, fila ${row}`));
        values.forEach((v, i) => sums[i] += v);
        for (const [offset, pay] of [[0, 'CONTADO'], [4, 'CREDITO']]) {
          const [liters, gross, discount, net] = values.slice(offset, offset + 4);
          if (Math.abs(gross - discount - net) > .02) throw fail(`${name}, fila ${row}: el resumen no cuadra.`);
          records.push({ day, id: `${norm(label)}:${pay}`, unit: label, category: group, payment: pay, liters, kg: liters * .54, gross, discount, net, kind: 'diario', filename, sheet: name, row });
          count++;
        }
      }
      if (!count || !total || total.some((v, i) => Math.abs(v - sums[i]) > .02)) throw fail(`${name}: el total del resumen diario no coincide con sus conceptos.`);
      sources.push({ filename, sheet: name, kind: 'diario' }); break;
    }
    if (norm(name) === 'VENTASTOTALES') {
      recognized = true;
      for (let c = 2; c <= 32; c++) {
        const day = date(val(sheet, 9, c));
        if (!day || !Array.from({ length: 13 }, (_, k) => val(sheet, 12 + k, c)).some(v => typeof v === 'number' && v !== 0)) continue;
        const cells = [];
        for (let row = 12; row <= 140; row++) {
          const cell = sheet[XLSX.utils.encode_cell({ r: row - 1, c: c - 1 })];
          if (cell?.t === 'n' && Number.isFinite(cell.v)) cells.push([row, cell.v]);
        }
        references.push({ day, cells, filename, sheet: name });
      }
      sources.push({ filename, sheet: name, kind: 'captura' });
    }
    let portfolioHeader = 0;
    for (let row = 1; row <= Math.min(12, bounds.e.r + 1); row++) {
      const names = Array.from({ length: bounds.e.c + 1 }, (_, col) => norm(val(sheet, row, col + 1)));
      if (names.includes('FECHA') && names.includes('SALDOINICIAL')) { portfolioHeader = row; break; }
    }
    if (portfolioHeader) {
      recognized = true;
      const labels = Array.from({ length: bounds.e.c + 1 }, (_, col) => clean(val(sheet, portfolioHeader, col + 1)) || `Columna ${col + 1}`);
      for (let row = portfolioHeader + 1; row <= bounds.e.r + 1; row++) {
        const day = date(val(sheet, row, 1));
        if (!day) continue;
        const fields = labels.map((label, col) => [label, val(sheet, row, col + 1)])
          .filter(([, value]) => value !== undefined && value !== '');
        portfolios.push({ day, filename, sheet: name, kind: 'cartera', currency: norm(name), fields });
      }
      sources.push({ filename, sheet: name, kind: 'cartera' });
    } else if (norm(name).includes('NOTASDECREDITO')) {
      recognized = true;
      sources.push({ filename, sheet: name, kind: 'notas-credito' });
    }
  }
  for (const ref of references) {
    ref.details = [];
    const day = +ref.day.slice(8);
    for (const spec of capture.manifest.sheets) {
      const sheet = workbook.Sheets[spec.name]; if (!sheet) continue;
      for (const slot of spec.slots) {
        const cell=sheet[XLSX.utils.encode_cell({r:slot.row-1,c:spec.startColumn+day-2})];
        if(slot.free&&!clean(val(sheet,slot.row,slot.labelColumn))&&/^(?:\+|=)?(?:SUM|SUBTOTAL|AGGREGATE)\(/i.test(cell?.f||''))continue;
        const kg = val(sheet, slot.row, spec.startColumn + day - 1);
        if (typeof kg === 'number' && Number.isFinite(kg)) ref.details.push({ sheet: spec.name, row: slot.row, kg, label: clean(val(sheet, slot.row, slot.labelColumn)), plate: slot.plateColumn ? clean(val(sheet, slot.row, slot.plateColumn)) : '', labelColumn: slot.labelColumn, plateColumn: slot.plateColumn });
      }
    }
  }
  return { records, references, portfolios, sources, recognized };
}
async function importFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > 10 || files.some(f => !f || !Buffer.isBuffer(f.buffer) || !f.buffer.length || typeof f.filename !== 'string' || f.filename.length > 180) || files.reduce((s, f) => s + f.buffer.length, 0) > MAX_BYTES) throw fail('Adjuntá de 1 a 10 archivos, con un máximo total de 6 MB.');
  const result = { records: [], references: [], portfolios: [], sources: [], files: [], ignored: [] };
  let expanded = 0, books = 0;
  async function read(buffer, filename, nested = false) {
    const extension = path.extname(filename).toLowerCase();
    if (!['.xls', '.xlsx', '.zip'].includes(extension)) { if (nested) return; throw fail('Usá archivos .xls, .xlsx o .zip.'); }
    if (extension === '.zip' && nested) throw fail('No se permiten ZIP dentro de otros ZIP.');
    if (extension === '.xls' && !buffer.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex'))) throw fail(`${filename}: el contenido no corresponde a un libro .xls.`);
    if (extension === '.zip' || extension === '.xlsx') {
      let zip; try { zip = await JSZip.loadAsync(buffer); } catch { throw fail(`${filename}: archivo comprimido inválido.`); }
      const entries = Object.values(zip.files).filter(e => !e.dir);
      expanded += entries.reduce((s, e) => s + (e._data?.uncompressedSize || 0), 0);
      if (expanded > MAX_EXPANDED || entries.length > 2500) throw fail('El contenido expandido supera el límite permitido.');
      if (extension === '.zip') {
        for (const entry of entries) if (/\.(xlsx?|zip)$/i.test(entry.name)) await read(await entry.async('nodebuffer'), path.basename(entry.name.replaceAll('\\', '/')), true);
        return;
      }
    }
    if (++books > 30) throw fail('El lote contiene demasiados libros de Excel.');
    let book; try { book = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellHTML: false, bookVBA: false }); } catch { throw fail(`${filename}: no se pudo leer el Excel.`); }
    if (book.SheetNames.length > 70) throw fail('El libro contiene demasiadas hojas.');
    const parsed = parseWorkbook(book, filename);
    if (!parsed.recognized || (!parsed.records.length && !parsed.references.length && !parsed.portfolios.length)) { if (!nested) throw fail(`${filename}: no contiene ventas utilizables de reporte general, informe diario, captura general o cartera.`); result.ignored.push(filename); return; }
    result.records.push(...parsed.records); result.references.push(...parsed.references); result.portfolios.push(...parsed.portfolios); result.sources.push(...parsed.sources);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    result.files.push({ filename, hash, storedName: `${hash}${extension}`, buffer });
    if (result.records.length > 30000) throw fail('El lote supera 30 000 filas de ventas.');
  }
  for (const file of files) await read(file.buffer, path.basename(file.filename.replaceAll('\\', '/')));
  if (!result.records.length && !result.references.length && !result.portfolios.length) throw fail('No se encontraron ventas o datos de cartera con fechas válidas en los archivos.');
  return result;
}
const recordKey = r => JSON.stringify([r.kind, r.day, norm(r.unit), r.id]);
const referenceKey = r => JSON.stringify([r.day, norm(r.filename)]);
const portfolioKey = r => JSON.stringify([r.day, norm(r.filename), norm(r.sheet), r.kind]);
const same = (a, b) => ['category','payment','liters','kg','gross','discount','net','route'].every(k => a[k] === b[k] || (typeof a[k]==='number'&&typeof b[k]==='number'&&Math.abs(a[k]-b[k])<1e-8));
function merge(previous, imported, actor) {
  const records = new Map((previous.records || []).map(r => [recordKey(r), r]));
  const references = new Map((previous.references || []).map(r => [referenceKey(r), r]));
  const portfolios = new Map((previous.portfolios || []).map(r => [portfolioKey(r), r]));
  const previousHashes = new Map((previous.files || []).map(file => [norm(file.filename), file.hash]));
  const importedHashes = new Map((imported.files || []).map(file => [norm(file.filename), file.hash]));
  let duplicates = 0;
  for (const r of imported.records) {
    const key = recordKey(r), old = records.get(key);
    if (old) { if (!same(old, r)) throw fail(`El documento o resumen ${r.id} del ${r.day} cambió respecto de la importación guardada. Revisá ambos archivos antes de sustituir datos.`); duplicates++; }
    else records.set(key, r);
  }
  for (const r of imported.references) {
    const key = referenceKey(r), old = references.get(key);
    const changed = old && (JSON.stringify(old.cells) !== JSON.stringify(r.cells) || JSON.stringify(old.details||[]) !== JSON.stringify(r.details||[]));
    const sameFile = previousHashes.get(norm(r.filename)) && previousHashes.get(norm(r.filename)) === importedHashes.get(norm(r.filename));
    if (changed && !sameFile) throw fail(`${r.filename}: la captura del ${r.day} cambió respecto de la importación guardada.`);
    references.set(key, changed && sameFile ? r : old || r);
  }
  for (const r of imported.portfolios || []) portfolios.set(portfolioKey(r), r);
  if (records.size > 100000) throw fail('El historial supera 100 000 registros.');
  const files = [...new Map([...(previous.files || []), ...imported.files]
    .map(({ filename, hash, storedName }) => [norm(filename), { filename, hash, storedName }])).values()];
  return { version: 3, revision: (previous.revision || 0) + 1, records: [...records.values()], references: [...references.values()], portfolios: [...portfolios.values()], sources: [...new Map([...(previous.sources || []), ...imported.sources].map(s => [JSON.stringify(s), s])).values()], files, updatedAt: new Date().toISOString(), actor: String(actor || 'ADMIN'), duplicates, ignored: imported.ignored };
}
function createStore(root = path.join(UPLOAD_ROOT, '.captura-general')) {
  let queue = Promise.resolve();
  const file = path.join(root, 'importaciones.json');
  async function load() { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return { records: [], references: [], portfolios: [], sources: [], files: [], revision: 0 }; throw e; } }
  return { load, import(imported, actor, revision) {
    const job = queue.then(async () => {
      const previous = await load();
      if (Number(revision) !== previous.revision) throw Object.assign(fail('Otra importación cambió los datos. Recargá y volvé a adjuntar los archivos.'), { status: 409 });
       const next = merge(previous, imported, actor);
      await fs.mkdir(root, { recursive: true });
       const originals = path.join(root, 'originales');
       await fs.mkdir(originals, { recursive: true });
       for (const original of imported.files || []) {
         if (!Buffer.isBuffer(original.buffer) || !original.storedName) continue;
         const destination = path.join(originals, path.basename(original.storedName));
         try { await fs.writeFile(destination, original.buffer, { flag: 'wx', mode: 0o600 }); }
         catch (error) { if (error.code !== 'EEXIST') throw error; }
       }
      const temp = path.join(root, crypto.randomUUID() + '.tmp');
      try { await fs.writeFile(temp, JSON.stringify(next), { mode: 0o600 }); await fs.rename(temp, file); } finally { await fs.rm(temp, { force: true }); }
      return next;
    }); queue = job.catch(() => {}); return job;
  }, async readOriginal(fileMeta) {
    if (!fileMeta?.storedName || path.basename(fileMeta.storedName) !== fileMeta.storedName) throw fail(`${fileMeta?.filename || 'Archivo'}: volvé a adjuntar el archivo original para habilitar su descarga.`);
    try { return await fs.readFile(path.join(root, 'originales', fileMeta.storedName)); }
    catch (error) { if (error.code === 'ENOENT') throw fail(`${fileMeta.filename}: volvé a adjuntar el archivo original para habilitar su descarga.`); throw error; }
  } };
}
function combineReferences(items) {
  if (!items.length) return null;
  const general = items.filter(item => norm(item.filename).includes('CAPTURAGENERAL'));
  if (general.length) return general.sort((a, b) => a.filename.localeCompare(b.filename))[0];
  const cells = new Map(), details = [];
  for (const item of items) {
    for (const [row, value] of item.cells || []) cells.set(row, (cells.get(row) || 0) + value);
    for (const detail of item.details || []) details.push(detail);
  }
  return { day: items[0].day, filename: items.map(item => item.filename).join(', '), sheet: 'VENTAS TOTALES', cells: [...cells.entries()], details };
}
function modelFor(state, requested) {
  const periods = [...new Set([...state.records, ...state.references, ...(state.portfolios || [])].map(r => r.day.slice(0, 7)))].sort();
  const period = requested || periods.at(-1) || null;
  if (period && (!MONTH.test(period) || !periods.includes(period))) throw fail('Seleccioná un mes importado.');
  const days = [], differences = [], cells = new Map(), all = state.records.filter(r => r.day.startsWith(period || '!'));
  const allReferences = state.references.filter(r => r.day.startsWith(period || '!'));
  const references = [...new Set(allReferences.map(r => r.day))].map(day => combineReferences(allReferences.filter(r => r.day === day)));
  const portfolio = (state.portfolios || []).filter(r => r.day.startsWith(period || '!'));
  const set = (row, d, value) => cells.set(`${row}:${d}`, value);
  const get = (row, d) => cells.get(`${row}:${d}`);
  const detail = all.filter(r => r.kind === 'general');
  const countDays = period ? new Date(Date.UTC(+period.slice(0, 4), +period.slice(5), 0)).getUTCDate() : 0;
  let totalKg = 0, totalNet = 0, totalGross = 0, totalDiscount = 0;
  for (let d = 1; d <= countDays; d++) {
    const day = `${period}-${String(d).padStart(2, '0')}`;
    const daily = all.filter(r => r.day === day && r.kind === 'diario'), invoices = detail.filter(r => r.day === day), ref = references.find(r => r.day === day);
    const selected = daily.length ? daily : invoices;
    let origin = daily.length ? 'Reporte diario' : invoices.length ? 'Reporte general' : ref ? 'Captura recibida' : 'Sin archivo';
    let kg = null, net = null, gross = null, discount = null;
    if (selected.length) {
      for (let k = 0; k < 13; k++) {
        const group = selected.filter(r => r.category === k);
        for (const [pay, amountRow, kgRow, discountRow] of [['CONTADO', 30 + k, 60 + k, 98 + k * 2], ['CREDITO', 45 + k, 75 + k, 99 + k * 2]]) {
          const part = group.filter(r => r.payment === pay);
          set(amountRow, d, part.reduce((s, r) => s + r.gross, 0)); set(kgRow, d, part.reduce((s, r) => s + r.kg, 0)); set(discountRow, d, part.reduce((s, r) => s + r.discount, 0));
        }
        set(12 + k, d, group.reduce((s, r) => s + r.kg, 0));
      }
      kg = selected.reduce((s, r) => s + r.kg, 0); gross = selected.reduce((s, r) => s + r.gross, 0); discount = selected.reduce((s, r) => s + r.discount, 0); net = selected.reduce((s, r) => s + r.net, 0);
      set(25, d, kg); set(26, d, selected.reduce((s, r) => s + r.liters, 0));
      set(89, d, kg); set(90, d, 0);
      set(129, d, selected.filter(r => r.payment === 'CONTADO').reduce((s, r) => s + r.discount, 0));
      set(130, d, selected.filter(r => r.payment === 'CREDITO').reduce((s, r) => s + r.discount, 0));
      // Row 131 means notas de crédito, not commercial discounts. It remains pending unless supplied by the capture.
      if (daily.length && invoices.length) {
        for (let k = 0; k < 13; k++) for (const pay of ['CONTADO', 'CREDITO']) for (const field of ['kg', 'liters', 'gross', 'discount', 'net']) {
          const sum = list => list.filter(r => r.category === k && r.payment === pay).reduce((s, r) => s + r[field], 0);
          const a = sum(daily), b = sum(invoices);
          if (Math.abs(a - b) > .02) differences.push({ day, field: `${capture.manifest.categories[k]} · ${pay} · ${field}`, expected: a, actual: b, source: 'Reporte diario / reporte general' });
        }
      }
    }
    if (ref) for (const [row, value] of ref.cells) {
      if (get(row, d) === undefined) set(row, d, value);
      else if (Math.abs(get(row, d) - value) > .02 && ((row >= 12 && row <= 26) || (row >= 30 && row <= 87) || (row >= 98 && row <= 123))) differences.push({ day, field: `Fila ${row} de captura`, expected: value, actual: get(row, d), source: 'Captura recibida / ventas importadas' });
    }
    if (!selected.length && ref) {
      kg = get(25, d); gross = Array.from({ length: 13 }, (_, k) => (get(30 + k, d) || 0) + (get(45 + k, d) || 0)).reduce((a, b) => a + b, 0);
      discount = (get(129, d) || 0) + (get(130, d) || 0); net = gross - discount;
    }
    if (ref?.details?.length) for (const spec of capture.manifest.sheets) {
      const received=ref.details.filter(item=>item.sheet===spec.name),expected=get(12+capture.manifest.categories.indexOf(spec.category),d);
      const actual=received.reduce((sum,item)=>sum+item.kg,0);
      if(received.length&&typeof expected==='number'&&Math.abs(actual-expected)>.02)differences.push({day,field:`Detalle recibido: ${spec.name}`,expected,actual,source:'Ventas totales / detalle de la captura'});
    }
    if (kg !== null) { totalKg += kg; totalNet += net; totalGross += gross; totalDiscount += discount; }
    days.push({ day, origin, kg, gross, discount, net, documents: invoices.length, hasDetail: !!invoices.length || !!ref?.details?.length, portfolioEntries: portfolio.filter(row => row.day === day).length, captureFiles: allReferences.filter(row => row.day === day).length });
  }
  const fileByName = new Map((state.files || []).map(file => [norm(file.filename), file]));
  const associatedByDay = new Map();
  for (const day of days) {
    const names = new Set([
      ...all.filter(row => row.day === day.day).map(row => norm(row.filename)),
      ...allReferences.filter(row => row.day === day.day).map(row => norm(row.filename)),
      ...portfolio.filter(row => row.day === day.day).map(row => norm(row.filename)),
    ]);
    associatedByDay.set(day.day, [...names].map(name => fileByName.get(name)).filter(Boolean).sort((a, b) => a.filename.localeCompare(b.filename, 'es', { numeric: true })));
  }
  const periodFiles = [...new Map([...associatedByDay.values()].flat().map(file => [norm(file.filename), file])).values()]
    .sort((a, b) => a.filename.localeCompare(b.filename, 'es', { numeric: true }));
  // Every daily package carries the complete set for the month. A workbook can contain
  // required worksheets even when its day column is blank, so filtering by activity
  // would make those sheets disappear from the user's daily download.
  const originalsByDay = new Map(days.map(day => [day.day, periodFiles]));
  return { period, periods, days, differences, detail, allRecords: all, references, portfolio, cells, originalsByDay, periodFiles, totalKg, totalNet, totalGross, totalDiscount, revision: state.revision, files: state.files, sources: state.sources, updatedAt: state.updatedAt || null, duplicates: state.duplicates || 0, ignored: state.ignored || [], categories: capture.manifest.categories };
}
function viewModel(model) { const { cells, detail, allRecords, references, portfolio, originalsByDay, periodFiles, ...view } = model; return view; }
function safeText(value) { return /^[=+@\-]/.test(String(value)) ? "'" + value : value; }
async function exportExcel(model) {
  if (!model.period) throw fail('Primero adjuntá los reportes de ventas.');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gas Tomza';
  const summary = workbook.addWorksheet('VENTAS TOTALES');
  summary.getCell('A1').value = 'CAPTURA GENERAL DIARIA'; summary.getCell('A2').value = model.period;
  summary.getCell('A4').value = 'Vacío: sin archivo. PENDIENTE: dato no incluido. Ver Control de importación.';
  summary.getCell('A10').value = 'VENTAS EN KILOS DIARIO';
  const original = XLSX.readFile(path.join(__dirname, '../templates/captura-general/original.xls'), { cellFormula: false, cellHTML: false });
  for (let row = 11; row <= 140; row++) { const label = val(original.Sheets['VENTAS TOTALES'], row, 1); if (typeof label === 'string') summary.getCell(row, 1).value = safeText(label); }
  summary.getCell('A29').value = 'CONTADO ₡ BRUTO'; summary.getCell('A44').value = 'CRÉDITO ₡ BRUTO'; summary.getCell('A90').value = 'DIFERENCIA KILOS';
  for (let d = 1; d <= 31; d++) summary.getCell(10, d + 1).value = d;
  for (const [key, value] of model.cells) { const [row, day] = key.split(':').map(Number); summary.getCell(row, day + 1).value = value; }
  for (const day of model.days.filter(d => d.kg !== null)) for (const row of [27,95,96,97,124,125,126,128,131,132,133,134,135,136,137,138,139,140]) if (!model.cells.has(`${row}:${+day.day.slice(8)}`)) summary.getCell(row, +day.day.slice(8) + 1).value = 'PENDIENTE';
  for (let row = 12; row <= 140; row++) if (summary.getCell(row, 1).value && model.days.some(d => typeof model.cells.get(`${row}:${+d.day.slice(8)}`) === 'number')) summary.getCell(row, 33).value = { formula: `SUM(B${row}:AF${row})`, result: model.days.reduce((s, d) => s + (model.cells.get(`${row}:${+d.day.slice(8)}`) || 0), 0) };
  summary.getCell('AG10').value = 'Acumulado';
  summary.getCell('AH10').value='Total litros';summary.getCell('AI10').value='Total galones';
  for(let row=12;row<=25;row++){
    const kg=model.days.reduce((sum,d)=>sum+(model.cells.get(`${row}:${+d.day.slice(8)}`)||0),0);
    summary.getCell(row,34).value={formula:`AG${row}/0.54`,result:kg/.54};
    summary.getCell(row,35).value={formula:`AH${row}/3.785412`,result:kg/.54/3.785412};
  }
  // Detailed schedules allocate actual invoice rows using template routes, names and CEDI slots.
  for (const spec of capture.manifest.sheets) {
    const sheet = workbook.addWorksheet(spec.name);
    sheet.getCell('B1').value = spec.name;
    sheet.getCell('B3').value = 'Detalle de la captura recibida y de reportes generales. El resumen diario no incluye ruta/cliente.';
    for (let d = 1; d <= 31; d++) sheet.getCell(4, spec.startColumn + d - 1).value = d;
    let next = Math.max(...spec.slots.map(s => s.row)) + 1;
    const groups = new Map();
    for (const slot of spec.slots) if (!slot.free) sheet.getCell(slot.row, slot.labelColumn).value = safeText(slot.label);
    const referenceTotals = new Map();
    const invoiceDays = new Set(model.detail.map(r=>r.day));
    for (const ref of model.references) if (!invoiceDays.has(ref.day)) {
      const d=+ref.day.slice(8);
      for (const item of (ref.details||[]).filter(r=>r.sheet===spec.name)) {
        sheet.getCell(item.row,spec.startColumn+d-1).value=item.kg;
        if(item.label)sheet.getCell(item.row,item.labelColumn).value=safeText(item.label);
        if(item.plate&&item.plateColumn)sheet.getCell(item.row,item.plateColumn).value=safeText(item.plate);
        referenceTotals.set(d,(referenceTotals.get(d)||0)+item.kg);
      }
    }
    for (const record of model.detail.filter(r => capture.manifest.categories[r.category] === spec.category)) {
      const route = capture.routeCode(record.route);
      const slot = spec.slots.find(s => s.route && capture.routeCode(s.route) === route) || spec.slots.find(s => !s.free && [norm(record.name), norm(record.commercial)].includes(norm(s.label))) || (['PLANTA C.F.', 'PLANTA DISTRIBUIDORES','CAMION DISTRIBUIDORES'].includes(spec.name) ? spec.slots.find(s => capture.region(s.label) && capture.region(s.label) === capture.region(record.unit)) : null);
      const key = slot ? `slot:${slot.row}` : JSON.stringify([record.unit, record.route, spec.category.startsWith('CARBURACION') || spec.category === 'AGENCIAS' ? record.commercial || record.name : '']);
      if (!groups.has(key)) groups.set(key, { row: slot?.row || next++, labelCol: slot?.labelColumn || 2, plateCol:slot?.plateColumn, label: slot?.route ? `Ruta ${route} · ${record.unit}` : slot?.label || [record.unit, record.route, record.commercial || record.name].filter(Boolean).join(' · '), kg: new Map() });
      const group = groups.get(key), d = +record.day.slice(8); group.kg.set(d, (group.kg.get(d) || 0) + record.kg);
    }
    for (const group of groups.values()) {
      sheet.getCell(group.row, group.labelCol).value = safeText(group.label);
      if(group.plateCol)sheet.getCell(group.row,group.plateCol).value='Sin dato en reporte';
      for (const [d, kg] of group.kg) sheet.getCell(group.row, spec.startColumn + d - 1).value = kg;
    }
    const last = Math.max(next, ...spec.slots.map(s => s.row)) + 2;
    sheet.getCell(last, 2).value = 'TOTAL KILOS';
    for (const day of model.days.filter(d => d.hasDetail)) {
      const d = +day.day.slice(8), total = (referenceTotals.get(d)||0)+[...groups.values()].reduce((s, g) => s + (g.kg.get(d) || 0), 0);
      sheet.getCell(last, spec.startColumn + d - 1).value = total;
    }
  }
  const control = workbook.addWorksheet('Control de importación');
  control.addRows([['Período', model.period],['Actualizado', model.updatedAt],['Datos financieros','Cobranza, cartera y otros ingresos solo se conservan cuando están en la captura adjunta.'],['Detalle','Se conserva el detalle de la captura recibida y se agregan los reportes generales desglosados, sin deducir placas o choferes.'],['Fuentes','Reporte diario tiene prioridad para totales; Reporte general aporta detalle y conciliación; Captura recibida aporta base y comparación.'],[],['Fecha','Origen','Kilos','Bruto','Descuento','Neto','Documentos']]);
  for (const d of model.days) control.addRow([d.day, d.origin, d.kg, d.gross, d.discount, d.net, d.documents]);
  control.addRow([]); control.addRow(['Diferencias','Campo','Referencia','Importado','Comparación']);
  for (const diff of model.differences) control.addRow([diff.day, safeText(diff.field), diff.expected, diff.actual, diff.source]);
  control.addRow([]); control.addRow(['Archivo','Hoja','Tipo']);
  for (const source of model.sources) control.addRow([safeText(source.filename),safeText(source.sheet),source.kind]);
  control.addRow([]);control.addRow(['Detalle recibido por fecha','Hoja','Fila','Identificación recibida','Placa recibida','Kilos']);
  for(const ref of model.references)for(const item of ref.details||[])if(item.kg!==0)control.addRow([ref.day,item.sheet,item.row,safeText(item.label),safeText(item.plate),item.kg]);
  const source = workbook.addWorksheet('Datos importados');
  source.addRow(['Fecha','Documento','Unidad','Ruta','Categoría','Pago','Litros','Kilos','Bruto','Descuento','Neto','Archivo','Hoja','Fila']);
  for (const r of model.detail) source.addRow([r.day,safeText(r.id),safeText(r.unit),safeText(r.route),model.categories[r.category],r.payment,r.liters,r.kg,r.gross,r.discount,r.net,safeText(r.filename),safeText(r.sheet),r.row]);
  let portfolioSheet = null;
  if (model.portfolio.length) {
    portfolioSheet = workbook.addWorksheet('Cartera importada');
    portfolioSheet.addRow(['Fecha','Archivo','Hoja','Moneda','Campo','Valor']);
    for (const entry of model.portfolio) for (const [field, value] of entry.fields) portfolioSheet.addRow([entry.day,safeText(entry.filename),safeText(entry.sheet),entry.currency,safeText(field),typeof value === 'string' ? safeText(value) : value]);
  }
  for (const sheet of workbook.worksheets) {
    sheet.views = [{ state: 'frozen', xSplit: sheet === summary ? 1 : 2, ySplit: sheet === summary ? 10 : sheet === control ? 7 : [source,portfolioSheet].includes(sheet) ? 1 : 4, showGridLines: false }];
    sheet.eachRow(row => row.eachCell(cell => { cell.font = { name: 'Arial', size: 10 }; if (typeof cell.value === 'number' || cell.value?.formula) cell.numFmt = '#,##0.00'; }));
    sheet.getColumn(1).width = sheet === summary ? 48 : 20; sheet.getColumn(2).width = sheet === summary ? 18 : 50;
    for (let c = 3; c <= Math.max(sheet.columnCount, 33); c++) sheet.getColumn(c).width = 18;
    const header = sheet.getRow(sheet === summary ? 10 : sheet === control ? 7 : sheet === source ? 1 : 4);
    header.height = 28; header.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17365D' } }; cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; });
    sheet.getRow(1).font = { name: 'Arial', size: 14, bold: true };
    if (![summary,control,source].includes(sheet)) { sheet.mergeCells('B3:N3'); sheet.getCell('B3').alignment = { wrapText: true }; sheet.getRow(3).height = 30; }
  }
  for (const r of [11,29,44,59,74,95,98,129]) summary.getRow(r).font = { name: 'Arial', size: 10, bold: true };
  control.getColumn(2).width = 55; control.getColumn(3).width = 25;
  control.eachRow(row => { row.height = 30; row.eachCell(c => { c.alignment = { wrapText: true, vertical: 'middle' }; }); });
  return workbook.xlsx.writeBuffer();
}
function captureFilter(filename) {
  const name = norm(filename);
  if (name.includes('CAPTURAGENERAL')) return () => true;
  const rules = [
    ['CAPTURAGASTOMZA', ['GASTOMZA']],
    ['CAPTURASUPERGAS', ['SUPERGAS']],
    ['CAPTURACEDILIBERIA', ['LACRUZ']],
    ['CAPTURACEDIATLANTICO', ['CEDIATLANTICO']],
    ['CAPTURACEDIZONASUR', ['CEDIZONASUR']],
    ['CAPTURACEDISANCARLOS', ['CEDISANCARLOS']],
    ['CAPTURACEDIPACIFICO', ['CEDIOROTINA']],
  ];
  const rule = rules.find(([token]) => name.includes(token));
  return rule ? record => rule[1].some(prefix => norm(record.unit).startsWith(prefix)) : null;
}
function capturePatches(model, filename) {
  const accepts = captureFilter(filename);
  if (!accepts) return [];
  const patches = [];
  for (const day of model.days) {
    const daily = model.allRecords.filter(record => record.day === day.day && record.kind === 'diario');
    const invoices = model.allRecords.filter(record => record.day === day.day && record.kind === 'general');
    const selected = (daily.length ? daily : invoices).filter(accepts);
    if (!(daily.length || invoices.length)) continue;
    const d = +day.day.slice(8), put = (row, value) => patches.push({ sheet: 'VENTAS TOTALES', row, column: d + 1, value });
    for (let categoryIndex = 0; categoryIndex < 13; categoryIndex++) {
      const group = selected.filter(record => record.category === categoryIndex);
      for (const [pay, grossRow, kgRow, discountRow] of [['CONTADO', 30 + categoryIndex, 60 + categoryIndex, 98 + categoryIndex * 2], ['CREDITO', 45 + categoryIndex, 75 + categoryIndex, 99 + categoryIndex * 2]]) {
        const part = group.filter(record => record.payment === pay);
        put(grossRow, part.reduce((sum, record) => sum + record.gross, 0));
        put(kgRow, part.reduce((sum, record) => sum + record.kg, 0));
        put(discountRow, part.reduce((sum, record) => sum + record.discount, 0));
      }
      put(12 + categoryIndex, group.reduce((sum, record) => sum + record.kg, 0));
    }
    put(25, selected.reduce((sum, record) => sum + record.kg, 0));
    put(26, selected.reduce((sum, record) => sum + record.liters, 0));
    put(89, selected.reduce((sum, record) => sum + record.kg, 0));
    put(90, 0);
    put(129, selected.filter(record => record.payment === 'CONTADO').reduce((sum, record) => sum + record.discount, 0));
    put(130, selected.filter(record => record.payment === 'CREDITO').reduce((sum, record) => sum + record.discount, 0));
  }
  return patches;
}
async function completedOriginals(model, files, readOriginal) {
  const buffers = new Map();
  for (const file of files) buffers.set(file.filename, await readOriginal(file));
  const jobs = files.map((file, index) => ({ file, index, patches: capturePatches(model, file.filename) })).filter(job => job.patches.length && path.extname(job.file.filename).toLowerCase() === '.xls');
  if (!jobs.length) return buffers;
  if (process.platform !== 'win32') throw Object.assign(new Error('Las capturas con formato XLS original requieren Microsoft Excel en el servidor.'), { status: 503 });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'capturas-completas-'));
  try {
    const manifest = [];
    for (const job of jobs) {
      const input = path.join(root, `entrada-${job.index}.xls`), output = path.join(root, `salida-${job.index}.xls`);
      await fs.writeFile(input, buffers.get(job.file.filename));
      manifest.push({ input, output, patches: job.patches });
      job.output = output;
    }
    const manifestPath = path.join(root, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '../scripts/completarCapturasExcel.ps1'), '-Manifest', manifestPath], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
    for (const job of jobs) buffers.set(job.file.filename, await fs.readFile(job.output));
    return buffers;
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
async function addOriginals(zip, files, readOriginal, prefix = '', prepared = null) {
  if (typeof readOriginal !== 'function') throw new Error('Falta el lector de archivos originales.');
  if (!files.length) throw fail('No hay archivos originales asociados a esta selección.');
  for (const file of files) zip.file(`${prefix}${file.filename}`, prepared?.get(file.filename) || await readOriginal(file));
}
async function exportOriginals(model, readOriginal) {
  if (!model.period) throw fail('Primero adjuntá los reportes de ventas.');
  const zip = new JSZip(), prepared = await completedOriginals(model, model.periodFiles || [], readOriginal);
  await addOriginals(zip, model.periodFiles || [], readOriginal, '', prepared);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
async function exportDay(model, requestedDay, readOriginal) {
  const day = date(requestedDay);
  if (!day || !model.period || !day.startsWith(model.period + '-')) throw fail('Seleccioná una fecha válida del mes importado.');
  const daily = model.days.find(item => item.day === day);
  if (!daily || (daily.kg === null && !daily.portfolioEntries && !daily.captureFiles)) throw fail('Esa fecha no tiene información importada.');
  const files = model.originalsByDay.get(day) || [], zip = new JSZip(), prepared = await completedOriginals(model, files, readOriginal);
  await addOriginals(zip, files, readOriginal, '', prepared);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
async function exportDaysZip(model, readOriginal) {
  if (!model.period) throw fail('Primero adjuntá los reportes de ventas.');
  const available = model.days.filter(day => day.kg !== null || day.portfolioEntries || day.captureFiles);
  if (!available.length) throw fail('El mes no tiene días disponibles para descargar.');
  const zip = new JSZip(), prepared = await completedOriginals(model, model.periodFiles || [], readOriginal);
  for (const day of available) await addOriginals(zip, model.originalsByDay.get(day.day) || [], readOriginal, `${day.day}/`, prepared);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
module.exports = { importFiles, parseWorkbook, merge, createStore, modelFor, viewModel, exportExcel, exportOriginals, exportDay, exportDaysZip, capturePatches, category, date };
