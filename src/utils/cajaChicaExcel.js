const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const EMPRESA_GAS_TOMZA = "GAS TOMZA";
const EMPRESA_SUPER_GAS = "SUPER GAS";
const DENOMINACIONES = [20000, 10000, 5000, 2000, 1000, 500, 100, 50, 25, 10, 5];
const COLOR_AZUL = "123B80";
const COLOR_AZUL_CLARO = "DCE6F1";
const COLOR_BORDE = "94A3B8";
const COLOR_TEXTO = "0F172A";
const FORMATO_MONEDA = '"₡"#,##0.00;[Red]-"₡"#,##0.00';

function numero(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fechaExcel(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
}

function fechaArchivo(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "caja_chica";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function bordeCompleto() {
  const side = { style: "thin", color: { argb: `FF${COLOR_BORDE}` } };
  return { top: side, left: side, bottom: side, right: side };
}

function aplicarEncabezado(cell) {
  cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLOR_AZUL}` } };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.border = bordeCompleto();
}

function aplicarCeldaDato(cell, columnNumber) {
  cell.font = { name: "Arial", size: 10, color: { argb: `FF${COLOR_TEXTO}` } };
  cell.alignment = {
    horizontal: columnNumber === 7 ? "right" : columnNumber === 4 ? "left" : "center",
    vertical: "middle",
    wrapText: columnNumber !== 7
  };
  cell.border = bordeCompleto();
  if (columnNumber === 1) cell.numFmt = "dd/mm/yyyy";
  if ([2, 3, 5].includes(columnNumber)) cell.numFmt = "@";
  if (columnNumber === 7) cell.numFmt = FORMATO_MONEDA;
}

function aplicarFilaDetalle(worksheet, rowNumber, { bold = false, fill = null } = {}) {
  for (let column = 3; column <= 5; column += 1) {
    const cell = worksheet.getCell(rowNumber, column);
    cell.font = { name: "Arial", size: 10, bold, color: { argb: `FF${COLOR_TEXTO}` } };
    cell.alignment = { horizontal: column === 3 ? "center" : "right", vertical: "middle" };
    cell.border = bordeCompleto();
    if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${fill}` } };
  }
  worksheet.getCell(rowNumber, 5).numFmt = FORMATO_MONEDA;
}

function cantidadesEfectivo(corte = {}) {
  let parsed = {};
  try {
    parsed = JSON.parse(corte.efectivo_json || "{}");
  } catch (_error) {
    parsed = {};
  }
  return DENOMINACIONES.reduce((result, denominacion) => {
    result[denominacion] = Math.max(0, Math.trunc(numero(parsed[denominacion])));
    return result;
  }, {});
}

function agregarLogo(workbook, worksheet, empresa) {
  const isSuper = empresa === EMPRESA_SUPER_GAS;
  const logoPath = path.join(__dirname, "..", "..", "public", "img", isSuper ? "logo_supergas.jpeg" : "logo_tomza.jpg");
  if (!fs.existsSync(logoPath)) return;

  const imageId = workbook.addImage({ filename: logoPath, extension: "jpeg" });
  worksheet.addImage(imageId, {
    tl: { col: 0.12, row: 0.12 },
    ext: { width: isSuper ? 115 : 135, height: isSuper ? 48 : 43 }
  });
}

