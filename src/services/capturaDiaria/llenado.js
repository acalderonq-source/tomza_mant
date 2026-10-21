// Llena las 11 capturas (7 de ventas, la general y 3 carteras) a partir de las
// ventas del Reporte General y de la cobranza digitada.
const fs = require('node:fs/promises');
const path = require('node:path');
const L = require('./xlsxLibro');
const { createEngine, isError } = require('./formulas');
const { norm, clean } = require('./reporteGeneral');

const TEMPLATE_DIR = path.join(__dirname, '../../templates/captura-diaria');
const FILES = {
  GENERAL: '1-captura general.xlsx',
  GT: '2-CAPTURA GAS TOMZA.xlsx',
  SG: '3-CAPTURA SUPER GAS.xlsx',
  LIB: '4-CAPTURA CEDI LIBERIA.xlsx',
  ATL: '5-CAPTURA CEDI ATLANTICO.xlsx',
  ZS: '6-CAPTURA CEDI ZONA SUR.xlsx',
  SC: '7-CAPTURA CEDI SAN CARLOS.xlsx',
  PAC: '8-CAPTURA CEDI PACIFICO.xlsx',
  CARTERA_GENERAL: '16-CARTERA GENERAL.xlsx',
  CARTERA_GT: '17-CARTERA GAS TOMZA.xlsx',
  CARTERA_SG: '18-CARTERA SUPER GAS.xlsx',
};
const CAPTURES = ['GT', 'SG', 'LIB', 'ATL', 'ZS', 'SC', 'PAC'];
const CAPTURE_NAMES = { GT: 'Gas Tomza', SG: 'Super Gas', LIB: 'CEDI Liberia', ATL: 'CEDI Atlántico', ZS: 'CEDI Zona Sur', SC: 'CEDI San Carlos', PAC: 'CEDI Pacífico' };
const CATEGORY_NAMES = { PULPERIAS: 'Camión pulperías', DISTRIBUIDOR: 'Camión distribuidores', PLANTADIST: 'Planta distribuidores', PLANTA: 'Planta C.F.', VIP: 'Camión C.F. (VIP)', GRANEL: 'Granel comercial', GRANGRANEL: 'Gran granel', GRANELPETRO: 'Granel Petro', CARBURACION: 'Carburación estaciones', CARBCOM: 'Carburación comercial', TIENDAS: 'Tiendas / agencias', MINIPLANTA: 'Distribuidores mini planta' };
const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const fail = message => Object.assign(new Error(message), { status: 400 });

