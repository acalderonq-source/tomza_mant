const ExcelJS = require("exceljs");
const PdfPrinter = require("pdfmake");

const printer = new PdfPrinter({
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique"
  }
});

const number = value => Number(value || 0);
const cents = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;
const money = value => number(value).toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = value => number(value).toLocaleString("es-CR", { maximumFractionDigits: 2 });

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function defaultPeriod(today) {
  const day = new Date(`${today}T12:00:00Z`);
  const start = new Date(day);
  start.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { desde: start.toISOString().slice(0, 10), hasta: end.toISOString().slice(0, 10) };
}

function reportPeriod(query, today) {
  const fallback = defaultPeriod(today);
  const desde = query.fecha_desde || fallback.desde;
  const hasta = query.fecha_hasta || fallback.hasta;
  if (!validDate(desde) || !validDate(hasta) || desde > hasta) {
    throw new Error("Seleccione un rango de fechas válido.");
  }
  return { desde, hasta };
}

function consumption(rows) {
  const details = [];
  const grouped = new Map();
  for (const row of rows) {
    const returned = row.tipo_movimiento === "DEVOLUCION";
    const count = number(row.cantidad);
    const recordedPrice = number(row.precio_unitario);
    const price = recordedPrice > 0 ? recordedPrice : number(row.precio_actual);
    const amount = cents(count * price);
    const item = {
      ...row,
      cantidad: count,
      precio: price,
      costo: amount,
      cantidad_neta: returned ? -count : count,
      costo_neto: returned ? -amount : amount,
      precio_estimado: returned && recordedPrice <= 0 && price > 0,
      sin_precio: price <= 0
    };
    details.push(item);
    const key = String(row.articulo_id);
    if (!grouped.has(key)) grouped.set(key, {
      articulo_id: row.articulo_id,
      proveedor: row.proveedor || "",
      codigo_taller: row.codigo_taller || "",
      codigo: row.codigo || "",
      nombre: row.nombre || "",
      unidad_medida: row.unidad_medida || "UND",
      precio_actual: number(row.precio_actual),
      salidas: 0, devoluciones: 0, costo_salidas: 0, costo_devoluciones: 0,
      sin_precio: false, precio_estimado: false
    });
    const total = grouped.get(key);
    if (returned) {
      total.devoluciones += count;
      total.costo_devoluciones += amount;
    } else {
      total.salidas += count;
      total.costo_salidas += amount;
    }
    total.sin_precio ||= item.sin_precio;
    total.precio_estimado ||= item.precio_estimado;
  }
  const summary = [...grouped.values()].map(item => ({
    ...item,
    cantidad_neta: cents(item.salidas - item.devoluciones),
    costo_salidas: cents(item.costo_salidas),
    costo_devoluciones: cents(item.costo_devoluciones),
    costo_neto: cents(item.costo_salidas - item.costo_devoluciones)
  })).sort((a, b) => a.proveedor.localeCompare(b.proveedor, "es") || a.nombre.localeCompare(b.nombre, "es"));
  return { details, summary, total: cents(summary.reduce((sum, item) => sum + item.costo_neto, 0)) };
}

function header(sheet, title, subtitle, labels) {
  sheet.mergeCells(1, 1, 1, labels.length);
  sheet.getCell(1, 1).value = title;
  sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  sheet.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123872" } };
  sheet.getRow(1).height = 30;
  sheet.mergeCells(2, 1, 2, labels.length);
  sheet.getCell(2, 1).value = subtitle;
  sheet.mergeCells(3, 1, 3, labels.length);
  sheet.getCell(3, 1).value = "Las cantidades salen del sistema. Verifique con conteo físico; valores en CRC.";
  sheet.getRow(4).values = labels;
  sheet.getRow(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF234C88" } };
  sheet.views = [{ state: "frozen", ySplit: 4 }];
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: labels.length } };
}

