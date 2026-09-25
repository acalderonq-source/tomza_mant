const path = require('node:path');
const ExcelJS = require('exceljs');
const a = require('./aresep');

function limpiar(sheet, start, cols, end = sheet.rowCount) {
  for (let r = start; r <= end; r++) for (let c = 1; c <= cols; c++) sheet.getCell(r, c).value = null;
}
function fila(sheet, n, values, styleRow) {
  values.forEach((value, i) => {
    const cell = sheet.getCell(n, i + 1);
    if (styleRow && n !== styleRow) cell.style = structuredClone(sheet.getCell(styleRow, i + 1).style);
    cell.value = value ?? null;
    if (value instanceof Date) cell.numFmt = 'dd/mm/yyyy';
    else if (typeof value === 'number') cell.numFmt = '#,##0.00';
  });
}
function valor(f, d) {
  if (d[f.id] === null || d[f.id] === undefined || d[f.id] === '') return null;
  if (f.type === 'date') return new Date(`${d[f.id]}T12:00:00Z`);
  if (f.type === 'select' && /^\d+$/.test(String(d[f.id]))) return Number(d[f.id]);
  return d[f.id];
}
function formula(sheet, address, formulaText, result) {
  sheet.getCell(address).value = { formula: formulaText, result: result ?? '' };
}
async function generarExcel(tipo, periodo, rows, incluirPlanilla) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(__dirname, '../templates/aresep', `${tipo}.xlsx`));
  wb.creator = 'Tomza - ARESEP';
  wb.modified = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const registros = rows.filter(r => r.seccion !== 'planilla' || incluirPlanilla).map(a.preparar);
  const de = s => registros.filter(r => r.seccion === s);
  if (tipo === 'a7') {
    const sheet = wb.getWorksheet('Plantilla');
    limpiar(sheet, 2, 12);
    de('unidades').forEach((r, i) => {
      fila(sheet, i + 2, a.campos('unidades').map(f => valor(f, r.datos)), 2);
      for (const col of [5, 6, 11, 12]) sheet.getCell(i + 2, col).numFmt = '0';
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  } else {
    const op = wb.getWorksheet('Datos operacion');
    limpiar(op, 8, 52);
    op.getCell('AV7').value = `Monto Marchamo ${periodo.slice(0, 4)}`;
    op.getCell('AW7').value = `Monto Dekra ${periodo.slice(0, 4)}`;
    const camposOperacion = a.campos('operacion');
    const depreciacion = camposOperacion.find(f => f.id === 'depreciacion_mensual');
    const camposExcel = camposOperacion.filter(f => f.id !== 'depreciacion_mensual');
    if (depreciacion) camposExcel.push(depreciacion);
    op.getCell('AZ7').value = depreciacion?.label || 'Depreciación mensual (CRC)';
    op.getCell('AZ7').style = structuredClone(op.getCell('AY7').style);
    op.getCell('AZ8').style = structuredClone(op.getCell('AY8').style);
    op.getColumn(52).width = Math.max(op.getColumn(51).width || 18, 24);
    de('operacion').forEach((r, i) => fila(op, i + 8, camposExcel.map(f => valor(f, r.datos)), 8));
    op.views = [{ state: 'frozen', ySplit: 7, xSplit: 2 }];
    const planilla = wb.getWorksheet('Planilla 1 mes');
    if (!incluirPlanilla) wb.removeWorksheet(planilla.id);
    else {
      limpiar(planilla, 3, 13);
      planilla.getCell('H2').value = null;
      planilla.getCell('I2').value = null;
      planilla.getCell('M1').value = 'Tasa CCSS (%)';
      de('planilla').forEach((r, i) => {
        const n = i + 3, d = r.datos, v = r.valores;
        fila(planilla, n, [d.nombre, d.identificacion, d.fecha_ingreso ? new Date(`${d.fecha_ingreso}T12:00:00Z`) : null,
          d.salario_base, d.comision, null, d.salario_reportado, null, null, d.dias_laborados, d.dias_incapacidad, d.puesto, d.tasa_ccss], 3);
        formula(planilla, `F${n}`, `IF(COUNT(D${n}:E${n})<2,"",D${n}+E${n})`, v.base_comision);
        formula(planilla, `H${n}`, `IF(COUNT(G${n},M${n})<2,"",ROUND(G${n}*M${n}/100,2))`, v.ccss);
        formula(planilla, `I${n}`, `IF(COUNT(G${n}:H${n})<2,"",G${n}-H${n})`, v.neto);
      });
      planilla.views = [{ state: 'frozen', ySplit: 2 }];
    }
    const ventas = wb.getWorksheet('LITROS VENDIDOS periodo');
    limpiar(ventas, 8, 8);
    ventas.getCell('A5').value = `Periodo ${periodo}`;
    de('ventas').forEach((r, i) => {
      const n = i + 8, d = r.datos;
      fila(ventas, n, [new Date(`${periodo}-01T12:00:00Z`), d.litros, d.ruta, d.planta], 8);
      ventas.getCell(n, 1).numFmt = 'mmmm yyyy';
      formula(ventas, `E${n}`, `IF(COUNT(B${n}:D${n})<3,"",B${n}-C${n}-D${n})`, r.valores.diferencia);
      for (const [c, source, key] of [['F', 'C', 'ruta'], ['G', 'D', 'planta']]) {
        formula(ventas, `${c}${n}`, `IF(OR(COUNT(B${n},${source}${n})<2,B${n}=0),"",${source}${n}/B${n})`, d.litros && d[key] !== null ? d[key] / d.litros : null);
        ventas.getCell(`${c}${n}`).numFmt = '0.00%';
      }
    });
    const totalVentasRow = Math.max(20, de('ventas').length + 8);
    ventas.getCell(`A${totalVentasRow}`).value = 'Total del periodo';
    for (const [col, key] of [['B', 'litros'], ['C', 'ruta'], ['D', 'planta'], ['E', 'diferencia']]) {
      const values = de('ventas').map(r => r.valores[key]).filter(v => v !== null && v !== undefined);
      formula(ventas, `${col}${totalVentasRow}`, `IF(COUNT(${col}8:${col}${totalVentasRow - 1})=0,"",SUM(${col}8:${col}${totalVentasRow - 1}))`, values.length ? values.reduce((s, v) => s + v, 0) : null);
    }
    const rutas = wb.getWorksheet('Litros por ruta');
    limpiar(rutas, 5, 18);
    rutas.getCell('E2').value = 'Litros registrados; sin conversión automática de peso.';
    de('rutas').forEach((r, i) => fila(rutas, i + 5, a.campos('rutas').map(f => valor(f, r.datos)), 5));
    const totalRow = Math.max(70, de('rutas').length + 5);
    rutas.getCell(totalRow, 1).value = `Total ${periodo}`;
    for (const [col, key] of [['D', 'cilindros'], ['E', 'litros']]) {
      const values = de('rutas').map(r => r.datos[key]).filter(v => v !== null);
      formula(rutas, `${col}${totalRow}`, `IF(COUNT(${col}5:${col}${totalRow - 1})=0,"",SUM(${col}5:${col}${totalRow - 1}))`, values.length ? values.reduce((s, v) => s + v, 0) : null);
    }
    rutas.views = [{ state: 'frozen', ySplit: 4 }];
  }
  const control = wb.addWorksheet('Control');
  control.addRow(['Periodo', periodo]);
  control.addRow(['Uso', 'Control interno basado en las plantillas suministradas. Revisar antes de presentar.']);
  control.addRow(['Apartado', 'Registro', 'Estado', 'Campos pendientes', 'Versión', 'Sede']);
  registros.forEach(r => control.addRow([a.secciones[r.seccion].title,
    r.datos.placa || r.datos.nombre || r.datos.bodega || periodo,
    r.pendientes.length ? 'Pendiente' : 'Completo', r.pendientes.join(', '), r.version, a.sedeRegistro(r)]));
  control.columns = [{ width: 24 }, { width: 36 }, { width: 18 }, { width: 90 }, { width: 12 }, { width: 25 }];
  control.getRow(3).font = { bold: true };
  control.getColumn(4).alignment = { wrapText: true, vertical: 'top' };
  return wb.xlsx.writeBuffer();
}
module.exports = { generarExcel };