async function crearLibroCajaChica({ empresa, corte, documentos = [] }) {
  const empresaNormalizada = empresa === EMPRESA_SUPER_GAS ? EMPRESA_SUPER_GAS : EMPRESA_GAS_TOMZA;
  const documentosEmpresa = documentos.filter(documento => documento.empresa === empresaNormalizada);
  const totalGas = numero(corte.total_gas_tomza);
  const totalSuper = numero(corte.total_super_gas);
  const totalEmpresa = empresaNormalizada === EMPRESA_SUPER_GAS ? totalSuper : totalGas;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sistema de Mantenimiento Gas Tomza";
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet(fechaArchivo(corte.fecha), {
    views: [{ showGridLines: false }],
    pageSetup: {
      orientation: "portrait",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.35, right: 0.35, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 }
    }
  });

  worksheet.columns = [
    { key: "fecha", width: 14 },
    { key: "cuenta", width: 18 },
    { key: "factura", width: 18 },
    { key: "proveedor", width: 39 },
    { key: "unidad", width: 16 },
    { key: "concepto", width: 18 },
    { key: "monto", width: 18 },
    { key: "tipo", width: 18 }
  ];

  worksheet.getRow(1).height = 30;
  worksheet.getRow(2).height = 18;
  worksheet.mergeCells("C1:H2");
  const titleCell = worksheet.getCell("C1");
  titleCell.value = `Reintegro de Caja Chica - ${empresaNormalizada === EMPRESA_SUPER_GAS ? "Súper Gas" : "Gas Tomza"}`;
  titleCell.font = { name: "Arial", size: 16, bold: true, color: { argb: `FF${COLOR_AZUL}` } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  agregarLogo(workbook, worksheet, empresaNormalizada);

  const headers = ["Fecha", "Cuenta Contable", "N° Factura", "Proveedor", "Unidad", "Concepto", "Monto Neto", "Tipo Factura"];
  headers.forEach((header, index) => {
    const cell = worksheet.getCell(3, index + 1);
    cell.value = header;
    aplicarEncabezado(cell);
  });
  worksheet.getRow(3).height = 28;

  let rowNumber = 4;
  documentosEmpresa.forEach(documento => {
    const values = [
      fechaExcel(documento.fecha),
      documento.cuenta_contable || null,
      String(documento.numero_factura || ""),
      documento.proveedor || "",
      documento.unidad || "-",
      documento.concepto || "REPUESTOS",
      numero(documento.monto),
      documento.tipo_factura || "ELECTRONICA"
    ];
    const row = worksheet.getRow(rowNumber);
    values.forEach((value, index) => {
      const cell = row.getCell(index + 1);
      cell.value = value;
      aplicarCeldaDato(cell, index + 1);
    });
    row.height = Math.max(30, ...values.map((value, index) => index === 0 || index === 6 ? 0 :
      Math.ceil(String(value).length / (worksheet.columns[index].width - 3)) * 14 + 4));
    rowNumber += 1;
  });

  const firstDocumentRow = 4;
  const lastDocumentRow = Math.max(firstDocumentRow, rowNumber - 1);
  const totalRow = rowNumber;
  worksheet.mergeCells(`A${totalRow}:F${totalRow}`);
  worksheet.getCell(`A${totalRow}`).value = "TOTAL A REINTEGRAR";
  worksheet.getCell(`A${totalRow}`).font = { name: "Arial", size: 11, bold: true, color: { argb: `FF${COLOR_TEXTO}` } };
  worksheet.getCell(`A${totalRow}`).alignment = { horizontal: "right", vertical: "middle" };
  worksheet.getCell(`G${totalRow}`).value = documentosEmpresa.length
    ? { formula: `SUM(G${firstDocumentRow}:G${lastDocumentRow})`, result: totalEmpresa }
    : totalEmpresa;
  worksheet.getCell(`G${totalRow}`).numFmt = FORMATO_MONEDA;
  for (let column = 1; column <= 8; column += 1) {
    const cell = worksheet.getCell(totalRow, column);
    cell.font = { name: "Arial", size: 11, bold: true, color: { argb: `FF${COLOR_TEXTO}` } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLOR_AZUL_CLARO}` } };
    cell.border = bordeCompleto();
  }
  worksheet.getRow(totalRow).height = 22;

  const signatureRow = totalRow + 3;
  worksheet.mergeCells(`A${signatureRow}:D${signatureRow}`);
  worksheet.mergeCells(`F${signatureRow}:H${signatureRow}`);
  worksheet.getCell(`A${signatureRow}`).value = "Firma Encargado Caja Chica";
  worksheet.getCell(`F${signatureRow}`).value = "Firma Autorizado";
  [worksheet.getCell(`A${signatureRow}`), worksheet.getCell(`F${signatureRow}`)].forEach(cell => {
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: `FF${COLOR_TEXTO}` } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { top: { style: "thin", color: { argb: COLOR_TEXTO } } };
  });
  worksheet.getRow(signatureRow).height = 24;

  const detailTitleRow = signatureRow + 2;
  worksheet.mergeCells(`C${detailTitleRow}:E${detailTitleRow}`);
  worksheet.getCell(`C${detailTitleRow}`).value = "DETALLE CAJA";
  worksheet.getCell(`C${detailTitleRow}`).font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getCell(`C${detailTitleRow}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLOR_AZUL}` } };
  worksheet.getCell(`C${detailTitleRow}`).alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getCell(`C${detailTitleRow}`).border = bordeCompleto();

  const detailHeaderRow = detailTitleRow + 2;
  worksheet.getCell(`C${detailHeaderRow}`).value = "Denominación";
  worksheet.getCell(`D${detailHeaderRow}`).value = "Cantidad";
  worksheet.getCell(`E${detailHeaderRow}`).value = "Total";
  aplicarFilaDetalle(worksheet, detailHeaderRow, { bold: true, fill: COLOR_AZUL_CLARO });

  let detailRow = detailHeaderRow + 1;
  const vales = empresaNormalizada === EMPRESA_GAS_TOMZA ? numero(corte.vales_total) : 0;
  worksheet.getCell(`C${detailRow}`).value = "Vales";
  worksheet.getCell(`E${detailRow}`).value = vales;
  aplicarFilaDetalle(worksheet, detailRow, { bold: true });
  const firstDetailValueRow = detailRow;
  detailRow += 1;

  if (empresaNormalizada === EMPRESA_GAS_TOMZA) {
    worksheet.getCell(`C${detailRow}`).value = "Facturas";
    worksheet.getCell(`E${detailRow}`).value = { formula: `G${totalRow}`, result: totalGas };
    aplicarFilaDetalle(worksheet, detailRow, { bold: true });
    detailRow += 1;
    worksheet.getCell(`C${detailRow}`).value = "Facturas envasadora";
    worksheet.getCell(`E${detailRow}`).value = totalSuper;
    aplicarFilaDetalle(worksheet, detailRow, { bold: true });
    detailRow += 1;
  } else {
    worksheet.getCell(`C${detailRow}`).value = "Facturas";
    worksheet.getCell(`E${detailRow}`).value = { formula: `G${totalRow}`, result: totalSuper };
    aplicarFilaDetalle(worksheet, detailRow, { bold: true });
    detailRow += 1;
  }

  const efectivo = cantidadesEfectivo(empresaNormalizada === EMPRESA_GAS_TOMZA ? corte : {});
  DENOMINACIONES.forEach(denominacion => {
    const cantidad = efectivo[denominacion] || 0;
    worksheet.getCell(`C${detailRow}`).value = denominacion;
    worksheet.getCell(`C${detailRow}`).numFmt = "#,##0";
    worksheet.getCell(`D${detailRow}`).value = cantidad;
    worksheet.getCell(`D${detailRow}`).numFmt = "#,##0";
    worksheet.getCell(`E${detailRow}`).value = {
      formula: `C${detailRow}*D${detailRow}`,
      result: denominacion * cantidad
    };
    aplicarFilaDetalle(worksheet, detailRow);
    detailRow += 1;
  });

  const totalCajaRow = detailRow;
  worksheet.mergeCells(`C${totalCajaRow}:D${totalCajaRow}`);
  worksheet.getCell(`C${totalCajaRow}`).value = "TOTAL EN CAJA CHICA";
  const totalCaja = vales + (empresaNormalizada === EMPRESA_GAS_TOMZA ? totalGas + totalSuper : totalSuper) +
    DENOMINACIONES.reduce((sum, denominacion) => sum + (denominacion * efectivo[denominacion]), 0);
  worksheet.getCell(`E${totalCajaRow}`).value = {
    formula: `SUM(E${firstDetailValueRow}:E${totalCajaRow - 1})`,
    result: Math.round(totalCaja * 100) / 100
  };
  aplicarFilaDetalle(worksheet, totalCajaRow, { bold: true, fill: COLOR_AZUL_CLARO });
  detailRow += 2;

  if (empresaNormalizada === EMPRESA_GAS_TOMZA) {
    const baseCajaRow = detailRow;
    worksheet.mergeCells(`C${baseCajaRow}:D${baseCajaRow}`);
    worksheet.getCell(`C${baseCajaRow}`).value = "BASE CAJA CHICA";
    worksheet.getCell(`E${baseCajaRow}`).value = numero(corte.base_caja);
    aplicarFilaDetalle(worksheet, baseCajaRow, { bold: true });
    detailRow += 2;

    const diferenciaRow = detailRow;
    worksheet.mergeCells(`C${diferenciaRow}:D${diferenciaRow}`);
    worksheet.getCell(`C${diferenciaRow}`).value = "DIFERENCIA";
    worksheet.getCell(`E${diferenciaRow}`).value = {
      formula: `E${baseCajaRow}-E${totalCajaRow}`,
      result: Math.round((numero(corte.base_caja) - totalCaja) * 100) / 100
    };
    aplicarFilaDetalle(worksheet, diferenciaRow, { bold: true, fill: COLOR_AZUL_CLARO });
    detailRow += 1;
  }

  worksheet.pageSetup.printArea = `A1:H${detailRow}`;
  worksheet.headerFooter.oddFooter = "Generado por el sistema de mantenimiento Gas Tomza";

  return workbook;
}

module.exports = {
  crearLibroCajaChica,
  fechaArchivo,
  EMPRESA_GAS_TOMZA,
  EMPRESA_SUPER_GAS,
  DENOMINACIONES
};
