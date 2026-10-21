const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const express = require('express');
const L = require('../src/services/capturaDiaria/xlsxLibro');
const { createEngine } = require('../src/services/capturaDiaria/formulas');
const R = require('../src/services/capturaDiaria/reporteGeneral');
const G = require('../src/services/capturaDiaria/llenado');
const { createService } = require('../src/services/capturaDiaria');
const { createRouter } = require('../src/routes/ventasGas.routes');

const plantillas = G.TEMPLATE_DIR;
const sinPlantillas = !Object.values(G.FILES).every(f => fs.existsSync(path.join(plantillas, f)));

async function smallBook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Datos');
  ws.getCell('A1').value = 2; ws.getCell('A2').value = 3; ws.getCell('B1').value = 10;
  ws.getCell('A3').value = { formula: 'SUM(A1:A2)', result: 5 };
  ws.getCell('B3').value = { formula: '+A3*B1-1', result: 49 };
  ws.getCell('C1').value = 'texto';
  ws.getCell('C1').font = { bold: true };
  const other = wb.addWorksheet('Otra hoja');
  other.getCell('A1').value = { formula: "+'Datos'!B3/7", result: 7 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('desplaza fórmulas compartidas sin tocar lo absoluto ni los nombres de hoja', () => {
  assert.equal(L.shiftFormula("+'VENTAS TOTALES'!B49+$C$2", 1, 2), "+'VENTAS TOTALES'!D50+$C$2");
  assert.equal(L.shiftFormula('SUM(C5:AG5)', 3, 0), 'SUM(C8:AG8)');
  assert.equal(L.shiftFormula("+'[1]CAMION PULPERIAS'!D5", 0, 1), "+'[1]CAMION PULPERIAS'!E5");
});

test('calcula SUM, aritmética y referencias entre hojas; escribe solo valores', async () => {
  const book = await L.loadBook(await smallBook(), 'prueba.xlsx');
  const datos = book.sheet('Datos');
  L.setValue(datos, 'A2', 13);
  L.setValue(datos, 'D9', 4, { styleFrom: 'C1' }); // celda nueva
  const engine = createEngine(new Map([[book.name, book]]));
  assert.equal(engine.value(book, 'Datos', 'A3'), 15);
  assert.equal(engine.value(book, 'Datos', 'B3'), 149);
  assert.ok(Math.abs(engine.value(book, 'Otra hoja', 'A1') - 149 / 7) < 1e-12);
  assert.throws(() => L.setValue(datos, 'A3', 1), /fórmula/);
  for (const sheet of book.sheets) for (const cell of sheet.cells.values()) if (cell.formula) L.setValue(sheet, cell.addr, engine.value(book, sheet.name, cell.addr), { overwriteFormula: true });
  const out = XLSX.read(await L.writeBook(book, () => undefined), { type: 'buffer', cellFormula: true, cellStyles: true });
  assert.equal(out.Sheets.Datos.A2.v, 13);
  assert.equal(out.Sheets.Datos.A3.v, 15);
  assert.equal(out.Sheets.Datos.A3.f, 'SUM(A1:A2)');
  assert.equal(out.Sheets.Datos.D9.v, 4);
  assert.equal(out.Sheets.Datos.C1.v, 'texto');
});

function reportBuffer(rows) {
  const header = ['No Documento', 'Nombre Cliente', 'Nombre Comercial', 'Identificacion', 'Fecha', 'Mes', 'Año', 'Ruta', 'Unidad Negocio', 'Canal', 'Clasificacioncartera', 'Clasificacioncontabilidad', 'Forma Pago', 'Total General', 'Total Descuentos', 'Total Cilindros', 'Total Litros', 'Total Kilos', 'BRUTO', 'PRECIO'];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows.map(r => [r.doc, 'Cliente', r.commercial || 'Comercio', '1', r.fecha || '20/10/2026', '010-Octubre', 2026, `Ruta ${r.route}`, r.unit, 'Pulperias', 'Cilindros', r.conta, r.pago, r.gross - (r.discount || 0), r.discount || 0, 1, r.kg / 0.54, r.kg, r.gross, 0])]), '20 - 10');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test('lee el Reporte General y asigna cada unidad a su captura', () => {
  const rep = R.parseReport(reportBuffer([
    { doc: 1, unit: 'Planta Cartago Gas Tomza', conta: 'PULPERIAS', pago: 'CONTADO', gross: 1000, kg: 2, route: 5 },
    { doc: 2, unit: 'CEDI Nicoya', conta: 'PULPERIAS', pago: 'CRÉDITO', gross: 500, discount: 20, kg: 1, route: 406 },
    { doc: 3, unit: 'CEDI Pérez Zeledón', conta: 'CARBURACION', pago: 'CRÉDITO', gross: 900, kg: 3, route: 8007, commercial: 'TROVA TARCOLES' },
    { doc: 4, unit: 'Planta Alajuela Súper Gas', conta: 'DISTRIBUIDOR PLANTA', pago: 'CONTADO', gross: 100, kg: 1, route: 603 },
  ]), 'r.xlsx');
  assert.deepEqual(rep.days, ['2026-10-20']);
  assert.deepEqual(rep.rows.map(r => [r.capture, r.category, r.payment]), [['GT', 'PULPERIAS', 'CONTADO'], ['LIB', 'PULPERIAS', 'CREDITO'], ['ZS', 'CARBURACION', 'CREDITO'], ['SG', 'PLANTADIST', 'CONTADO']]);
  const s = G.summarizeDay(rep.rows);
  assert.equal(s.cuadro['LIB|PULPERIAS|CREDITO'].discount, 20);
  assert.equal(s.detail.find(d => d.category === 'CARBURACION').name, 'TROVA TARCOLES');
});

