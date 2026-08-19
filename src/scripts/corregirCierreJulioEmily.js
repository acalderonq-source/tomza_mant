require("dotenv").config();

const path = require("path");
const ExcelJS = require("exceljs");
const pool = require("../db");

const DEFAULT_FILE = "C:/Users/asist/Downloads/PAGOS JULIO EMILY.xlsx";
const PERIODO_CIERRE = "2026-07";
const TOTAL_OFICIAL = 62615263.92;
const ARCHIVO_NOMBRE = "PAGOS JULIO EMILY.xlsx";

function normalizarTexto(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function textoCelda(cell) {
  const value = cell?.value;
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (value.text != null) return String(value.text).trim();
    if (value.result != null) return String(value.result).trim();
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || "").join("").trim();
  }
  return String(value).trim();
}

function valorCelda(cell) {
  const value = cell?.value;
  if (value && typeof value === "object" && value.result != null) return value.result;
  return value;
}

function fechaExcelToSql(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
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

function parseMonto(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number(value.toFixed(4));

  let text = String(value)
    .replace(/[₡$]/g, "")
    .replace(/\s/g, "")
    .trim();
  if (!text) return 0;

  if (text.includes(",") && text.includes(".")) {
    text = text.lastIndexOf(",") > text.lastIndexOf(".")
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  }

  const amount = Number(text);
  return Number.isFinite(amount) ? Number(amount.toFixed(4)) : 0;
}

function normalizarEmpresa(value) {
  const text = normalizarTexto(value);
  if (text.includes("SUPER")) return "SUPER GAS";
  if (text.includes("TOMZA")) return "GAS TOMZA";
  return "";
}

function normalizarPlaca(value) {
  const clean = normalizarTexto(value).replace(/[^A-Z0-9]/g, "");
  if (!clean) return null;
  const match = clean.match(/^(?:PLACA)?([A-Z]{0,2}\d{5,6})$/) || clean.match(/([A-Z]{0,2}\d{5,6})/);
  if (!match) return clean.slice(0, 50);
  let plate = match[1];
  if (/^\d{5,6}$/.test(plate)) plate = `C${plate}`;
  if (/^CLC/.test(plate)) plate = plate.replace(/^CL/, "");
  return plate.slice(0, 50);
}

async function leerPagos(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const pagos = [];

  workbook.worksheets.forEach(sheet => {
    let empresaActual = "";
    let headerMap = null;

    sheet.eachRow({ includeEmpty: false }, row => {
      const valores = row.values.slice(1).map(value => normalizarTexto(value?.text || value?.result || value || ""));
      const textoFila = valores.filter(Boolean).join(" ");
      const empresa = normalizarEmpresa(textoFila);

      if (empresa) {
        empresaActual = empresa;
        headerMap = null;
        if (!normalizarTexto(textoCelda(row.getCell(1))).includes("FECHA")) return;
      }

      const esEncabezado = valores.some(value => value.includes("FECHA")) &&
        valores.some(value => value.includes("PROVEEDOR") || value.includes("PROVEDOR")) &&
        valores.some(value => value.includes("FACTURA"));

      if (esEncabezado) {
        headerMap = {};
        row.eachCell((cell, colNumber) => {
          const header = normalizarTexto(textoCelda(cell));
          if (header.includes("FECHA") && header.includes("SOLICITUD")) headerMap.fechaSolicitud = colNumber;
          if (header.includes("PROVEEDOR") || header.includes("PROVEDOR")) headerMap.proveedor = colNumber;
          if (header.includes("CUENTA") || header.includes("IBAN")) headerMap.cuentaIban = colNumber;
          if (header.includes("CONCEPTO")) headerMap.concepto = colNumber;
          if (header.includes("FACTURA")) headerMap.numeroFactura = colNumber;
          if (header.includes("PLACA")) headerMap.placa = colNumber;
          if (header.includes("MONTO")) headerMap.monto = colNumber;
          if (header.includes("PARTIDA")) headerMap.partida = colNumber;
          if (header.includes("FECHA") && header.includes("PAGO")) headerMap.fechaPago = colNumber;
        });
        return;
      }

      if (!headerMap) return;

      const filaNormalizada = normalizarTexto(textoFila);
      if (
        filaNormalizada.includes("TOTAL SOLICITADO") ||
        filaNormalizada.includes("TOTAL GENERAL") ||
        filaNormalizada.startsWith("NOTAS:")
      ) {
        return;
      }

      const proveedor = textoCelda(row.getCell(headerMap.proveedor || 2));
      const monto = parseMonto(valorCelda(row.getCell(headerMap.monto || 7)));
      if (!proveedor || monto <= 0) return;

      const fechaSolicitud = fechaExcelToSql(valorCelda(row.getCell(headerMap.fechaSolicitud || 1)));
      const fechaPago = fechaExcelToSql(valorCelda(row.getCell(headerMap.fechaPago || 9))) || fechaSolicitud;

      pagos.push({
        empresa: empresaActual || "GAS TOMZA",
        fecha_solicitud: fechaSolicitud,
        proveedor_nombre: proveedor.slice(0, 180),
        cuenta_iban: textoCelda(row.getCell(headerMap.cuentaIban || 3)) || null,
        concepto: textoCelda(row.getCell(headerMap.concepto || 4)) || null,
        numero_factura: textoCelda(row.getCell(headerMap.numeroFactura || 5)).slice(0, 100) || null,
        placa: normalizarPlaca(textoCelda(row.getCell(headerMap.placa || 6))),
        monto,
        partida_presupuestaria: textoCelda(row.getCell(headerMap.partida || 8)) || null,
        fecha_pago: fechaPago
      });
    });
  });

  return pagos;
}

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0]?.total || 0) > 0;
}