async function inventoryXlsx(articles, filterText = "") {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Inventario", { properties: { defaultRowHeight: 19 } });
  sheet.columns = [18, 20, 43, 17, 16, 12, 19, 30, 17, 12, 12, 17, 19, 17, 17].map(width => ({ width }));
  header(sheet, "Inventario de bodega", `Existencia esperada al descargar · ${new Date().toLocaleString("es-CR", { timeZone: "America/Costa_Rica" })}${filterText ? ` · ${filterText}` : ""}`,
    ["Código taller", "Código proveedor", "Descripción", "Origen", "Grupo", "Unidad", "Ubicación", "Proveedor", "Esperado", "Mínimo", "Máximo", "Precio unitario", "Valor esperado", "Conteo físico", "Diferencia"]);
  if (articles.some(a => number(a.stock_actual) > 0 && number(a.precio_unitario) <= 0)) {
    sheet.getCell(3, 1).value = "Atención: hay artículos con existencia y sin precio; el valor esperado no es completo.";
  }
  for (const a of articles) {
    const row = sheet.addRow([a.codigo_taller || "", a.codigo || "", a.nombre || "", a.origen_inventario || "", a.grupo_bodega || "", a.unidad_medida || "", a.ubicacion || "", a.proveedor_consignacion || a.proveedor_nombre || "", number(a.stock_actual), number(a.stock_minimo), number(a.stock_maximo), number(a.precio_unitario), cents(number(a.stock_actual) * number(a.precio_unitario)), null, null]);
    row.getCell(15).value = { formula: `IF(N${row.number}="","",N${row.number}-I${row.number})` };
    for (const index of [9, 10, 11, 12, 13, 14, 15]) row.getCell(index).numFmt = '#,##0.00';
    row.getCell(14).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4CE" } };
  }
  return workbook.xlsx.writeBuffer();
}

async function consignmentXlsx(data, period, supplier = "") {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Resumen semanal");
  sheet.columns = [31, 16, 20, 44, 12, 14, 15, 14, 20, 20, 20].map(width => ({ width }));
  header(sheet, "Consumo de consignación", `${period.desde} al ${period.hasta} · ${supplier || "Todos los proveedores"}`,
    ["Proveedor", "Código taller", "Código producto", "Descripción", "Unidad", "Salidas", "Devoluciones", "Neto", "Costo salidas", "Costo devoluciones", "Gasto neto"]);
  for (const item of data.summary) {
    const row = sheet.addRow([item.proveedor, item.codigo_taller, item.codigo, item.nombre, item.unidad_medida, item.salidas, item.devoluciones, item.cantidad_neta, item.costo_salidas, item.costo_devoluciones, item.costo_neto]);
    for (const index of [6, 7, 8, 9, 10, 11]) row.getCell(index).numFmt = '#,##0.00';
  }
  const total = sheet.addRow(["TOTAL", "", "", "", "", "", "", "", "", "", data.total]);
  total.font = { bold: true };
  total.getCell(11).numFmt = '#,##0.00';

  const detail = workbook.addWorksheet("Movimientos");
  detail.columns = [23, 31, 16, 20, 44, 16, 15, 18, 19, 17, 28].map(width => ({ width }));
  header(detail, "Detalle de consumo de consignación", `${period.desde} al ${period.hasta} · salida positiva y devolución negativa`,
    ["Fecha", "Proveedor", "Código taller", "Código producto", "Descripción", "Movimiento", "Cantidad neta", "Precio unitario", "Importe neto", "Placa", "Mecánico"]);
  for (const item of data.details) {
    const row = detail.addRow([item.creado_en, item.proveedor, item.codigo_taller, item.codigo, item.nombre, item.tipo_movimiento, item.cantidad_neta, item.precio, item.costo_neto, item.placa || "", item.mecanico || ""]);
    if (item.creado_en instanceof Date) row.getCell(1).numFmt = 'dd/mm/yyyy hh:mm';
    for (const index of [7, 8, 9]) row.getCell(index).numFmt = '#,##0.00';
  }
  if (data.summary.some(item => item.sin_precio || item.precio_estimado)) {
    sheet.getCell(3, 1).value = "Aviso: hay movimientos sin precio o devoluciones valoradas con el precio actual; revise el detalle.";
  }
  return workbook.xlsx.writeBuffer();
}