const daysIn = month => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
const serial = (month, d) => (Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
const monthOfSerial = s => { const t = new Date(Date.UTC(1899, 11, 30) + s * 86400000); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
const prevMonth = m => { const y = +m.slice(0, 4), mo = +m.slice(5, 7); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };
const round = v => Math.round(v * 1e6) / 1e6;

// ---------- Resumen de un reporte: lo que se guarda por día ----------
function summarizeDay(rows) {
  const cuadro = {}, detail = {};
  for (const r of rows) {
    const k = `${r.capture}|${r.category}|${r.payment}`;
    const c = cuadro[k] ||= { gross: 0, discount: 0, net: 0, kg: 0, docs: 0 };
    c.gross += r.gross; c.discount += r.discount; c.net += r.net; c.kg += r.kg; c.docs++;
    if (['PULPERIAS', 'GRANEL', 'CARBURACION'].includes(r.category)) {
      const name = r.category === 'CARBURACION' ? (r.commercial || r.client) : '';
      const dk = `${r.capture}|${r.category}|${r.route}|${name}`;
      const d = detail[dk] ||= { capture: r.capture, category: r.category, route: r.route, name, client: r.client, kg: 0, net: 0 };
      d.kg += r.kg; d.net += r.net;
    }
  }
  for (const v of Object.values(cuadro)) for (const f of ['gross', 'discount', 'net', 'kg']) v[f] = round(v[f]);
  return { cuadro, detail: Object.values(detail).map(d => ({ ...d, kg: round(d.kg), net: round(d.net) })) };
}

// ---------- Ubicación de las celdas que se digitan en cada plantilla ----------
const text = v => (v === null || v === undefined || typeof v === 'object') ? '' : String(v);
function cuadroCategory(label) {
  const t = norm(label);
  if (!t) return null;
  if (t.includes('MINIPLANTA')) return 'MINIPLANTA';
  if (t.includes('PLANTADISTRIBUIDOR')) return 'PLANTADIST';
  if (t.includes('PLANTAPUBLICO') || t.endsWith('PLANTA')) return 'PLANTA';
  if (t.includes('CAMIONCF')) return 'VIP';
  if (t.includes('GRANGRANEL')) return 'GRANGRANEL';
  if (t.includes('GRANELPETRO')) return 'GRANELPETRO';
  if (t.includes('GRANEL')) return 'GRANEL';
  if (t.includes('CARBURACIONCOMERCIAL')) return 'CARBCOM';
  if (t.includes('CARBURACION')) return 'CARBURACION';
  if (t.includes('TIENDA')) return 'TIENDAS';
  if (t.includes('HINOS') || t.includes('PULPERIA')) return 'PULPERIAS';
  if (t.includes('DISTRIBUIDOR')) return 'DISTRIBUIDOR';
  return null;
}
const BLOCKS = { CONTADOCOLONES: ['gross', 'CONTADO'], CREDITOCOLONES: ['gross', 'CREDITO'], KILOSCONTADO: ['kg', 'CONTADO'], KILOSCREDITO: ['kg', 'CREDITO'], DESCUENTOCONTADO: ['discount', 'CONTADO'], DESCUENTOCREDITO: ['discount', 'CREDITO'] };

function cuadroLayout(sheet, key) {
  if (!sheet) throw new Error(`${FILES[key]}: falta la hoja Cuadro de Ventas.`);
  const rows = [...new Set([...sheet.cells.values()].map(c => c.r))].sort((a, b) => a - b);
  const blocks = [];
  let block = null;
  for (const r of rows) {
    const label = text(sheet.cells.get(L.addrOf(r, 2))?.value);
    const head = BLOCKS[norm(label)];
    if (head) { block = { measure: head[0], payment: head[1], rows: [] }; blocks.push(block); continue; }
    const category = cuadroCategory(label);
    if (block && category && !sheet.cells.get(L.addrOf(r, 3))?.formula) block.rows.push({ r, category });
  }
  if (blocks.length !== 6) throw new Error(`${FILES[key]}: no se encontraron los 6 bloques del Cuadro de Ventas.`);
  return blocks;
}

function dayHeader(sheet) {
  for (let r = 1; r <= 8; r++) for (let c = 1; c <= 12; c++) {
    if (sheet.cells.get(L.addrOf(r, c))?.value === 1 && sheet.cells.get(L.addrOf(r, c + 1))?.value === 2) return { r, c };
  }
  return null;
}
function slotCodes(values) {
  const codes = new Set(), names = new Set();
  for (const v of values) {
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) { codes.add(String(v)); continue; }
    const s = clean(text(v));
    if (!s) continue;
    if (norm(s).length >= 4 && /[A-Z]/i.test(s)) names.add(norm(s));
    const outside = s.replace(/\([^)]*\)/g, ' ');
    const list = /(\d{3,})((?:\s*,\s*\d+)*)/.exec(outside);
    if (list) {
      const base = list[1];
      codes.add(String(+base));
      for (const n of list[2].split(',').map(x => x.trim()).filter(Boolean)) codes.add(String(+(base.slice(0, Math.max(0, base.length - n.length)) + n)));
    } else { const one = /\b(\d{1,4})\b/.exec(outside); if (one) codes.add(String(+one[1])); }
  }
  return { codes, names };
}
function detailLayout(sheet) {
  if (!sheet) return null;
  const head = dayHeader(sheet);
  if (!head) return null;
  const labelCols = Array.from({ length: head.c - 1 }, (_, i) => i + 1);
  const rows = [...new Set([...sheet.cells.values()].map(c => c.r))].filter(r => r > head.r).sort((a, b) => a - b);
  const totalRow = rows.find(r => labelCols.some(c => /TOTAL/i.test(text(sheet.cells.get(L.addrOf(r, c))?.value))));
  if (!totalRow) return null;
  // El rango que suma la fila de total define qué filas cuentan.
  let from = head.r + 1, to = totalRow - 1;
  for (let d = 0; d < 31; d++) {
    const f = sheet.cells.get(L.addrOf(totalRow, head.c + d))?.formula;
    const m = f && /SUM\(\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)\)/.exec(f);
    if (m) { from = +m[1]; to = +m[2]; break; }
  }
  const slots = [];
  for (let r = from; r <= to; r++) {
    const dayCells = Array.from({ length: 31 }, (_, d) => sheet.cells.get(L.addrOf(r, head.c + d)));
    // Filas calculadas (subtotales) no se digitan; una fórmula suelta en un día sí se respeta.
    if (dayCells.filter(c => c?.formula).length > 15) continue;
    const labels = labelCols.map(c => sheet.cells.get(L.addrOf(r, c))?.value);
    const { codes, names } = slotCodes(labels);
    const empty = labels.every(v => !clean(text(v)) || v === 0);
    const hasData = dayCells.some(c => typeof c?.value === 'number' && c.value !== 0);
    slots.push({ r, codes, names, free: empty && !hasData });
  }
  return { sheet, startCol: head.c, labelCols, slots };
}
const DETAIL_SHEETS = {
  PULPERIAS: [['CAMION PULPERIAS', 'kg']],
  GRANEL: [['GRANEL COMERCIAL', 'kg']],
  CARBURACION: [['CARBURACION ESTACIONES', 'kg'], ['CARBURACION EFECTIVO', 'net'], ['CARBURACION DINERO', 'net']],
};

