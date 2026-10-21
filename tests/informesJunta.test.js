const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { ensureCsrfToken } = require('../src/middleware/security');
const { importWorkbook, importWorkbooks, summarize, validateParams, demoData, createStore, exportExcel, exportPowerPoint } = require('../src/services/informesJunta');
const { createRouter } = require('../src/routes/informesJunta.routes');
const templates = require('../src/services/informesJuntaPlantillas');

async function source(rows, months = ['2026-08', '2026-09']) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('G');
  sheet.addRow(['CODIGO', 'NOMBRE_COMERCIAL', 'GRUPO', 'DIVISION', 'CANAL', ...months]);
  rows.forEach(row => sheet.addRow(row)); return Buffer.from(await book.xlsx.writeBuffer());
}

test('importa Libro1 y calcula variaciones, ceros y devoluciones sin doble conteo', async () => {
  const buffer = await source([
    [1, 'Cliente A', 'Granel', 'Cartago', 'Horeca', 100.1, 150.2],
    [2, 'Cliente B', 'Granel', 'Cartago', 'Industria', 0, 20.3],
    [3, 'Cliente C', 'Granel', 'Alajuela', 'Horeca', 40, 0],
    [4, 'Cliente D', 'Granel', 'Alajuela', 'Horeca', -5, -2]
  ]);
  const data = await importWorkbook(buffer, 'Libro1.xlsx');
  const params = validateParams({ period: '2026-09', days: 26, target: 200, reference: 160 }, data);
  const s = summarize(data, params);
  assert.equal(s.total, 168.5); assert.equal(s.prior, 135.1); assert.equal(s.difference, 33.4);
  assert.equal(s.referenceDifference, 8.5); assert.equal(s.targetDifference, -31.5);
  assert.equal(s.withoutPrevious, 1); assert.equal(s.withoutCurrent, 1); assert.equal(s.active, 2);
  assert.equal(s.breakdown.canal.find(item => item.name === 'Horeca').current, 148.2);
});

test('conserva claves repetidas y rechaza archivos inválidos, números como texto y encabezados mensuales repetidos', async () => {
  const row = [1, 'Cliente', 'Granel', 'Cartago', 'Horeca', 1, 2];
  await assert.rejects(importWorkbook(Buffer.from('abc'), 'archivo.xlsx'), /No se pudo leer/);
  await assert.rejects(importWorkbook(await source([row]), 'archivo.xls'), /\.xlsx/);
  const repeated = await importWorkbook(await source([row, row]), 'archivo.xlsx');
  assert.equal(repeated.repeatedKeys, 1); assert.equal(repeated.records.length, 2);
  assert.equal(summarize(repeated, validateParams({ period: '2026-09' }, repeated)).total, 4);
  await assert.rejects(importWorkbook(await source([[1, 'Cliente', 'Granel', 'Cartago', 'Horeca', 1, '2.000,50']]), 'archivo.xlsx'), /número válido/);
  await assert.rejects(importWorkbook(await source([row], ['2026-09', '2026-09']), 'archivo.xlsx'), /únicas/);
  await assert.rejects(importWorkbook(await source([[1, 'Cliente', 'Granel', '', 'Horeca', 1, 2]]), 'archivo.xlsx'), /faltan/);
});

test('distingue base faltante, base cero y celdas vacías; valida parámetros', async () => {
  const data = await importWorkbook(await source([[1, 'Cliente', 'Granel', 'Cartago', 'Horeca', null, 10]]), 'archivo.xlsx');
  const params = validateParams({ period: '2026-09' }, data);
  const s = summarize(data, params);
  assert.equal(data.emptyAmounts, 1); assert.equal(s.prior, 0); assert.equal(s.percent, null); assert.equal(s.daily, null);
  const first = summarize(data, { ...params, period: '2026-08' });
  assert.equal(first.hasPrevious, false); assert.equal(first.prior, null);
  assert.throws(() => validateParams({ period: '2026-10' }, data), /disponible/);
  assert.throws(() => validateParams({ period: '2026-09', days: 0 }, data), /días/);
  assert.throws(() => validateParams({ period: '2026-09', target: 'abc' }, data), /Meta/);
});

