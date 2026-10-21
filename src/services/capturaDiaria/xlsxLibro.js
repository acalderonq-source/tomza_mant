// Lectura y escritura de libros .xlsx a nivel de XML.
// Solo cambia los valores de las celdas: formato, anchos, colores, fórmulas,
// imágenes y vínculos externos se conservan tal como vienen en la plantilla.
const JSZip = require('jszip');
const path = require('node:path');

const colNumber = letters => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colLetters = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const splitAddr = addr => { const m = /^([A-Z]+)(\d+)$/.exec(addr); return m ? { c: colNumber(m[1]), r: +m[2] } : null; };
const addrOf = (r, c) => colLetters(c) + r;

const decodeXml = s => s.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (m, e) => (
  e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'"
    : e[1] === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(+e.slice(1))));
const encodeXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = (attrs, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs); return m ? decodeXml(m[1]) : undefined; };
const textOf = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => decodeXml(m[1])).join('');

// Desplaza las referencias relativas de una fórmula compartida (no toca textos entre comillas).
function shiftFormula(formula, dr, dc) {
  if (!dr && !dc) return formula;
  return formula.split(/('(?:[^']|'')*'|"(?:[^"]|"")*")/).map((part, i) => {
    if (i % 2) return part;
    return part.replace(/(^|[^A-Za-z0-9_.\]])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (m, pre, dcol, col, drow, row) => {
      const c = dcol ? colNumber(col) : colNumber(col) + dc;
      const r = drow ? +row : +row + dr;
      if (c < 1 || r < 1) return m;
      return `${pre}${dcol}${colLetters(c)}${drow}${r}`;
    });
  }).join('');
}

const CELL = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

function parseCells(xml, sharedStrings) {
  const cells = new Map();
  const masters = new Map();
  for (const m of xml.matchAll(CELL)) {
    const [, addr, attrs, inner = ''] = m;
    const t = attr(attrs, 't');
    const fm = /<f([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(inner);
    const vm = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
    let value = null;
    if (t === 'inlineStr') value = textOf(inner);
    else if (vm) {
      const raw = decodeXml(vm[1]);
      if (t === 's') value = sharedStrings[+raw] ?? '';
      else if (t === 'str') value = raw;
      else if (t === 'b') value = raw === '1';
      else if (t === 'e') value = { error: raw };
      else value = Number(raw);
    }
    const cell = { addr, ...splitAddr(addr), value, formula: null };
    if (fm) {
      const fattrs = fm[1];
      const text = fm[2] !== undefined ? decodeXml(fm[2]) : '';
      if (attr(fattrs, 't') === 'shared') {
        const si = attr(fattrs, 'si');
        if (text) { masters.set(si, { text, r: cell.r, c: cell.c }); cell.formula = text; }
        else cell.sharedIndex = si;
      } else if (attr(fattrs, 't') !== 'array' || text) cell.formula = text || null;
    }
    cells.set(addr, cell);
  }
  for (const cell of cells.values()) {
    if (cell.sharedIndex === undefined) continue;
    const master = masters.get(cell.sharedIndex);
    if (master) cell.formula = shiftFormula(master.text, cell.r - master.r, cell.c - master.c);
    delete cell.sharedIndex;
  }
  return cells;
}

function relTargets(xml) {
  return new Map([...xml.matchAll(/<Relationship\b([^>]*)\/?>/g)].map(m => [attr(m[1], 'Id'), { target: attr(m[1], 'Target'), mode: attr(m[1], 'TargetMode') }]));
}
const resolvePart = (base, target) => target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(base), target));

