const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const a = require('../src/utils/aresep');
const { generarExcel } = require('../src/utils/aresepExcel');
const { crearHarness } = require('./helpers/aresepHarness');
const unidad = { id: 1, placa: 'C164528' };

test('Campos y catálogos de las plantillas', () => {
  assert.equal(a.campos('unidades').length, 12);
  assert.equal(a.campos('operacion').length, 52);
  assert.equal(a.campos('operacion').find(f => f.id === 'depreciacion_mensual').label, 'Depreciación mensual (CRC)');
  assert.ok(a.secciones.operacion.columns.includes('depreciacion_mensual'));
  assert.deepEqual(Object.keys(a.tipos), ['1', '2', '3', '4']);
  assert.deepEqual(Object.keys(a.mediciones), ['1', '2', '3']);
  assert.equal(a.campos('operacion').find(f => f.id === 'costo_peaje').id, 'costo_peaje');
  assert.equal(a.mostrar('unidades', 'anio', 2016), '2016');
});
test('Roles y protección de planillas', () => {
  assert.equal(a.permitidas({ rol: 'ADMIN' }).length, 5);
  assert.equal(a.permitidas({ rol: 'CONTABILIDAD' }).length, 5);
  assert.equal(a.permitidas({ rol: 'TRAMITES' }).includes('planilla'), false);
  for (const rol of ['MECANICO', 'BODEGUERO', 'SUPERVISOR']) assert.equal(a.permitidas({ rol }).length, 0);
  assert.equal(a.permitidas({ rol: 'ADMIN', usuario: 'mecanico_rio_claro' }).length, 0);
});
test('Períodos, fechas reales y pertenencia al mes', () => {
  for (const p of ['2026-00', '2026-13', '26-09', '', ['2026-09']]) assert.equal(a.periodoValido(p), false);
  assert.throws(() => a.validar('rutas', { sede: 'Cartago', fecha: '2026-02-30', bodega: 'A', producto: 'B' }, '2026-02'), /fecha inválida/);
  assert.throws(() => a.validar('rutas', { sede: 'Cartago', fecha: '2026-08-01', bodega: 'A', producto: 'B' }, '2026-09'), /mes seleccionado/);
});
test('No inventa campos pendientes ni altera la placa desde el formulario', () => {
  const d = a.validar('unidades', { placa: 'OTRA' }, '2026-09', unidad);
  assert.equal(d.placa, unidad.placa);
  assert.equal(d.potencia, null);
  assert.equal(d.tipo_transporte, null);
  assert.equal(a.pendientes('unidades', d).length, 10);
  assert.throws(() => a.validar('unidades', {}, '2026-09'), /unidad registrada/);
  assert.throws(() => a.validar('unidades', { tipo_transporte: '99' }, '2026-09', unidad), /opción inválida/);
});
test('Distingue cero de pendiente y rechaza importes inválidos', () => {
  const d = a.validar('ventas', { sede: 'Cartago', litros: '0', ruta: '0,00' }, '2026-09');
  assert.equal(d.litros, 0);
  assert.equal(d.planta, null);
  assert.equal(a.derivados('ventas', d).diferencia, null);
  for (const value of ['-1', 'NaN', 'Infinity', '1e5', '1.000,00', '12.345', '999999999999999']) assert.throws(() => a.validar('ventas', { sede: 'Cartago', litros: value }, '2026-09'));
  assert.throws(() => a.validar('unidades', { llantas: '2.5' }, '2026-09', unidad), /fuera de rango/);
});
test('Planilla utiliza la tasa ingresada, sin la tasa fija del ejemplo', () => {
  const d = a.validar('planilla', { sede: 'Cartago', nombre: 'Prueba', identificacion: '001', salario_reportado: '1000', salario_base: '900', comision: '100', tasa_ccss: '10' }, '2026-09');
  assert.deepEqual(a.derivados('planilla', d), { base_comision: 1000, ccss: 100, neto: 900 });
  assert.equal(a.derivados('planilla', { ...d, tasa_ccss: null }).neto, null);
  assert.throws(() => a.validar('planilla', { ...d, dias_laborados: 30, dias_incapacidad: 1 }, '2026-09'), /días del mes/);
});
test('Identidad normalizada impide duplicados de ruta, persona y unidad', () => {
  assert.equal(a.clave('operacion', { ruta: ' Río  Claro ' }, 1), a.clave('operacion', { ruta: 'rio claro' }, 1));
  assert.notEqual(a.clave('operacion', { ruta: 'A' }, 1), a.clave('operacion', { ruta: 'B' }, 1));
  assert.notEqual(a.clave('unidades', {}, 1), a.clave('unidades', {}, 2));
  assert.notEqual(a.clave('ventas', { sede: 'Cartago' }), a.clave('ventas', { sede: 'Nicoya' }));
  assert.notEqual(a.clave('rutas', { sede: 'Cartago', fecha: '2026-09-01', bodega: 'Ruta 1', producto: 'Cil25' }),
    a.clave('rutas', { sede: 'Nicoya', fecha: '2026-09-01', bodega: 'Ruta 1', producto: 'Cil25' }));
  assert.equal(a.sedeRegistro({ seccion: 'unidades', datos: { almacenamiento: 'Cartago' } }), 'Cartago');
  assert.equal(a.sedeRegistro({ seccion: 'operacion', unidad_id: 1, datos: {} }, new Map([[1, 'Guapiles']])), 'Guapiles');
});
test('Excel A7 mantiene plantilla, códigos y datos de cada columna', async () => {
  const d = a.validar('unidades', { activo: '0001', almacenamiento: 'Cartago', codigo_cr: 'CR-01', tipo_transporte: '3', medicion: '2', serie_medidor: '00007', marca: 'Hino', peso_maximo: '5000.50', potencia: '200', llantas: '6', anio: '2016' }, '2026-09', unidad);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await generarExcel('a7', '2026-09', [{ seccion: 'unidades', datos: d, version: 1 }], true));
  assert.deepEqual(wb.worksheets.map(s => s.name), ['Transportes', 'Plantilla', 'Tipo transporte', 'Medición', 'Control']);
  const s = wb.getWorksheet('Plantilla');
  assert.equal(s.getCell('A2').value, '0001');
  assert.equal(s.getCell('D2').value, 'C164528');
  assert.equal(s.getCell('E2').value, 3);
  assert.equal(s.getCell('G2').value, '00007');
  assert.equal(s.getCell('L2').value, 2016);
  assert.equal(wb.getWorksheet('Control').getCell('C4').value, 'Completo');
});
test('Excel de costos no conserva datos de ejemplo y calcula sólo datos conocidos', async () => {
  const op = a.validar('operacion', { ruta: 'Prueba', marchamo: '200', costo_peaje: '100', depreciacion_mensual: '250000' }, '2026-09', unidad);
  const rows = [{ seccion: 'operacion', datos: op, version: 1 },
    { seccion: 'ventas', datos: { sede: 'Cartago', litros: 100, ruta: 70, planta: 30 }, version: 1 },
    { seccion: 'planilla', datos: { nombre: '=HYPERLINK("bad")', identificacion: '001', salario_base: 100, comision: 0, salario_reportado: 100, tasa_ccss: 5 }, version: 1 }];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await generarExcel('costos', '2026-09', rows, true));
  const opSheet = wb.getWorksheet('Datos operacion');
  assert.equal(opSheet.getCell('A9').value, null);
  assert.equal(opSheet.getCell('AU8').value, 100);
  assert.equal(opSheet.getCell('AV8').value, 200);
  assert.equal(opSheet.getCell('AV7').value, 'Monto Marchamo 2026');
  assert.equal(opSheet.getCell('AZ7').value, 'Depreciación mensual (CRC)');
  assert.equal(opSheet.getCell('AZ8').value, 250000);
  const p = wb.getWorksheet('Planilla 1 mes');
  assert.equal(p.getCell('A3').value, '=HYPERLINK("bad")');
  assert.equal(p.getCell('H3').result, 5);
  assert.match(p.getCell('H3').formula, /M3/);
  assert.equal(p.getCell('H4').value, null);
  const v = wb.getWorksheet('LITROS VENDIDOS periodo');
  assert.equal(v.getCell('F8').result, 0.7);
  assert.equal(v.getCell('E8').result || 0, 0);
  assert.match(v.getCell('B20').formula, /B8:B19/);
  assert.equal(wb.getWorksheet('Litros por ruta').getCell('B5').value, null);
});
test('Exportación de trámites no filtra datos confidenciales por otra hoja', async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await generarExcel('costos', '2026-09', [{ seccion: 'planilla', datos: { nombre: 'CONFIDENCIAL' }, version: 1 }], false));
  assert.equal(wb.getWorksheet('Planilla 1 mes'), undefined);
  assert.equal(wb.getWorksheet('Control').rowCount, 3);
});
test('Rutas HTTP: permisos, CSRF, alta, edición, mes, duplicados y auditoría atómica', async t => {
  const { app, db } = crearHarness();
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/aresep`;
  const get = (p = '', headers = {}) => fetch(base + p, { headers, redirect: 'manual' });
  const post = (p, data, headers = {}) => fetch(base + p, { method: 'POST', headers, redirect: 'manual', body: new URLSearchParams({ _csrf: 'test-csrf', ...data }) });
  try {
    await t.test('Acceso y CSRF', async () => {
      assert.equal((await get('', { 'x-test-role': 'ANON' })).status, 302);
      assert.equal((await get('', { 'x-test-role': 'MECANICO' })).status, 403);
      assert.equal((await get('?seccion=planilla', { 'x-test-role': 'TRAMITES' })).status, 403);
      assert.equal((await post('/nuevo?seccion=ventas', { _csrf: '' })).status, 403);
      assert.equal((await get('?periodo=2026-15')).status, 400);
      assert.equal(db.rows.length, 0);
    });
    await t.test('Incorporar sin sobrescribir ni duplicar fichas existentes', async () => {
      assert.equal((await post('/incorporar-unidades?periodo=2026-09', {})).status, 302);
      assert.equal(db.rows.length, 2);
      assert.equal(db.history.length, 2);
      assert.equal((await post('/incorporar-unidades?periodo=2026-09', {})).status, 302);
      assert.equal(db.rows.length, 2);
      assert.equal(db.history.length, 2);
      assert.match(await (await get('?periodo=2026-09')).text(), /C164528/);
      assert.doesNotMatch(await (await get('?periodo=2026-10')).text(), /C164528/);
    });
    await t.test('Filtro por sede afecta filas, apartados, descargas e importación', async () => {
      const html = await (await get('?periodo=2026-09&sede=Cartago')).text();
      assert.match(html, /C164528/);
      assert.doesNotMatch(html, /C178652/);
      assert.match(html, /seccion=operacion&amp;sede=Cartago/);
      const form = await (await get('/nuevo?periodo=2026-09&seccion=operacion&sede=Cartago')).text();
      assert.match(form, /C164528/);
      assert.doesNotMatch(form, /C178652/);
      const exportado = await get('/exportar/a7?periodo=2026-09&sede=Cartago');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await exportado.arrayBuffer());
      assert.equal(wb.getWorksheet('Plantilla').getCell('D2').value, 'C164528');
      assert.equal(wb.getWorksheet('Plantilla').getCell('D3').value, null);
      assert.equal(wb.getWorksheet('Control').getCell('F4').value, 'Cartago');
      assert.equal((await post('/incorporar-unidades?periodo=2026-10&sede=Cartago', {})).status, 302);
      assert.equal(db.rows.filter(r => r.periodo === '2026-10' && r.seccion === 'unidades').length, 1);
    });
    await t.test('Edición y protección contra versiones obsoletas', async () => {
      const historyBefore = db.history.length;
      assert.equal((await post('/registro/1', { version: 1, activo: '001', placa: 'BAD' })).status, 302);
      assert.equal(JSON.parse(db.rows[0].datos).placa, 'C164528');
      assert.equal(db.rows[0].version, 2);
      assert.equal((await post('/registro/1', { version: 1, activo: '002' })).status, 409);
      assert.equal(db.rows[0].version, 2);
      assert.equal(db.history.length, historyBefore + 1);
    });
    await t.test('Alta de operación, duplicados, campos inválidos y salida escapada', async () => {
      const data = { unidad_id: 1, ruta: '<script>alert(1)</script>', km_mes: '100,50' };
      assert.equal((await post('/nuevo?periodo=2026-09&seccion=operacion', data)).status, 302);
      assert.equal((await post('/nuevo?periodo=2026-09&seccion=operacion', data)).status, 400);
      assert.equal((await post('/nuevo?periodo=2026-09&seccion=operacion', { ...data, ruta: 'B', km_mes: '-1' })).status, 400);
      const html = await (await get('?periodo=2026-09&seccion=operacion')).text();
      assert.doesNotMatch(html, /<script>alert/);
      assert.match(html, /&lt;script&gt;/);
    });
    await t.test('Planilla privada incluso con ID o exportación directos', async () => {
      assert.equal((await post('/nuevo?periodo=2026-09&seccion=planilla', { sede: 'Cartago', nombre: 'Persona Privada', identificacion: '001' })).status, 302);
      const id = db.rows.find(r => r.seccion === 'planilla').id;
      assert.equal((await get(`/registro/${id}`, { 'x-test-role': 'TRAMITES' })).status, 404);
      assert.equal((await post(`/registro/${id}`, { version: 1 }, { 'x-test-role': 'TRAMITES' })).status, 404);
      const response = await get('/exportar/costos?periodo=2026-09', { 'x-test-role': 'TRAMITES' });
      assert.equal(response.status, 200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await response.arrayBuffer());
      assert.equal(wb.getWorksheet('Planilla 1 mes'), undefined);
    });
    await t.test('Litros vendidos admiten registros y exportaciones independientes por sede', async () => {
      for (const [sede, litros] of [['Cartago', 100], ['Guapiles', 50]]) {
        assert.equal((await post('/nuevo?periodo=2026-09&seccion=ventas&sede=' + sede, { sede, litros })).status, 302);
      }
      assert.equal(db.rows.filter(r => r.seccion === 'ventas').length, 2);
      const listado = await (await get('?periodo=2026-09&seccion=ventas&sede=Guapiles')).text();
      assert.match(listado, /Guapiles/);
      assert.match(listado, /50/);
      assert.doesNotMatch(listado, />100</);
      const response = await get('/exportar/costos?periodo=2026-09&sede=Guapiles');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await response.arrayBuffer());
      assert.equal(wb.getWorksheet('LITROS VENDIDOS periodo').getCell('B8').value, 50);
      assert.equal(wb.getWorksheet('LITROS VENDIDOS periodo').getCell('B9').value, null);
      assert.equal(wb.getWorksheet('Control').getCell('F4').value, 'Guapiles');
    });
    await t.test('Rollback completo cuando falla el historial', async () => {
      const count = db.rows.length;
      db.failAudit = true;
      assert.equal((await post('/nuevo?periodo=2026-09&seccion=ventas', { sede: 'La Cruz', litros: '100' })).status, 500);
      db.failAudit = false;
      assert.equal(db.rows.length, count);
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