test('Libro2 importa todas las hojas, conserva CC y canales vacíos y se consolida con Libro1', async () => {
  const book = new ExcelJS.Workbook();
  const headers = ['CODIGO', 'NOMBRE_COMERCIAL', 'GRUPO', 'DIVISION', 'CANAL', 'CC', '2026-08', '2026-09'];
  const pulperias = book.addWorksheet('Pulperias'); pulperias.addRow(headers);
  pulperias.addRow([1, 'Cliente P', 'Walmart', 'Cartago', '\u00a0', 'PULPERIAS', 100, 200]);
  const distributors = book.addWorksheet('Dist'); distributors.addRow(headers);
  distributors.addRow([2, 'Cliente D', 'Distribuidores', 'Alajuela', 'Horeca', 'DISTRIBUIDOR', 300, 400]);
  distributors.addRow([3, 'Cliente DP', 'Distribuidores', 'Alajuela', 'Industria', 'DISTRIBUIDOR PLANTA', 30, 40]);
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  const single = await importWorkbook(buffer, 'Libro2.xlsx');
  assert.equal(single.records.length, 3); assert.equal(single.sources.length, 2); assert.equal(single.unclassifiedChannels, 1);
  assert.equal(single.records[0].cc, 'PULPERIAS'); assert.equal(single.records[0].canal, 'Sin clasificación');
  assert.equal(single.records[1].sourceSheet, 'Dist');
  const files = [{ filename: 'Libro2.xlsx', buffer }, { filename: 'Libro1.xlsx', buffer: await source([[10, 'Granel A', 'Granel', 'Cartago', 'Horeca', 50, 60]]) }];
  const merged = await importWorkbooks(files);
  assert.equal(merged.records.length, 4); assert.equal(merged.sources.length, 3);
  const summary = summarize(merged, validateParams({ period: '2026-09' }, merged)); assert.equal(summary.total, 700);
  assert.equal(summary.breakdown.cc.find(c => c.name === 'PULPERIAS').current, 200);
  const mapped = await templates.suggestions({ data: merged });
  assert.equal(mapped.length, 6);
  assert.equal(mapped.find(item => item.key.endsWith(':I18')).value, 200);
  assert.equal(mapped.find(item => item.key.endsWith(':E18')).value, 440);
  await assert.rejects(importWorkbooks([files[0], files[0]]), /más de una vez/);
  await assert.rejects(importWorkbooks([files[0], { filename: 'otro.xlsx', buffer: await source([[4, 'Otro', 'Granel', 'Cartago', 'Horeca', 1]], ['2026-07']) }]), /mismos meses/);
});

test('el modo de copia sin relleno conserva los archivos originales byte por byte', async () => {
  const data = demoData(), params = validateParams({ title: 'Prueba <editable>', period: '2026-09', days: 26, target: 4500, notes: 'Observación de prueba' }, data);
  const report = { data, params };
  assert.deepEqual(await templates.exportTemplate(report,'xlsx',{automatic:false}), await templates.template('xlsx'));
  assert.deepEqual(await templates.exportTemplate(report,'pptx',{automatic:false}), await templates.template('pptx'));
  const manifest = await templates.manifest(); assert.equal(manifest.sheets.length, 43); assert.equal(manifest.slides.length, 29);
});

test('cambia solo nodos de texto y celdas elegidos, conservando todos los estilos y objetos', async () => {
  const manifest = await templates.manifest(), data = demoData(), params = validateParams({ period: '2026-09' }, data);
  const sheet = manifest.sheets.find(s => s.name === 'Base de Datos Ventas');
  const templateEdits = await templates.validateEdits({ cells: { [`${sheet.id}:Q18`]: 4300 }, texts: { '1:0': 'OCTUBRE 2026 & $prueba' }, images: {} });
  const report = { data, params, templateEdits };
  for (const [ext, allowed] of [['xlsx', [sheet.zipPath, 'xl/workbook.xml']], ['pptx', ['ppt/slides/slide1.xml']]]) {
    const original = await JSZip.loadAsync(await templates.template(ext));
    const output = await JSZip.loadAsync(await templates.exportTemplate(report, ext,{automatic:false}));
    assert.deepEqual(Object.keys(output.files).sort(), Object.keys(original.files).sort());
    for (const file of Object.keys(original.files)) {
      if (allowed.includes(file) || original.files[file].dir) continue;
      assert.deepEqual(await output.file(file).async('nodebuffer'), await original.file(file).async('nodebuffer'), file);
    }
    if (ext === 'xlsx') {
      const before = await original.file(sheet.zipPath).async('string'), after = await output.file(sheet.zipPath).async('string');
      const originalCell = before.match(/<c\b[^>]*\br="Q18"[^>]*>[\s\S]*?<\/c>/)[0];
      assert.equal(after, before.replace(originalCell, originalCell.replace(/<v>[^<]*<\/v>/, '<v>4300</v>')));
      const book = new ExcelJS.Workbook(); await book.xlsx.load(await templates.exportTemplate(report, 'xlsx',{automatic:false}));
      assert.equal(book.getWorksheet('Base de Datos Ventas').getCell('Q18').value, 4300);
    } else {
      const before = await original.file('ppt/slides/slide1.xml').async('string'), after = await output.file('ppt/slides/slide1.xml').async('string');
      assert.match(after, /OCTUBRE 2026 &amp; \$prueba/);
      assert.equal(after.replace(/<a:t>OCTUBRE[\s\S]*?<\/a:t>/, '<a:t>SETIEMBRE 2026</a:t>'), before);
    }
  }
  const suggestions = await templates.suggestions(report); assert.equal(suggestions.length, 2); assert.equal(suggestions[1].value, 4300);
});

