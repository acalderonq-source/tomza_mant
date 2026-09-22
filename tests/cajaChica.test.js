const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { centavos, fechaValida, datosDocumento, monedaCRC } = require('../src/utils/cajaChicaValidacion');
const { crearLibroCajaChica } = require('../src/utils/cajaChicaExcel');

test('validates dates, companies, positive amounts and currency without rounding input', () => {
  assert.equal(centavos('27354.05'), 2735405);
  assert.equal(centavos('0.10') + centavos('0.20'), 30);
  for (const amount of ['', '-1', 'NaN', '1e2', '1.001', '1,000', '10000000000']) assert.throws(() => centavos(amount));
  assert.equal(fechaValida('2026-02-30'), false);
  assert.equal(fechaValida('2024-02-29'), true);
  assert.equal(monedaCRC('USD'), false);
  assert.equal(monedaCRC('CRC'), true);
  const data = { empresa: 'GAS TOMZA', fecha: '2026-09-22', monto: '0.10', proveedor: 'Proveedor', numero_factura: '00123' };
  assert.equal(datosDocumento(data).numero, '00123');
  assert.throws(() => datosDocumento({ ...data, empresa: 'OTRA' }));
  assert.throws(() => datosDocumento({ ...data, monto: '0' }));
});

const corte = { fecha: '2026-09-22', total_gas_tomza: '100.10', total_super_gas: '200.20', base_caja: '900000', vales_total: '50', efectivo_json: '{"20000":2}' };
const documentos = [
  { empresa: 'GAS TOMZA', fecha: '2026-09-21', numero_factura: '00100001010000340575', monto: '100.10', proveedor: '=NOT_A_FORMULA', concepto: 'REPUESTOS', unidad: 'C174021' },
  { empresa: 'SUPER GAS', fecha: '2026-09-22', numero_factura: '00100001010000340576', monto: '200.20', proveedor: 'Proveedor B', concepto: 'SUMINISTROS' }
];
function findRow(sheet, text) {
  let result;
  sheet.eachRow(row => { if (row.values.includes(text)) result = row.number; });
  assert.ok(result, `Missing row ${text}`);
  return result;
}

for (const empresa of ['GAS TOMZA', 'SUPER GAS']) {
  test(`exports ${empresa} separately with exact identifiers and cached formulas`, async () => {
    const generated = await crearLibroCajaChica({ empresa, corte, documentos });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await generated.xlsx.writeBuffer());
    assert.equal(workbook.worksheets.length, 1);
    const sheet = workbook.worksheets[0];
    assert.equal(sheet.name, '22-09-2026');
    const isTomza = empresa === 'GAS TOMZA';
    assert.equal(sheet.getCell('C4').value, documentos[isTomza ? 0 : 1].numero_factura);
    assert.equal(sheet.getCell('C4').type, ExcelJS.ValueType.String);
    assert.equal(sheet.getCell('D4').type, ExcelJS.ValueType.String);
    assert.equal(sheet.getCell('G5').formula, 'SUM(G4:G4)');
    assert.equal(sheet.getCell('G5').result, isTomza ? 100.1 : 200.2);
    assert.equal(sheet.getCell(`E${findRow(sheet, 'Facturas')}`).formula, 'G5');
    const total = sheet.getCell(`E${findRow(sheet, 'TOTAL EN CAJA CHICA')}`);
    assert.equal(total.result, isTomza ? 40350.3 : 200.2);
    if (isTomza) {
      assert.equal(sheet.getCell(`E${findRow(sheet, 'Facturas envasadora')}`).value, 200.2);
      assert.equal(sheet.getCell(`E${findRow(sheet, 'DIFERENCIA')}`).result, 859649.7);
    }
    assert.equal(sheet.getCell(`D${findRow(sheet, 20000)}`).value, isTomza ? 2 : 0);
  });
}

test('empty company has no circular total formula', async () => {
  const workbook = await crearLibroCajaChica({ empresa: 'SUPER GAS', corte: { ...corte, total_super_gas: 0 }, documentos: [] });
  assert.equal(workbook.worksheets[0].getCell('G4').value, 0);
});