test('rechaza unidades, clasificaciones o importes que no cuadran', () => {
  assert.throws(() => R.parseReport(reportBuffer([{ doc: 1, unit: 'Planta Marte', conta: 'PULPERIAS', pago: 'CONTADO', gross: 1, kg: 1, route: 1 }]), 'r.xlsx'), /no tiene captura asignada/);
  assert.throws(() => R.parseReport(reportBuffer([{ doc: 1, unit: 'CEDI Atlántico', conta: 'OTRA', pago: 'CONTADO', gross: 1, kg: 1, route: 1 }]), 'r.xlsx'), /sin equivalente/);
  assert.throws(() => R.parseReport(reportBuffer([{ doc: 1, unit: 'CEDI Atlántico', conta: 'GRANEL', pago: 'CHEQUE', gross: 1, kg: 1, route: 1 }]), 'r.xlsx'), /forma de pago/);
});

test('rutas de captura diaria: solo ADMIN', async () => {
  const fake = { vista: async () => ({ month: '2026-10', months: ['2026-10'], days: [], revision: 0, plantillas: { ready: true, required: [], present: [] } }) };
  const app = express();
  app.set('views', path.join(__dirname, '../src/views')); app.set('view engine', 'ejs');
  app.use(express.json({ limit: '10mb' }));
  app.use((req, _res, next) => { const role = req.get('x-role'); req.session = role ? { user: { id: 1, rol: role }, csrfToken: 't' } : {}; next(); });
  app.use(createRouter({ fileStore: { load: async () => ({ records: [], references: [], portfolios: [], files: [] }) }, diaria: fake }));
  const server = app.listen(0); const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(url + '/captura-diaria/api', { redirect: 'manual' })).status, 302);
    assert.equal((await fetch(url + '/captura-diaria/api', { headers: { 'x-role': 'TALLER' } })).status, 403);
    const page = await fetch(url + '/captura-diaria', { headers: { 'x-role': 'ADMIN' } });
    assert.equal(page.status, 200); assert.match(await page.text(), /Captura diaria automática/);
    const bad = await fetch(url + '/captura-diaria/importar', { method: 'POST', headers: { 'x-role': 'ADMIN', 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [] }) });
    assert.equal(bad.status, 400);
  } finally { server.close(); }
});

test('llena las 11 capturas con el Reporte General y cuadra cada captura', { skip: sinPlantillas && 'Plantillas privadas no incluidas en el repositorio' }, async () => {
  const rows = [
    { doc: 1, unit: 'Planta Cartago Gas Tomza', conta: 'PULPERIAS', pago: 'CONTADO', gross: 50000, kg: 100, route: 1 },
    { doc: 2, unit: 'Planta Cartago Gas Tomza', conta: 'CARBURACION', pago: 'CRÉDITO', gross: 300000, discount: 3000, kg: 800, route: 8017, commercial: 'Gasolinera Servi Indoor Curridabat' },
    { doc: 3, unit: 'CEDI Pérez Zeledón', conta: 'GRANEL', pago: 'CONTADO', gross: 20000, kg: 50, route: 3005 },
    { doc: 4, unit: 'Planta Alajuela Súper Gas', conta: 'PULPERIAS', pago: 'CRÉDITO', gross: 9000, kg: 20, route: 617 },
  ];
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'captura-diaria-'));
  try {
    const service = createService({ store: require('../src/services/capturaDiaria/estado').createStore(root), templateRoot: path.join(root, 'plantillas') });
    const { month } = await service.importar([{ filename: 'Reporte general.xlsx', buffer: reportBuffer(rows) }], 'prueba', 0);
    await service.guardarCobranza('2026-10-20', { GT: 1234.5 }, 'prueba', 1);
    const { result } = await service.descargar(month);
    assert.deepEqual(result.warnings, []);
    const day = result.summary.days.find(d => d.day === '2026-10-20');
    assert.ok(Math.abs(day.kg - 970) < 1e-6);
    assert.ok(Math.abs(day.contado + day.credito - 379000) < 1e-6);
    assert.equal(day.cobranzaGT, 1234.5);
    for (const c of day.captures) if (c.expected !== null) assert.ok(Math.abs(c.kg - c.expected) < 1e-6, c.name);
    assert.ok(result.notes.some(n => n.includes('617')));
    assert.equal(result.files.length, 11);
    const gt = XLSX.read(result.files.find(f => f.filename === G.FILES.GT).buffer, { type: 'buffer', cellFormula: true });
    assert.equal(gt.Sheets['CAMION PULPERIAS'].W5.v, 100); // ruta 1, día 20
    assert.equal(gt.Sheets['VENTAS TOTALES'].U95.v, 1234.5);
    assert.match(gt.Sheets['VENTAS TOTALES'].U34.f, /Cuadro de Ventas/);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});