async function ensureSchema(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS pagos_proveedor (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empresa VARCHAR(80) NOT NULL,
      fecha_solicitud DATE NULL,
      proveedor_nombre VARCHAR(180) NOT NULL,
      cuenta_iban VARCHAR(60) NULL,
      concepto TEXT NULL,
      numero_factura VARCHAR(100) NULL,
      placa VARCHAR(50) NULL,
      monto DECIMAL(14,4) NOT NULL DEFAULT 0,
      partida_presupuestaria VARCHAR(150) NULL,
      pagada TINYINT(1) NOT NULL DEFAULT 0,
      fecha_pago DATE NULL,
      periodo_cierre CHAR(7) NULL,
      archivo_nombre VARCHAR(255) NULL,
      creado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  if (!(await columnExists(connection, "pagos_proveedor", "pagada"))) {
    await connection.query("ALTER TABLE pagos_proveedor ADD COLUMN pagada TINYINT(1) NOT NULL DEFAULT 0 AFTER partida_presupuestaria");
  }
  if (!(await columnExists(connection, "pagos_proveedor", "periodo_cierre"))) {
    await connection.query("ALTER TABLE pagos_proveedor ADD COLUMN periodo_cierre CHAR(7) NULL AFTER fecha_pago");
  }
  await connection.query("ALTER TABLE pagos_proveedor MODIFY COLUMN monto DECIMAL(14,4) NOT NULL DEFAULT 0");

  for (const [table, afterColumn] of [["facturas", "fecha_pago"], ["ordenes_compra", "fecha_pago"]]) {
    if (!(await columnExists(connection, table, "periodo_cierre"))) {
      await connection.query(`ALTER TABLE ${table} ADD COLUMN periodo_cierre CHAR(7) NULL AFTER ${afterColumn}`);
    }
  }
}

async function main() {
  const fileArg = process.argv.find(arg => arg.startsWith("--file="));
  const filePath = path.resolve(fileArg ? fileArg.slice("--file=".length) : DEFAULT_FILE);
  const pagos = await leerPagos(filePath);
  const totalArchivo = Number(pagos.reduce((sum, pago) => sum + pago.monto, 0).toFixed(2));

  if (Math.abs(totalArchivo - TOTAL_OFICIAL) >= 0.01) {
    throw new Error(`El Excel suma ${totalArchivo}, no ${TOTAL_OFICIAL}. No se aplico ningun cambio.`);
  }

  const connection = await pool.getConnection();
  try {
    await ensureSchema(connection);
    await connection.beginTransaction();

    await connection.query("UPDATE facturas SET periodo_cierre = NULL WHERE periodo_cierre = ?", [PERIODO_CIERRE]);
    await connection.query("UPDATE ordenes_compra SET periodo_cierre = NULL WHERE periodo_cierre = ?", [PERIODO_CIERRE]);
    await connection.query("UPDATE pagos_proveedor SET periodo_cierre = NULL WHERE periodo_cierre = ?", [PERIODO_CIERRE]);
    await connection.query("DELETE FROM pagos_proveedor WHERE archivo_nombre = ?", [ARCHIVO_NOMBRE]);

    for (const pago of pagos) {
      await connection.query(
        `INSERT INTO pagos_proveedor
         (empresa, fecha_solicitud, proveedor_nombre, cuenta_iban, concepto, numero_factura, placa, monto,
          partida_presupuestaria, pagada, fecha_pago, periodo_cierre, archivo_nombre, creado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)`,
        [
          pago.empresa,
          pago.fecha_solicitud,
          pago.proveedor_nombre,
          pago.cuenta_iban,
          pago.concepto,
          pago.numero_factura,
          pago.placa,
          pago.monto,
          pago.partida_presupuestaria,
          pago.fecha_pago,
          PERIODO_CIERRE,
          ARCHIVO_NOMBRE
        ]
      );
    }

    const [[resultado]] = await connection.query(
      "SELECT COUNT(*) AS registros, ROUND(COALESCE(SUM(monto), 0), 2) AS total FROM pagos_proveedor WHERE periodo_cierre = ? AND pagada = 1",
      [PERIODO_CIERRE]
    );
    const totalDb = Number(resultado.total || 0);

    if (Math.abs(totalDb - TOTAL_OFICIAL) >= 0.01) {
      throw new Error(`La BD quedaria en ${totalDb}, no ${TOTAL_OFICIAL}. Se revierte.`);
    }

    await connection.commit();
    console.log(`Cierre ${PERIODO_CIERRE} corregido: ${resultado.registros} movimientos, total ${totalDb.toFixed(2)}.`);
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