function cobranzaCells(book) {
  const sheet = book.sheet('VENTAS TOTALES');
  const rows = [...sheet.cells.values()].filter(c => c.c === 1 && /^COBRANZA/.test(norm(c.value)) && !norm(c.value).includes('TOTAL'));
  return rows.map(c => c.r).filter(r => !sheet.cells.get(L.addrOf(r, 2))?.formula);
}

// ---------- Generación ----------
async function loadTemplates(dir = TEMPLATE_DIR) {
  const books = new Map();
  for (const file of Object.values(FILES)) books.set(file, await L.loadBook(await fs.readFile(path.join(dir, file)), file));
  return books;
}

function templateMonth(books) {
  const v = books.get(FILES.GENERAL).sheet('VENTAS TOTALES').cells.get('B9')?.value;
  if (typeof v !== 'number') throw new Error('La plantilla general no tiene la fecha del día 1 en VENTAS TOTALES!B9.');
  return monthOfSerial(v);
}

function matchSlot(layout, fact) {
  const allocated = layout.allocated ||= new Map();
  const key = `${fact.route}|${norm(fact.name)}`;
  if (allocated.has(key)) return { slot: allocated.get(key), how: 'nueva' };
  const names = [norm(fact.name), norm(fact.client)].filter(n => n.length >= 4);
  let slot = fact.route && layout.slots.find(s => s.codes.has(fact.route));
  if (slot) return { slot, how: 'ruta' };
  slot = layout.slots.find(s => names.some(n => s.names.has(n)));
  if (slot) return { slot, how: 'nombre' };
  slot = layout.slots.find(s => [...s.names].some(sn => sn.length >= 8 && names.some(n => n.includes(sn) || sn.includes(n))));
  if (slot) return { slot, how: 'nombre' };
  slot = layout.slots.find(s => s.free && !s.taken);
  if (!slot) return null;
  slot.taken = true;
  allocated.set(key, slot);
  // Etiqueta de la fila nueva: código de ruta y nombre, como en las demás filas.
  const [first, second] = layout.labelCols;
  const above = layout.slots.filter(s => s.r < slot.r && !s.free).at(-1)?.r ?? slot.r;
  L.setValue(layout.sheet, L.addrOf(slot.r, first), fact.route ? +fact.route : null, { styleFrom: L.addrOf(above, first) });
  if (second) L.setValue(layout.sheet, L.addrOf(slot.r, second), fact.name || fact.client || `Ruta ${fact.route}`, { styleFrom: L.addrOf(above, second) });
  slot.codes.add(fact.route);
  return { slot, how: 'nueva' };
}

