const ExcelJS = require('exceljs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createModel, NA, isError, colName } = require('./informesJuntaCalculos');
const ROOT = path.join(__dirname, '../templates/informes-junta');
let originalBook;
async function workbook() {
  originalBook ||= (async () => { const book = new ExcelJS.Workbook(); await book.xlsx.load(await fs.readFile(path.join(ROOT, 'informe-original.xlsx'))); return book; })();
  return originalBook;
}
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_\s]+/g, ' ').trim().toUpperCase();
const TYPES = [
  { key: 'dist', label: 'Distribuidores', cc: ['DISTRIBUIDOR', 'DISTRIBUIDOR PLANTA'], group: ['DISTRIBUIDORES'], column: 'E', current: 'E', sheet: 'Productividad Histórica Distrib', thresholds: [10000, 5000], rows: [7, 9, 11], daysRow: 24 },
  { key: 'pulperias', label: 'Pulperías', cc: ['PULPERIAS'], group: ['PULPERIAS'], column: 'I', current: 'I', sheet: 'Productividad Histórica Tomza P', thresholds: [10000, 5000], rows: [7, 9, 11], daysRow: 24 },
  { key: 'granel', label: 'Granel', cc: ['GRANEL'], group: ['GRANEL'], column: 'Q', current: 'L', sheet: 'Productividad Histórica G', thresholds: [25000, 10000, 5000], rows: [8, 10, 12, 14], daysRow: 27 },
  { key: 'granGranel', label: 'Gran Granel', cc: ['GRAN GRANEL', 'GRANGRANEL'], group: ['GRAN GRANEL', 'GRANGRANEL'], column: 'R', current: 'M', sheet: 'Productividad Histórica GG', thresholds: [50000], rows: [7, 9], daysRow: 22 },
  { key: 'carburacion', label: 'Carburación', cc: ['CARBURACION'], group: ['CARBURACION'], column: 'S', current: 'N', sheet: 'Productividad Histórica Carbura', thresholds: [50000, 25000, 10000, 5000], rows: [7, 9, 11, 13, 15], daysRow: 28 }
];
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
function dateLabel(period) { const [year, month] = period.split('-').map(Number); return `${MONTHS[month - 1]} ${year}`; }
function periodAt(index) { const date = new Date(Date.UTC(2025, 8 + index, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`; }
function category(record) {
  const cc = normalize(record.cc), group = normalize(record.grupo);
  return TYPES.find(type => cc ? type.cc.includes(cc) : type.group.includes(group));
}
function buckets(records, month, type) {
  const clients = new Map();
  for (const record of records) clients.set(record.codigo, (clients.get(record.codigo) || 0) + Math.round(record.values[month] * 100));
  const result = type.rows.map(() => ({ total: 0, clients: 0 }));
  for (const cents of clients.values()) {
    const index = type.thresholds.findIndex(min => cents >= min * 100);
    const bucket = result[index < 0 ? result.length - 1 : index]; bucket.total += cents;
    if (cents > 0) bucket.clients++;
  }
  return result.map(bucket => ({ ...bucket, total: bucket.total / 100 }));
}
async function buildAutomatic(report, manualEdits = report.templateEdits || {}) {
  const book = await workbook(), overrides = new Map(), pending = [], filled = [], warnings = [];
  const set = (sheet, cell, value) => overrides.set(`${sheet}!${cell}`, value);
  const period = report.params.period;
  const rowsByType = new Map(TYPES.map(type => [type.key, report.data.records.filter(record => category(record)?.key === type.key)]));
  const supported = Array.from({ length: 13 }, (_, i) => periodAt(i));
  const usableMonths = report.data.months.filter(month => supported.includes(month));
  if (!supported.includes(period)) throw Object.assign(new Error('Esta plantilla original cubre septiembre 2025 a septiembre 2026. El período seleccionado requiere vincular una plantilla de ese cierre.'), { status: 400 });
  if (usableMonths.length !== report.data.months.length) warnings.push('Los meses fuera de septiembre 2025 a septiembre 2026 no caben en las columnas de esta plantilla.');
  for (const type of TYPES) {
    const records = rowsByType.get(type.key), present = records.length > 0;
    (present ? filled : pending).push(type.label);
    for (const month of usableMonths) {
      const index = supported.indexOf(month), row = 6 + index, column = colName(5 + index);
      const total = present ? records.reduce((sum, record) => sum + Math.round(record.values[month] * 100), 0) / 100 : NA;
      set('Base de Datos Ventas', type.column + row, total);
      const values = present ? buckets(records, month, type) : null;
      if (type.key === 'granel' && present) {
        const clients = new Map(); for (const record of records) clients.set(record.codigo, (clients.get(record.codigo) || 0) + record.values[month]);
        if ([...clients.values()].some(value => value >= 50000)) throw Object.assign(new Error('Hay clientes de Granel con 50.000 kilos o más. La tabla original oculta ese tramo; se debe definir su clasificación antes de generar para no omitirlos.'), { status: 400 });
      }
      type.rows.forEach((number, i) => { set(type.sheet, column + number, values ? values[i].total : NA); set(type.sheet, column + (number + 1), values ? values[i].clients : NA); });
      if (month === period && report.params.days != null) set(type.sheet, column + type.daysRow, report.params.days);
      // The original blank franchise / own-store columns are zero. Never reuse a
      // nonzero current-period template input as if it came from an uploaded file.
      for (const extra of ['F', 'H']) {
        if (Number(book.getWorksheet('Base de Datos Ventas').getCell(extra + row).value || 0) !== 0) set('Base de Datos Ventas', extra + row, NA);
      }
    }
  }
  const applyManual = () => {
    for (const [key, value] of Object.entries(manualEdits.cells || {})) {
      const [sheetId, address] = key.split(':'), sheet = book.worksheets.find(s => String(s.id) === sheetId);
      if (sheet) set(sheet.name, address, value);
    }
  };
  applyManual();
  const source = createModel(book, overrides);
  for (const month of usableMonths) {
    const row = 6 + supported.indexOf(month);
    const total = source.get('Base de Datos Ventas', 'M' + row).value;
    const [year, number] = month.split('-').map(Number);
    if (year === 2026) set('Histórico de Venta Total', 'I' + (4 + number), total);
  }
  const currentRow = 6 + supported.indexOf(period), currentModel = createModel(book, overrides);
  for (const type of TYPES) set('Por canal', type.current + '8', currentModel.get('Base de Datos Ventas', type.column + currentRow).value);
  for (const [dest, sourceColumn] of [['F', 'F'], ['H', 'H']]) set('Por canal', dest + '8', currentModel.get('Base de Datos Ventas', sourceColumn + currentRow).value ?? 0);
  set('Venta Total', 'E7', currentModel.get('Base de Datos Ventas', 'M' + currentRow).value);
  set('Venta Total', 'C7', dateLabel(period));
  if (report.params.target != null) { set('Venta Total', 'E10', report.params.target); set('Histórico de Venta Total', 'J' + (4 + Number(period.slice(5))), report.params.target); }
  const days = report.params.days ?? book.getWorksheet('Base de Datos Ventas').getCell('A' + (23 + supported.indexOf(period))).value;
  if (typeof days === 'number') set('Promedio Diario', 'A7', days);
  const [year, month] = period.split('-').map(Number);
  const previous = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  set('Promedio Diario', 'C16', dateLabel(previous));
  // Replace this cached cross-sheet formula with the correct prior month value;
  // the original reference points permanently at August.
  if (year === 2026 && month > 1) set('Promedio Diario', 'E16', (() => {
    const prior = createModel(book, overrides).get('Histórico de Venta Total', 'I' + (3 + month)).value;
    const index = supported.indexOf(previous), divisor = book.getWorksheet('Base de Datos Ventas').getCell('A' + (23 + index)).value;
    return isError(prior) ? prior : typeof divisor === 'number' && divisor > 0 ? prior / divisor : NA;
  })());
  applyManual();
  const previousIndex = supported.indexOf(previous), previousDays = previousIndex >= 0 ? book.getWorksheet('Base de Datos Ventas').getCell('A' + (23 + previousIndex)).value : null;
  if (typeof previousDays === 'number') set('Promedio Diario', 'A16', previousDays);
  const model = createModel(book, overrides);
  const entries = model.entries();
  if (pending.length) warnings.push(`Faltan ${pending.join(', ')}. Sus cifras actuales y los totales que dependen de ellas se marcan Pendiente; no se completan con números viejos.`);
  const unknown = report.data.records.filter(record => !category(record)).length;
  if (unknown) warnings.push(`${unknown} registros no tienen un CC vinculado a los canales de la plantilla.`);
  const formulas = new Map();
  if (year === 2026 && month > 1) formulas.set('Promedio Diario!E16', `+'Histórico de Venta Total'!I${3 + month}/'Promedio Diario'!A16`);
  return { model, entries, formulas, period, filled, pending, warnings, days,
    coverage: { filled, pending: [...pending, 'Participación de mercado', 'Ingresos y egresos', 'Nómina', 'Presupuesto', 'Impuestos', 'Inversiones', 'Cartera', 'Estado de resultados'], warnings, changedCells: entries.length, sourceFiles: [...new Set(report.data.records.map(r => r.sourceFile || report.data.filename))], days } };
}

function definitions() {
  const blocks = [];
  const add = (slide, image, sheet, cells) => blocks.push({ slide, image, sheet, cells });
  const grid = (columns, bounds, rows) => rows.flatMap(([number, top, bottom]) => columns.map((column, i) => ({ address: `${column}${number}`, x: bounds[i], y: top, w: bounds[i + 1] - bounds[i], h: bottom - top })));
  const histColumns = Array.from({ length: 13 }, (_, i) => colName(i + 5));
  add(12, 'image14.png', 'Productividad Histórica G', grid(histColumns, [178,287,396,505,614,725,834,943,1052,1161,1270,1379,1488,1597], [[8,67,112],[9,112,148],[10,148,193],[11,193,229],[12,229,274],[13,274,310],[14,310,355],[15,355,391],[18,399,448],[22,457,487],[23,487,517],[24,517,547]]));
  add(15, 'image17.png', 'Productividad Histórica Distrib', grid(histColumns, [211,324,422,520,618,716,814,912,1010,1108,1206,1304,1402,1500], [[7,73,117],[8,117,161],[9,161,205],[10,205,249],[11,249,293],[12,293,337],[15,349,392],[19,405,433],[20,433,461],[21,461,489]]));
  add(16, 'image18.png', 'Productividad Histórica Tomza P', grid(histColumns, [208,317,426,535,644,753,862,971,1080,1189,1298,1407,1516,1625], [[7,72,119],[8,119,166],[9,166,213],[10,213,260],[11,260,307],[12,307,354],[15,363,412],[19,424,452],[20,452,480],[21,480,508]]));
  add(13, 'image15.png', 'Productividad Histórica GG', grid(histColumns, [162,243,324,403,482,563,642,710,789,870,951,1032,1113,1185], [[7,83,130],[8,130,177],[9,177,224],[10,224,271],[14,283,332],[18,345,370],[19,370,395],[20,395,420]]));
  add(14, 'image16.png', 'Productividad Histórica Carbura', grid(histColumns, [181,293,405,517,629,741,853,965,1077,1189,1301,1413,1525,1637], [[7,59,99],[8,99,139],[9,139,179],[10,179,219],[11,219,253],[12,253,287],[13,287,321],[14,321,355],[15,355,389],[16,389,423],[19,441,476],[23,490,520],[24,520,550],[25,550,580]]));
  add(10, 'image12.png', 'Por canal', grid(['G','J','K','L','M','N','O'], [191,307,421,532,647,771,922,1022], [[8,80,135],[26,385,435],[28,435,485],[30,485,535]]));
  const direct = [];
  for (let row = 6; row <= 18; row++) for (const [column, left, right] of [['E',135,221],['F',221,303],['H',314,402],['I',402,485],['K',496,600]]) direct.push({ address: column + row, x: left, y: 70 + (row - 6) * 35, w: right - left, h: 35 });
  add(11, 'image13.png', 'Venta Directa en Envasado', direct);
  add(2, 'image3.png', 'Venta Total', [
    { address:'E7',x:248,y:79,w:166,h:59 },{address:'C7',x:0,y:78,w:239,h:44},
    ...[10,12,14].flatMap((row,i)=>[{address:'G'+row,x:424,y:152+i*58,w:145,h:58},{address:'I'+row,x:579,y:152+i*58,w:90,h:58}])
  ]);
  add(4, 'image5.png', 'Promedio Diario', [
    {address:'E7',x:219,y:89,w:142,h:49},{address:'C7',x:9,y:89,w:201,h:38},
    ...[10,12,14,16].flatMap((row,i)=>[{address:'G'+row,x:369,y:150+i*48,w:140,h:48},{address:'I'+row,x:518,y:150+i*48,w:77,h:48}]),
    {address:'E16',x:219,y:294,w:142,h:48},{address:'C16',x:9,y:292,w:201,h:38}
  ]);
  const historic = [];
  for (let row = 5; row <= 16; row++) {
    historic.push({address:'I'+row,x:388,y:95+(row-5)*32,w:100,h:32});
    for (const [column,left,right] of [['N',687,777],['O',777,877],['P',877,985]]) historic.push({address:column+row,x:left,y:95+(row-5)*32,w:right-left,h:32});
  }
  for (const [row,y,h] of [[19,491,32],[22,534,32],[24,577,30]]) {
    if (row !== 24) historic.push({address:'I'+row,x:388,y,w:100,h});
    for (const [column,left,right] of [['N',687,777],['O',777,877],['P',877,985]]) historic.push({address:column+row,x:left,y,w:right-left,h});
  }
  add(3,'image4.png','Histórico de Venta Total',historic);
  return blocks;
}
function display(value, format = '') {
  if (isError(value)) return value.error === '#DIV/0!' ? '—' : 'Pendiente';
  if (value == null) return '—';
  if (typeof value !== 'number') return String(value);
  const percent = format.includes('%'), decimals = percent ? (/0\.00/.test(format) ? 2 : 0) : /0\.00/.test(format) ? 2 : 0;
  const number = (percent ? value * 100 : value).toLocaleString('en-US',{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
  const signed = /\\\+/.test(format);
  if (signed && value >= 0) return '+ ' + number + (percent ? '%' : '');
  if (signed && value < 0) return '- ' + number.slice(1) + (percent ? '%' : '');
  return number + (percent ? '%' : '');
}
async function overlays(automatic) {
  const fills = JSON.parse(await fs.readFile(path.join(ROOT,'relleno-colores.json'),'utf8'));
  const result = [];
  for (const block of definitions()) {
    const cells = [];
    const worksheet=automatic.model.book.getWorksheet(block.sheet),merges=worksheet.model.merges;
    for (const position of block.cells) {
      const evaluated = automatic.model.get(block.sheet,position.address);
      if (!evaluated.touched) continue;
      const original = worksheet.getCell(position.address), font = original.font || {};
      const merge = merges.find(range => range.split(':')[0] === position.address);
      const lastRow = merge ? Number(merge.split(':')[1].replace(/[A-Z]/g,'')) : original.row;
      let rowHeight = 0;
      for (let row = original.row; row <= lastRow; row++) rowHeight += original.worksheet.getRow(row).height || 15;
      const color = font.color?.argb?.slice(-6) || (font.color?.theme === 0 ? 'FFFFFF' : '000000');
      const numeric = typeof evaluated.value === 'number';
      cells.push({...position, text:display(evaluated.value,original.numFmt), value:evaluated.value,
        fill:fills[`${block.image}:${position.address}`] || 'FFFFFF',
        color:isError(evaluated.value) ? '68737D' : numeric && evaluated.value < 0 && /\[Red\]/i.test(original.numFmt) ? 'FF0000' : color,
        font:isError(evaluated.value) ? 'Lato' : font.name || 'Lato', bold:Boolean(font.bold), italic:Boolean(font.italic),
        fontPx:Math.min((font.size || 24) * position.h / rowHeight, isError(evaluated.value) ? (position.w-10)/4.8 : Infinity),
        align:original.alignment?.horizontal || 'left'
      });
    }
    if (cells.length) result.push({...block,cells});
  }
  return result;
}
module.exports = { buildAutomatic, definitions, overlays, display, TYPES, workbook, dateLabel };