async function loadBook(buffer, name) {
  const zip = await JSZip.loadAsync(buffer);
  const read = async p => { const f = zip.file(p); return f ? f.async('string') : null; };
  const workbookXml = await read('xl/workbook.xml');
  const rels = relTargets(await read('xl/_rels/workbook.xml.rels'));
  const ssXml = await read('xl/sharedStrings.xml');
  const sharedStrings = ssXml ? [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1])) : [];
  const sheets = [];
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const sheetName = attr(m[1], 'name');
    const rid = attr(m[1], 'r:id');
    const part = resolvePart('xl/workbook.xml', rels.get(rid).target);
    const xml = await read(part);
    sheets.push({ name: sheetName, part, cells: parseCells(xml, sharedStrings), changes: new Map() });
  }
  const externals = [];
  const externalRefs = [...workbookXml.matchAll(/<externalReference r:id="([^"]+)"\/>/g)].map(m => m[1]);
  for (const [i, rid] of externalRefs.entries()) {
    const part = resolvePart('xl/workbook.xml', rels.get(rid).target);
    const xml = await read(part);
    const relsPart = path.posix.join(path.posix.dirname(part), '_rels', path.posix.basename(part) + '.rels');
    const linkRels = relTargets(await read(relsPart) || '');
    const bookRid = attr(/<externalBook\b([^>]*)>/.exec(xml)?.[1] || '', 'r:id');
    const target = linkRels.get(bookRid)?.target || '';
    const file = decodeURIComponent(target.replace(/^file:\/+/, '').split(/[\\/]/).pop());
    const sheetNames = [...xml.matchAll(/<sheetName val="([^"]*)"\/>/g)].map(x => decodeXml(x[1]));
    // Últimos valores guardados del vínculo: se usan si el libro vinculado no forma parte del juego.
    const cache = new Map();
    for (const sd of xml.matchAll(/<sheetData sheetId="(\d+)"(?:\/>|>([\s\S]*?)<\/sheetData>)/g)) {
      for (const c of (sd[2] || '').matchAll(/<cell r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/cell>)/g)) {
        const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(c[3] || '');
        const t = attr(c[2], 't');
        const v = !raw ? null : t === 'str' ? decodeXml(raw[1]) : t === 'e' ? { error: decodeXml(raw[1]) } : t === 'b' ? raw[1] === '1' : Number(raw[1]);
        cache.set(`${sheetNames[+sd[1]]}|${c[1]}`, v);
      }
    }
    externals.push({ index: i + 1, part, relsPart, file, sheetNames, cache });
  }
  return {
    name, zip, sheets, externals,
    sheet(sheetName) { return sheets.find(s => s.name === sheetName) || null; },
  };
}

// Valor vigente de una celda: el cambio pendiente o el valor de la plantilla.
const current = (sheet, addr) => sheet.changes.has(addr) ? sheet.changes.get(addr).value : sheet.cells.get(addr)?.value ?? null;

function setValue(sheet, addr, value, options = {}) {
  const cell = sheet.cells.get(addr);
  if (cell?.formula && !options.overwriteFormula) throw new Error(`${sheet.name}!${addr} es una fórmula de la plantilla.`);
  sheet.changes.set(addr, { value, styleFrom: options.styleFrom });
}

function cellXml(addr, attrs, formulaXml, value) {
  const keep = attrs.replace(/\s+t="[^"]*"/, '');
  if (value === null || value === undefined || value === '') return formulaXml ? `<c r="${addr}"${keep}>${formulaXml}</c>` : `<c r="${addr}"${keep}/>`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return `<c r="${addr}"${keep} t="e">${formulaXml}<v>#NUM!</v></c>`;
    return `<c r="${addr}"${keep}>${formulaXml}<v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') return `<c r="${addr}"${keep} t="b">${formulaXml}<v>${value ? 1 : 0}</v></c>`;
  if (typeof value === 'object' && value.error) return `<c r="${addr}"${keep} t="e">${formulaXml}<v>${encodeXml(value.error)}</v></c>`;
  if (formulaXml) return `<c r="${addr}"${keep} t="str">${formulaXml}<v>${encodeXml(value)}</v></c>`;
  return `<c r="${addr}"${keep} t="inlineStr"><is><t xml:space="preserve">${encodeXml(value)}</t></is></c>`;
}

function patchSheet(xml, sheet) {
  const pending = new Map(sheet.changes);
  if (!pending.size) return xml;
  const styleOf = new Map([...xml.matchAll(CELL)].map(m => [m[1], attr(m[2], 's')]));
  let out = xml.replace(CELL, (whole, addr, attrs, inner = '') => {
    if (!pending.has(addr)) return whole;
    const change = pending.get(addr); pending.delete(addr);
    const fm = /<f[^>]*?(?:\/>|>[\s\S]*?<\/f>)/.exec(inner);
    return cellXml(addr, attrs, fm ? fm[0] : '', change.value);
  });
  if (!pending.size) return out;
  // Celdas nuevas: se insertan en su fila respetando el orden de columnas.
  const byRow = new Map();
  for (const [addr, change] of pending) {
    const { r, c } = splitAddr(addr);
    if (!byRow.has(r)) byRow.set(r, []);
    const style = change.styleFrom ? styleOf.get(change.styleFrom) : undefined;
    byRow.get(r).push({ c, xml: cellXml(addr, style ? ` s="${style}"` : '', '', change.value) });
  }
  out = out.replace(/<row r="(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, (whole, rowNumber, attrs, inner = '') => {
    const added = byRow.get(+rowNumber);
    if (!added) return whole;
    byRow.delete(+rowNumber);
    const existing = [...inner.matchAll(CELL)].map(m => ({ c: splitAddr(m[1]).c, xml: m[0] }));
    const merged = [...existing, ...added].sort((a, b) => a.c - b.c).map(x => x.xml).join('');
    return `<row r="${rowNumber}"${attrs.replace(/\s+spans="[^"]*"/, '')}>${merged}</row>`;
  });
  if (byRow.size) {
    const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]);
    out = out.replace(/<sheetData>([\s\S]*?)<\/sheetData>|<sheetData\/>/, (whole, inner = '') => {
      const existing = [...inner.matchAll(/<row r="(\d+)"[\s\S]*?(?:<\/row>|\/>)/g)].map(m => ({ r: +m[1], xml: m[0] }));
      const created = rows.map(([r, cells]) => ({ r, xml: `<row r="${r}">${cells.sort((a, b) => a.c - b.c).map(x => x.xml).join('')}</row>` }));
      return `<sheetData>${[...existing, ...created].sort((a, b) => a.r - b.r).map(x => x.xml).join('')}</sheetData>`;
    });
  }
  return out;
}

