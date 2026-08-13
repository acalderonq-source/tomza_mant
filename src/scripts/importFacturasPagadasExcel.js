require("dotenv").config();

const path = require("path");
const ExcelJS = require("exceljs");
const pool = require("../db");

const DEFAULT_FILE = "C:/Users/asist/Downloads/PAGOS JULIO EMILY.xlsx";

function normText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normKey(value) {
  return normText(value).replace(/[^A-Z0-9]/g, "");
}

function cellText(cell) {
  const value = cell?.value;
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (value.text != null) return String(value.text).trim();
    if (value.result != null) return String(value.result).trim();
    if (value.richText) return value.richText.map(part => part.text || "").join("").trim();
    if (value.hyperlink && value.text) return String(value.text).trim();
  }
  return String(value).trim();
}

function cellRaw(cell) {
  const value = cell?.value;
  if (value && typeof value === "object" && value.result != null) return value.result;
  return value;
}

function toSqlDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    const millis = Math.round((value - 25569) * 86400 * 1000);
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slash) {
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${slash[2].padStart(2, "0")}-${slash[1].padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function toMoney(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number(value.toFixed(2));

  let text = String(value)
    .replace(/[₡$]/g, "")
    .replace(/\s/g, "")
    .trim();

  if (!text) return 0;

  const hasComma = text.includes(",");
  const hasDot = text.includes(".");

  if (hasComma && hasDot) {
    text = text.lastIndexOf(",") > text.lastIndexOf(".")
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  } else if (hasComma) {
    text = text.replace(",", ".");
  }

  const amount = Number(text);
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0;
}

function invoiceKey(providerName, invoiceNumber) {
  return `${normKey(providerName)}|${normKey(invoiceNumber)}`;
}

function normalizePlate(value) {
  const clean = normText(value).replace(/\s+/g, "");
  if (!clean) return null;
  const match = clean.match(/^(?:PLACA)?([A-Z]{0,2}\d{5,6})$/) || clean.match(/([A-Z]{0,2}\d{5,6})/);
  if (!match) return clean.slice(0, 50);
  let plate = match[1];
  if (/^\d{5,6}$/.test(plate)) plate = `C${plate}`;
  if (/^CLC/.test(plate)) plate = plate.replace(/^CL/, "");
  return plate.slice(0, 50);
}

async function readWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const rows = [];
  for (const sheet of workbook.worksheets) {
    let headerMap = null;

    sheet.eachRow({ includeEmpty: false }, row => {
      const values = row.values.slice(1).map(value => normText(value?.text || value?.result || value || ""));
      const looksHeader = values.some(value => value.includes("FECHA")) &&
        values.some(value => value.includes("PROVEDOR") || value.includes("PROVEEDOR")) &&
        values.some(value => value.includes("FACTURA"));

      if (looksHeader) {
        headerMap = {};
        row.eachCell((cell, colNumber) => {
          const header = normText(cellText(cell));
          if (header.includes("FECHA") && header.includes("SOLICITUD")) headerMap.fechaSolicitud = colNumber;
          if (header.includes("PROVEDOR") || header.includes("PROVEEDOR")) headerMap.proveedor = colNumber;
          if (header.includes("CUENTA") || header.includes("IBAN")) headerMap.iban = colNumber;
          if (header.includes("CONCEPTO")) headerMap.concepto = colNumber;
          if (header.includes("FACTURA")) headerMap.factura = colNumber;
          if (header.includes("PLACA")) headerMap.placa = colNumber;
          if (header.includes("MONTO")) headerMap.monto = colNumber;
          if (header.includes("PARTIDA")) headerMap.partida = colNumber;
          if (header.includes("FECHA") && header.includes("PAGO")) headerMap.fechaPago = colNumber;
        });
        return;
      }

      if (!headerMap) return;

      const proveedor = cellText(row.getCell(headerMap.proveedor));
      const numeroFactura = cellText(row.getCell(headerMap.factura));
      const monto = toMoney(cellRaw(row.getCell(headerMap.monto)));
      const concepto = cellText(row.getCell(headerMap.concepto));
      const placa = normalizePlate(cellText(row.getCell(headerMap.placa)));
      const fechaSolicitud = toSqlDate(cellRaw(row.getCell(headerMap.fechaSolicitud)));
      const fechaPago = toSqlDate(cellRaw(row.getCell(headerMap.fechaPago))) || fechaSolicitud;
      const partida = cellText(row.getCell(headerMap.partida));
      const cuentaIban = cellText(row.getCell(headerMap.iban));

      if (!proveedor && !numeroFactura && !monto) return;
      if (!proveedor || !numeroFactura || monto <= 0) return;

      rows.push({
        hoja: sheet.name,
        fila: row.number,
        proveedor_nombre: proveedor.trim(),
        numero_factura: numeroFactura.trim().slice(0, 100),
        fecha: fechaSolicitud || fechaPago || new Date().toISOString().slice(0, 10),
        fecha_pago: fechaPago || fechaSolicitud || new Date().toISOString().slice(0, 10),
        monto,
        concepto: concepto || "Factura pagada",
        placa,
        partida_presupuestaria: partida || null,
        cuenta_iban: cuentaIban || null
      });
    });
  }

  return rows;
}

async function loadProviders(connection) {
  const [providers] = await connection.query("SELECT id, nombre FROM proveedores");
  const byName = new Map();
  for (const provider of providers) {
    byName.set(normKey(provider.nombre), provider);
  }
  return byName;
}

async function loadExistingInvoices(connection) {
  const [rows] = await connection.query(`
    SELECT numero_factura, proveedor_nombre, pagada, 'facturas' AS origen
    FROM facturas
    WHERE numero_factura IS NOT NULL AND TRIM(numero_factura) <> ''
    UNION ALL
    SELECT o.factura AS numero_factura, p.nombre AS proveedor_nombre, o.pagada, 'ordenes_compra' AS origen
    FROM ordenes_compra o
    LEFT JOIN proveedores p ON p.id = o.proveedor_id
    WHERE o.factura IS NOT NULL AND TRIM(o.factura) <> ''
  `);

  const existing = new Map();
  const invoiceOnly = new Map();
  for (const row of rows) {
    const invoice = normKey(row.numero_factura || "");
    const key = invoiceKey(row.proveedor_nombre || "", row.numero_factura || "");
    if (!existing.has(key)) existing.set(key, []);
    existing.get(key).push(row);

    if (!invoiceOnly.has(invoice)) invoiceOnly.set(invoice, []);
    invoiceOnly.get(invoice).push(row);
  }
  return { existing, invoiceOnly };
}

async function getAdminId(connection) {
  const [[admin]] = await connection.query("SELECT id FROM usuarios WHERE usuario = 'admin' LIMIT 1");
  return admin?.id || null;
}

async function main() {
  const fileArg = process.argv.find(arg => arg.startsWith("--file="));
  const filePath = path.resolve(fileArg ? fileArg.slice("--file=".length) : DEFAULT_FILE);
  const commit = process.argv.includes("--commit");

  const rows = await readWorkbook(filePath);
  const connection = await pool.getConnection();

  try {
    const providers = await loadProviders(connection);
    const { existing, invoiceOnly } = await loadExistingInvoices(connection);
    const adminId = await getAdminId(connection);
    const seenInFile = new Set();

    const toInsert = [];
    const skipped = [];

    for (const row of rows) {
      const key = invoiceKey(row.proveedor_nombre, row.numero_factura);
      if (seenInFile.has(key)) {
        skipped.push({ ...row, motivo: "duplicada en el Excel" });
        continue;
      }
      seenInFile.add(key);

      if (existing.has(key)) {
        skipped.push({ ...row, motivo: `ya existe en ${existing.get(key).map(item => item.origen).join(", ")}` });
        continue;
      }

      const invoice = normKey(row.numero_factura);
      if (invoice.length >= 8 && invoiceOnly.has(invoice)) {
        skipped.push({ ...row, motivo: `numero de factura ya existe en ${invoiceOnly.get(invoice).map(item => item.origen).join(", ")}` });
        continue;
      }

      const provider = providers.get(normKey(row.proveedor_nombre));
      toInsert.push({
        ...row,
        proveedor_id: provider?.id || null
      });
    }

    const totalRows = rows.reduce((sum, row) => sum + row.monto, 0);
    const totalInsert = toInsert.reduce((sum, row) => sum + row.monto, 0);
    const totalSkipped = skipped.reduce((sum, row) => sum + row.monto, 0);

    console.log(`Archivo: ${filePath}`);
    console.log(`Filas validas leidas: ${rows.length} | Total Excel: ${totalRows.toFixed(2)}`);
    console.log(`Para insertar: ${toInsert.length} | Total nuevo: ${totalInsert.toFixed(2)}`);
    console.log(`Omitidas: ${skipped.length} | Total omitido: ${totalSkipped.toFixed(2)}`);
    console.log("");

    const missingProviders = [...new Set(toInsert.filter(row => !row.proveedor_id).map(row => row.proveedor_nombre))];
    if (missingProviders.length) {
      console.log(`Proveedores no encontrados en catalogo (${missingProviders.length}); se guardan con nombre, sin proveedor_id:`);
      console.log(missingProviders.slice(0, 30).join("\n"));
      if (missingProviders.length > 30) console.log(`... ${missingProviders.length - 30} mas`);
      console.log("");
    }

    console.log("Primeras facturas nuevas:");
    console.table(toInsert.slice(0, 10).map(row => ({
      proveedor: row.proveedor_nombre,
      factura: row.numero_factura,
      fecha: row.fecha,
      pago: row.fecha_pago,
      monto: row.monto,
      placa: row.placa || ""
    })));

    if (!commit) {
      console.log("Modo prueba. Ejecute con --commit para insertar.");
      return;
    }

    await connection.beginTransaction();

    for (const row of toInsert) {
      const observacion = [
        row.concepto,
        row.partida_presupuestaria ? `Partida: ${row.partida_presupuestaria}` : "",
        row.cuenta_iban ? `IBAN: ${row.cuenta_iban}` : "",
        `Importado desde ${path.basename(filePath)} hoja ${row.hoja}, fila ${row.fila}`
      ].filter(Boolean).join(" | ");

      await connection.query(
        `INSERT INTO facturas (
          numero_factura, fecha, monto, proveedor_id, proveedor_nombre, pagada, fecha_pago, creado_por,
          factura_fecha_recepcion, factura_tipo_entrega, factura_entregado_por, factura_recibido_por,
          factura_producto_recibido, factura_observacion, factura_placa_producto
        )
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          row.numero_factura,
          row.fecha,
          row.monto,
          row.proveedor_id,
          row.proveedor_nombre,
          row.fecha_pago,
          adminId,
          row.fecha_pago,
          "Importacion Excel",
          "PAGOS JULIO EMILY",
          "admin",
          observacion,
          row.placa
        ]
      );
    }

    await connection.commit();
    console.log(`Importacion completada. Insertadas: ${toInsert.length}. Omitidas: ${skipped.length}.`);
  } catch (error) {
    try {
      await connection.rollback();
    } catch (_) {}
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