test('reemplaza el PNG de datos sin alterar la diapositiva, rechaza dimensiones y destinos inválidos', async () => {
  const image = (await templates.manifest()).slides.find(s => s.number === 12).images[0];
  const buffer = await templates.originalImage(image.name);
  const edits = await templates.validateEdits({ images: { [image.name]: buffer.toString('base64') } });
  const original = await JSZip.loadAsync(await templates.template('pptx'));
  const result = await JSZip.loadAsync(await templates.exportTemplate({ templateEdits: edits }, 'pptx'));
  for (const file of Object.keys(original.files).filter(file => !original.files[file].dir)) assert.deepEqual(await result.file(file).async('nodebuffer'), await original.file(file).async('nodebuffer'), file);
  const bad = Buffer.from(buffer); bad.writeUInt32BE(image.width + 1, 16);
  await assert.rejects(templates.validateEdits({ images: { [image.name]: bad.toString('base64') } }), /exactamente/);
  await assert.rejects(templates.validateEdits({ cells: { '1:ZZ99999': 1 } }), /Celda/);
  await assert.rejects(templates.validateEdits({ texts: { '99:0': 'texto' } }), /Texto/);
  await assert.rejects(templates.validateEdits({ images: { 'image1.png': buffer.toString('base64') } }), /Imagen/);
});

test('persiste por usuario, reabre informes y rechaza ediciones simultáneas obsoletas', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'informes-junta-'));
  try {
    const store = createStore(root), created = await store.create(1, demoData());
    assert.equal((await createStore(root).get(1, created.id)).revision, 1);
    await assert.rejects(store.get(2, created.id), error => error.status === 404);
    const updates = await Promise.allSettled([
      store.update(1, created.id, 1, { ...created.params, notes: 'Primera edición' }),
      store.update(1, created.id, 1, { ...created.params, notes: 'Edición obsoleta' })
    ]);
    assert.equal(updates[0].status, 'fulfilled'); assert.equal(updates[1].reason.status, 409);
    assert.equal((await store.get(1, created.id)).params.notes, 'Primera edición');
    assert.equal((await store.list(1)).length, 1);
    await assert.rejects(store.get(1, '../../archivo'), /inválido/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

async function withServer(user, run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'informes-junta-routes-'));
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '../src/views'));
  app.use(express.json({ limit: '10mb' }));
  app.use((req, _res, next) => { req.session = { user, csrfToken: 'test-token' }; next(); });
  app.use(ensureCsrfToken); app.use('/admin/informes-junta', createRouter({ store: createStore(root) }));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  try { await run(`http://127.0.0.1:${server.address().port}/admin/informes-junta`); }
  finally { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); }
}

test('rutas requieren ADMIN y CSRF; carga, edición, historial y descargas funcionan', async () => {
  await withServer(null, async base => assert.equal((await fetch(base + '/api/informes')).status, 401));
  await withServer({ id: 2, rol: 'CONTABILIDAD' }, async base => assert.equal((await fetch(base + '/api/informes')).status, 403));
  await withServer({ id: 1, rol: 'ADMIN', usuario: '<admin>' }, async base => {
    const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /&lt;admin&gt;/);
    const csrfRejected = await fetch(base + '/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(csrfRejected.status, 403);
    const createdResponse = await fetch(base + '/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'test-token' }, body: '{}' });
    assert.equal(createdResponse.status, 201); const created = await createdResponse.json();
    assert.equal(created.data.demo, true); assert.match(created.scope, /PARCIAL/);
    const saved = await fetch(base + '/api/informes/' + created.id, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'test-token' }, body: JSON.stringify({ revision: 1, params: { ...created.params, unit: 'Kilos', days: 26, notes: 'Editado' } }) });
    assert.equal(saved.status, 200); assert.equal((await saved.json()).revision, 2);
    const history = await (await fetch(base + '/api/informes')).json(); assert.equal(history.length, 1);
    const templateManifest = await (await fetch(base + '/api/plantillas')).json();
    assert.equal(templateManifest.slides.length, 29);
    const templateSaved = await fetch(base + '/api/informes/' + created.id + '/plantilla', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'test-token' }, body: JSON.stringify({ revision: 2, edits: { texts: { '1:0': 'PRUEBA 2026' }, cells: {}, images: {} } }) });
    assert.equal(templateSaved.status, 200); assert.equal((await templateSaved.json()).revision, 3);
    for (const ext of ['xlsx', 'pptx']) {
      const response = await fetch(base + '/api/informes/' + created.id + '/descargar.' + ext);
      assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
      assert.match(response.headers.get('content-disposition'), new RegExp(`v3\\.${ext}`));
      const zip = await JSZip.loadAsync(await response.arrayBuffer()); assert.ok(zip.file('[Content_Types].xml'));
    }
    const invalid = await fetch(base + '/api/importar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'test-token' }, body: JSON.stringify({ filename: 'bad.xlsx', content: 'abc' }) }); assert.equal(invalid.status, 400);
  });
});