// Actualiza los valores guardados de los vínculos externos para que Excel muestre
// lo mismo aunque no actualice los vínculos al abrir.
function patchExternal(xml, external, lookup) {
  return xml.replace(/<sheetData sheetId="(\d+)"(?:\/>|>([\s\S]*?)<\/sheetData>)/g, (whole, sheetId, inner) => {
    if (!inner) return whole;
    const sheetName = external.sheetNames[+sheetId];
    const replaced = inner.replace(/<cell r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/cell>)/g, (cellWhole, addr) => {
      const value = lookup(external.file, sheetName, addr);
      if (value === undefined) return cellWhole;
      if (value === null || value === '') return `<cell r="${addr}"/>`;
      if (typeof value === 'number') return `<cell r="${addr}"><v>${Number.isFinite(value) ? value : 0}</v></cell>`;
      if (typeof value === 'object' && value.error) return `<cell r="${addr}" t="e"><v>${encodeXml(value.error)}</v></cell>`;
      if (typeof value === 'boolean') return `<cell r="${addr}" t="b"><v>${value ? 1 : 0}</v></cell>`;
      return `<cell r="${addr}" t="str"><v>${encodeXml(value)}</v></cell>`;
    });
    return `<sheetData sheetId="${sheetId}">${replaced}</sheetData>`;
  });
}

async function writeBook(book, lookup) {
  for (const sheet of book.sheets) {
    if (!sheet.changes.size) continue;
    const xml = await book.zip.file(sheet.part).async('string');
    book.zip.file(sheet.part, patchSheet(xml, sheet));
  }
  for (const external of book.externals) {
    const xml = await book.zip.file(external.part).async('string');
    book.zip.file(external.part, patchExternal(xml, external, lookup));
    // Vínculos relativos: los 11 archivos funcionan juntos en cualquier carpeta.
    const rels = book.zip.file(external.relsPart);
    if (rels) {
      const relsXml = await rels.async('string');
      book.zip.file(external.relsPart, relsXml.replace(/Target="([^"]*)"/g, (m, target) => `Target="${encodeXml(target.split(/[\\/]/).pop())}"`));
    }
  }
  const workbookXml = await book.zip.file('xl/workbook.xml').async('string');
  // Excel vuelve a calcular todo al abrir: así cualquier diferencia de redondeo se corrige sola.
  book.zip.file('xl/workbook.xml', workbookXml.replace(/<calcPr\b([^>]*?)\/>/, (m, attrs) => `<calcPr${attrs.replace(/\s+fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`));
  return book.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

module.exports = { loadBook, writeBook, setValue, current, shiftFormula, colNumber, colLetters, splitAddr, addrOf, patchSheet };