async function generateMonth(state, month, options = {}) {
  if (!MONTH.test(month || '')) throw fail('Seleccione un mes válido.');
  const books = await loadTemplates(options.templateDir);
  const tMonth = templateMonth(books);
  if (month < tMonth) throw fail(`Las plantillas empiezan en ${tMonth}; no se puede generar ${month}.`);
  const warnings = [], notes = [];
  const total = daysIn(month);
  const fresh = month !== tMonth;
  const daysWithData = Object.keys(state.days || {}).filter(d => d.startsWith(month + '-')).sort();
  const cobranza = state.cobranza || {};

  // Capas de cada captura.
  const layouts = {};
  for (const key of CAPTURES) {
    const book = books.get(FILES[key]);
    const details = {};
    for (const [category, sheets] of Object.entries(DETAIL_SHEETS)) {
      details[category] = sheets.map(([name, measure]) => ({ layout: detailLayout(book.sheet(name)), measure, name })).filter(x => x.layout);
    }
    layouts[key] = { book, cuadro: book.sheet('Cuadro de Ventas'), blocks: cuadroLayout(book.sheet('Cuadro de Ventas'), key), details, cobranza: cobranzaCells(book) };
  }

  const clearDay = (key, d, value) => {
    const lay = layouts[key];
    for (const b of lay.blocks) for (const row of b.rows) L.setValue(lay.cuadro, L.addrOf(row.r, 2 + d), value);
    for (const list of Object.values(lay.details)) for (const { layout } of list) for (const s of layout.slots) {
      const addr = L.addrOf(s.r, layout.startCol + d - 1);
      if (!layout.sheet.cells.get(addr)?.formula) L.setValue(layout.sheet, addr, null, { styleFrom: L.addrOf(s.r, layout.startCol) });
    }
  };

  // Mes distinto al de la plantilla: se vacían los datos y se ponen las fechas nuevas.
  if (fresh) {
    for (const key of CAPTURES) {
      for (let d = 1; d <= 31; d++) clearDay(key, d, null);
      const vt = layouts[key].book.sheet('VENTAS TOTALES');
      for (const r of layouts[key].cobranza) for (let d = 1; d <= 31; d++) L.setValue(vt, L.addrOf(r, 1 + d), null);
    }
    const gvt = books.get(FILES.GENERAL).sheet('VENTAS TOTALES');
    for (let d = 1; d <= 31; d++) L.setValue(gvt, L.addrOf(9, 1 + d), d <= total ? serial(month, d) : null);
    for (const f of [FILES.CARTERA_GENERAL, FILES.CARTERA_GT, FILES.CARTERA_SG]) {
      for (const sheet of books.get(f).sheets) {
        for (const cell of sheet.cells.values()) {
          if (cell.formula || cell.r < 5 || cell.r > 35 || cell.c < 2 || typeof cell.value !== 'number') continue;
          if (cell.c === 2 && cell.r === 5) continue; // saldo inicial: se define abajo
          L.setValue(sheet, cell.addr, null); // retenciones y cheques del mes de la plantilla
        }
        if (typeof sheet.cells.get('A5')?.value === 'number' && !sheet.cells.get('A5').formula) L.setValue(sheet, 'A5', serial(month, 1));
      }
    }
    // Saldo inicial: el digitado para el mes o el saldo final del mes anterior.
    const opening = state.saldos?.[month] || {};
    let previous = null;
    for (const [key, file] of [['GT', FILES.CARTERA_GT], ['SG', FILES.CARTERA_SG]]) {
      let value = opening[key];
      if (typeof value !== 'number') {
        previous ||= (await generateMonth(state, prevMonth(month), { ...options, onlySummary: true })).summary.saldoFinal;
        value = previous[key];
        notes.push(`Saldo inicial de ${key === 'GT' ? 'Gas Tomza' : 'Super Gas'} tomado del saldo final de ${prevMonth(month)}.`);
      }
      L.setValue(books.get(file).sheet('COLONES'), 'B5', value);
    }
  } else if (state.saldos?.[month]) {
    for (const [key, file] of [['GT', FILES.CARTERA_GT], ['SG', FILES.CARTERA_SG]]) {
      if (typeof state.saldos[month][key] === 'number') L.setValue(books.get(file).sheet('COLONES'), 'B5', state.saldos[month][key]);
    }
  }

  // Días con Reporte General: se reemplaza la columna completa del día.
  const placed = {};
  for (const day of daysWithData) {
    const d = +day.slice(8);
    const info = state.days[day];
    for (const key of CAPTURES) clearDay(key, d, 0);
    for (const [k, v] of Object.entries(info.cuadro)) {
      const [key, category, payment] = k.split('|');
      const lay = layouts[key];
      let ok = true;
      for (const measure of ['gross', 'kg', 'discount']) {
        const block = lay.blocks.find(b => b.measure === measure && b.payment === payment);
        const row = block.rows.find(x => x.category === category);
        if (!row) { ok = false; continue; }
        const addr = L.addrOf(row.r, 2 + d);
        L.setValue(lay.cuadro, addr, round((L.current(lay.cuadro, addr) || 0) + v[measure]));
      }
      if (!ok) warnings.push(`${day}: ${CAPTURE_NAMES[key]} no tiene fila de ${CATEGORY_NAMES[category]} ${payment.toLowerCase()} en el Cuadro de Ventas (₡${v.gross.toLocaleString('es-CR')}, ${v.kg.toFixed(2)} kg sin colocar).`);
      placed[`${day}|${key}`] ||= { kg: 0, gross: 0, discount: 0, net: 0 };
      if (ok) for (const f of ['kg', 'gross', 'discount', 'net']) placed[`${day}|${key}`][f] += v[f];
    }
    for (const fact of info.detail) {
      for (const { layout, measure, name } of layouts[fact.capture].details[fact.category] || []) {
        const found = matchSlot(layout, fact);
        if (!found) { warnings.push(`${day}: ${CAPTURE_NAMES[fact.capture]} · ${name}: no hay fila libre para la ruta ${fact.route} ${fact.name || ''} (${fact[measure].toFixed(2)}); el total del día sí la incluye, el detalle no.`); continue; }
        const note = `${CAPTURE_NAMES[fact.capture]} · ${name}: ruta ${fact.route}${fact.name ? ' ' + fact.name : ''} agregada en la fila ${found.slot.r}.`;
        if (found.how === 'nueva' && !notes.includes(note)) notes.push(note);
        const addr = L.addrOf(found.slot.r, layout.startCol + d - 1);
        if (layout.sheet.cells.get(addr)?.formula) { warnings.push(`${day}: ${CAPTURE_NAMES[fact.capture]} · ${name} fila ${found.slot.r}: la celda del día es una fórmula de la plantilla; no se escribió ${fact[measure].toFixed(2)}.`); continue; }
        L.setValue(layout.sheet, addr, round((L.current(layout.sheet, addr) || 0) + fact[measure]), { styleFrom: L.addrOf(found.slot.r, layout.startCol) });
        (options.trace || []).push({ day, capture: fact.capture, sheet: name, row: found.slot.r, how: found.how, route: fact.route, name: fact.name, value: fact[measure] });
      }
    }
    // Control: el detalle de cada hoja debe sumar lo mismo que el Cuadro de Ventas.
    for (const key of CAPTURES) for (const [category, list] of Object.entries(layouts[key].details)) for (const { layout, measure, name } of list) {
      const expected = ['CONTADO', 'CREDITO'].reduce((s, p) => s + (info.cuadro[`${key}|${category}|${p}`]?.[measure] || 0), 0);
      const actual = layout.slots.reduce((s, sl) => s + (Number(L.current(layout.sheet, L.addrOf(sl.r, layout.startCol + d - 1))) || 0), 0);
      if (Math.abs(expected - actual) > 0.05) warnings.push(`${day}: ${CAPTURE_NAMES[key]} · ${name}: el detalle suma ${actual.toFixed(2)} y el Cuadro de Ventas ${expected.toFixed(2)}.`);
    }
  }
  // Cobranza digitada.
  for (const [day, values] of Object.entries(cobranza)) {
    if (!day.startsWith(month + '-')) continue;
    const d = +day.slice(8);
    for (const key of ['GT', 'SG']) {
      if (typeof values[key] !== 'number') continue;
      const lay = layouts[key];
      if (!lay.cobranza.length) { warnings.push(`${CAPTURE_NAMES[key]}: la plantilla no tiene fila de cobranza.`); continue; }
      L.setValue(lay.book.sheet('VENTAS TOTALES'), L.addrOf(lay.cobranza[0], 1 + d), values[key], { styleFrom: L.addrOf(lay.cobranza[0], 2) });
    }
  }

  // Recalcular todo y guardar los resultados en las fórmulas.
  const engine = createEngine(books);
  for (const book of books.values()) for (const sheet of book.sheets) for (const cell of sheet.cells.values()) {
    if (!cell.formula) continue;
    const v = engine.value(book, sheet.name, cell.addr);
    const same = typeof v === 'number' && typeof cell.value === 'number' ? Math.abs(v - cell.value) < 1e-9 : (isError(v) && isError(cell.value)) || v === cell.value;
    if (!same) L.setValue(sheet, cell.addr, v, { overwriteFormula: true });
  }
  if (engine.problems.length) warnings.push(...engine.problems.slice(0, 20).map(p => `Fórmula no calculada: ${p}`));

  const summary = buildSummary(books, engine, month, daysWithData, state, placed);
  if (options.onlySummary) return { month, summary, warnings, notes };
  const lookup = (file, sheetName, addr) => {
    const book = books.get(file) || [...books.values()].find(b => b.name.toLowerCase() === String(file).toLowerCase());
    return book ? engine.value(book, sheetName, addr) : undefined;
  };
  const files = [];
  for (const book of books.values()) files.push({ filename: book.name, buffer: await L.writeBook(book, lookup) });
  return { month, files, summary, warnings, notes };
}