function ownInventoryPdf(articles, data, period) {
  const byArticle = new Map(data.summary.map(item => [Number(item.articulo_id), item]));
  const rows = articles.map(a => {
    const movement = byArticle.get(Number(a.id));
    byArticle.delete(Number(a.id));
    return { article: a, movement };
  });
  for (const movement of byArticle.values()) rows.push({ article: {
    codigo_taller: movement.codigo_taller,
    codigo: movement.codigo,
    nombre: movement.nombre,
    stock_actual: 0,
    precio_unitario: movement.precio_actual
  }, movement });
  const stockValue = cents(articles.reduce((sum, a) => sum + number(a.stock_actual) * number(a.precio_unitario), 0));
  const missingStockPrice = articles.some(a => number(a.stock_actual) > 0 && number(a.precio_unitario) <= 0);
  const body = [["Cód. taller", "Cód. producto", "Descripción", "Esperado", "Precio", "Valor stock", "Salidas", "Dev.", "Consumo neto", "Costo neto"]];
  for (const { article, movement } of rows) body.push([
    article.codigo_taller || "-", article.codigo || "-", article.nombre || "-", quantity(article.stock_actual),
    money(article.precio_unitario), money(number(article.stock_actual) * number(article.precio_unitario)),
    quantity(movement?.salidas), quantity(movement?.devoluciones), quantity(movement?.cantidad_neta), money(movement?.costo_neto)
  ]);
  body.push([{ text: "TOTAL", bold: true, colSpan: 5 }, "", "", "", "", money(stockValue), "", "", "", money(data.total)]);
  const notes = ["El consumo corresponde a salidas menos devoluciones; las salidas usan el precio guardado al despachar."];
  if (missingStockPrice) notes.push("Hay existencias sin precio registrado; el valor del inventario puede estar incompleto.");
  if (data.summary.some(item => item.sin_precio || item.precio_estimado)) notes.push("Hay movimientos sin precio o devoluciones valoradas con precio actual; revise el costo.");
  const definition = {
    pageSize: "A4", pageOrientation: "landscape", pageMargins: [28, 42, 28, 36],
    defaultStyle: { font: "Helvetica", fontSize: 8, color: "#17243A" },
    content: [
      { text: "Inventario propio y consumo", style: "title" },
      { text: `Período: ${period.desde} al ${period.hasta}    |    Generado: ${new Date().toLocaleString("es-CR", { timeZone: "America/Costa_Rica" })}`, margin: [0, 2, 0, 12] },
      { columns: [
        { text: `Valor del inventario actual: CRC ${money(stockValue)}`, bold: true },
        { text: `Costo neto consumido: CRC ${money(data.total)}`, bold: true }
      ], margin: [0, 0, 0, 12] },
      { table: { headerRows: 1, widths: [57, 70, "*", 49, 58, 67, 44, 38, 60, 65], body },
        layout: { fillColor: row => row === 0 ? "#123872" : row % 2 === 0 ? "#F1F5FA" : null,
          hLineColor: () => "#D8E1ED", vLineColor: () => "#D8E1ED" } },
      { text: notes.join(" "), margin: [0, 10, 0, 0], fontSize: 7, color: "#5B6778" }
    ],
    styles: { title: { fontSize: 17, bold: true, color: "#123872" } },
    footer: (page, pages) => ({ text: `Tomza Taller  |  Página ${page} de ${pages}`, alignment: "right", margin: [0, 0, 28, 0], fontSize: 7 })
  };
  body[0] = body[0].map(value => ({ text: value, bold: true, color: "#FFFFFF" }));
  return new Promise((resolve, reject) => {
    const stream = printer.createPdfKitDocument(definition);
    const chunks = [];
    stream.on("data", chunk => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    stream.end();
  });
}

module.exports = { defaultPeriod, reportPeriod, consumption, inventoryXlsx, consignmentXlsx, ownInventoryPdf };
