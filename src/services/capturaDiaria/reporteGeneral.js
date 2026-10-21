// Lee el "Reporte general" (una fila por factura) y lo deja listo para llenar las capturas.
const XLSX = require('xlsx');

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = v => clean(v).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
const fail = message => Object.assign(new Error(message), { status: 400 });

// Unidad de negocio del reporte -> captura donde se registra.
const UNIDADES = [
  ['GT', ['CARTAGO', 'GASTOMZA']],
  ['SG', ['ALAJUELA', 'SUPERGAS']],
  ['LIB', ['LACRUZ', 'NICOYA', 'LIBERIA']],
  ['ATL', ['ATLANTICO', 'GUAPILES', 'LIMON']],
  ['ZS', ['ZONASUR', 'PEREZZELEDON']],
  ['SC', ['SANCARLOS']],
  ['PAC', ['PACIFICO', 'OROTINA', 'PUNTARENAS']],
];
function captureFor(unit) {
  const text = norm(unit);
  const found = UNIDADES.find(([, words]) => words.some(w => text.includes(w)));
  return found ? found[0] : null;
}

// Clasificación contable del reporte -> categoría de la captura.
const CATEGORIAS = {
  PULPERIAS: 'PULPERIAS', DISTRIBUIDOR: 'DISTRIBUIDOR', DISTRIBUIDORPLANTA: 'PLANTADIST', PLANTADISTRIBUIDOR: 'PLANTADIST',
  PLANTA: 'PLANTA', VIP: 'VIP', CAMIONCF: 'VIP', GRANEL: 'GRANEL', GRANGRANEL: 'GRANGRANEL', GRANELPETRO: 'GRANELPETRO',
  CARBURACION: 'CARBURACION', CARBURACIONCOMERCIAL: 'CARBCOM', TIENDAS: 'TIENDAS', AGENCIAS: 'TIENDAS',
  MINIPLANTA: 'MINIPLANTA', DISTRIBUIDORMINIPLANTA: 'MINIPLANTA',
};

function date(value) {
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value);
    return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null;
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/.exec(clean(value));
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return /^20\d{2}-\d{2}-\d{2}$/.test(clean(value)) ? clean(value) : null;
}
const routeNumber = v => { const m = /(\d+)/.exec(clean(v)); return m ? String(+m[1]) : ''; };

const REQUIRED = ['NODOCUMENTO', 'FECHA', 'UNIDADNEGOCIO', 'CLASIFICACIONCONTABILIDAD', 'FORMAPAGO', 'TOTALGENERAL', 'TOTALDESCUENTOS', 'TOTALKILOS', 'BRUTO'];

function isReport(workbook) {
  return workbook.SheetNames.some(name => headerRow(workbook.Sheets[name]) !== null);
}
function headerRow(sheet) {
  if (!sheet?.['!ref']) return null;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  for (let r = range.s.r; r <= Math.min(range.s.r + 10, range.e.r); r++) {
    const names = [];
    for (let c = range.s.c; c <= range.e.c; c++) names.push(norm(sheet[XLSX.utils.encode_cell({ r, c })]?.v));
    if (REQUIRED.every(n => names.includes(n))) return { r, names, range };
  }
  return null;
}

function parseReport(buffer, filename) {
  let workbook;
  try { workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false }); } catch { throw fail(`${filename}: no se pudo leer el Excel.`); }
  const rows = [];
  const seen = new Set();
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const header = headerRow(sheet);
    if (!header) continue;
    const col = n => header.names.indexOf(n);
    const get = (r, n) => col(n) < 0 ? undefined : sheet[XLSX.utils.encode_cell({ r, c: header.range.s.c + col(n) })]?.v;
    for (let r = header.r + 1; r <= header.range.e.r; r++) {
      const doc = clean(get(r, 'NODOCUMENTO'));
      if (!doc) continue;
      const where = `${sheetName}, fila ${r + 1}`;
      const day = date(get(r, 'FECHA'));
      if (!day) throw fail(`${where}: fecha inválida.`);
      const unit = clean(get(r, 'UNIDADNEGOCIO'));
      const capture = captureFor(unit);
      if (!capture) throw fail(`${where}: la unidad de negocio "${unit}" no tiene captura asignada.`);
      const conta = norm(get(r, 'CLASIFICACIONCONTABILIDAD'));
      const category = CATEGORIAS[conta];
      if (!category) throw fail(`${where}: clasificación contable "${clean(get(r, 'CLASIFICACIONCONTABILIDAD'))}" sin equivalente en la captura.`);
      const pay = norm(get(r, 'FORMAPAGO'));
      const payment = pay === 'CONTADO' ? 'CONTADO' : ['CREDITO', 'CRDITO'].includes(pay) ? 'CREDITO' : null;
      if (!payment) throw fail(`${where}: forma de pago "${clean(get(r, 'FORMAPAGO'))}" sin reconocer.`);
      const num = n => { const v = get(r, n); if (typeof v !== 'number' || !Number.isFinite(v)) throw fail(`${where}: ${n} no es un número.`); return v; };
      const gross = num('BRUTO'), discount = num('TOTALDESCUENTOS'), net = num('TOTALGENERAL'), kg = num('TOTALKILOS');
      if (Math.abs(gross - discount - net) > 0.05) throw fail(`${where}: bruto menos descuento no coincide con Total General.`);
      const key = `${day}|${norm(unit)}|${doc}`;
      if (seen.has(key)) throw fail(`${where}: el documento ${doc} está repetido.`);
      seen.add(key);
      rows.push({
        day, doc, unit, capture, category, payment, gross, discount, net, kg,
        route: routeNumber(get(r, 'RUTA')),
        client: clean(get(r, 'NOMBRECLIENTE')), commercial: clean(get(r, 'NOMBRECOMERCIAL')),
        sheet: sheetName, row: r + 1,
      });
    }
  }
  if (!rows.length) throw fail(`${filename}: no se encontraron facturas en el formato del Reporte General.`);
  return { filename, days: [...new Set(rows.map(r => r.day))].sort(), rows };
}

module.exports = { parseReport, isReport, captureFor, norm, clean, CATEGORIAS };