function buildSummary(books, engine, month, daysWithData, state, placed) {
  const val = (file, sheet, addr) => { const v = engine.value(books.get(file), sheet, addr); return typeof v === 'number' ? v : 0; };
  const general = FILES.GENERAL;
  const days = [];
  for (let d = 1; d <= daysIn(month); d++) {
    const day = `${month}-${String(d).padStart(2, '0')}`;
    const col = L.colLetters(1 + d);
    const captures = CAPTURES.map(key => ({ key, name: CAPTURE_NAMES[key], kg: val(FILES[key], 'VENTAS TOTALES', `${col}25`), expected: placed[`${day}|${key}`]?.kg ?? null }));
    days.push({
      day,
      fuente: daysWithData.includes(day) ? 'Reporte General' : (val(general, 'VENTAS TOTALES', `${col}25`) ? 'Plantilla' : 'Sin datos'),
      kg: val(general, 'VENTAS TOTALES', `${col}25`),
      contado: Array.from({ length: 13 }, (_, k) => val(general, 'VENTAS TOTALES', `${col}${30 + k}`)).reduce((a, b) => a + b, 0),
      credito: Array.from({ length: 13 }, (_, k) => val(general, 'VENTAS TOTALES', `${col}${45 + k}`)).reduce((a, b) => a + b, 0),
      cobranzaGT: val(FILES.GT, 'VENTAS TOTALES', `${col}95`),
      cobranzaSG: val(FILES.SG, 'VENTAS TOTALES', `${col}95`),
      cobranzaDigitada: state.cobranza?.[day] || null,
      captures,
      reporte: state.days?.[day] ? { filename: state.days[day].filename, documentos: state.days[day].documentos, importedAt: state.days[day].importedAt } : null,
    });
  }
  const saldoFinal = {};
  for (const [key, file] of [['GT', FILES.CARTERA_GT], ['SG', FILES.CARTERA_SG], ['GENERAL', FILES.CARTERA_GENERAL]]) {
    const sheet = books.get(file).sheet('COLONES');
    const header = [...sheet.cells.values()].find(c => c.r <= 6 && norm(c.value) === 'SALDOFINAL');
    saldoFinal[key] = header ? val(file, 'COLONES', L.addrOf(4 + daysIn(month), header.c)) : null;
    saldoFinal[key + '_inicial'] = val(file, 'COLONES', 'B5');
  }
  return { month, days, saldoFinal };
}

module.exports = { generateMonth, summarizeDay, loadTemplates, templateMonth, FILES, CAPTURES, CAPTURE_NAMES, TEMPLATE_DIR, daysIn };
