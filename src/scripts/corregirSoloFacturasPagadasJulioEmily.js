require("dotenv").config();

const path = require("path");
const ExcelJS = require("exceljs");
const pool = require("../db");

const DEFAULT_FILE = "C:/Users/asist/Downloads/PAGOS JULIO EMILY.xlsx";
const PERIODO_CIERRE = "2026-07";
const TOTAL_OFICIAL = 62615263.92;
const OBS_AJUSTE = "Ajuste cierre facturas Emily julio 2026";

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
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || "").join("").trim();
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

function toMoney(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number(value.toFixed(4));

  let text = String(value).replace(/[₡$]/g, "").replace(/\s/g, "").trim();
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
  const text = normText(value);
  if (text.includes("SUPER")) return "SUPER GAS";
  if (text.includes("TOMZA")) return "GAS TOMZA";
  return "";
}

function normalizarPlaca(value) {
  const clean = normText(value).replace(/[^A-Z0-9]/g, "");
  if (!clean) return null;
  const match = clean.match(/^(?:PLACA)?([A-Z]{0,2}\d{5,6})$/) || clean.match(/([A-Z]{0,2}\d{5,6})/);
  if (!match) return clean.slice(0, 50);
  let plate = match[1];
  if (/^\d{5,6}$/.test(plate)) plate = `C${plate}`;
  if (/^CLC/.test(plate)) plate = plate.replace(/^CL/, "");
  return plate.slice(0, 50);
}

function facturaKey(providerName, invoiceNumber) {
  return `${normKey(providerName)}|${normKey(invoiceNumber)}`;
}

async function leerPagos(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const rows = [];

  for (const sheet of workbook.worksheets) {
    let empresaActual = "";
    let headerMap = null;

    sheet.eachRow({ includeEmpty: false }, row => {
      const values = row.values.slice(1).map(value => normText(value?.text || value?.result || value || ""));
      const text = values.filter(Boolean).join(" ");
      const empresa = normalizarEmpresa(text);
      if (empresa) {
        empresaActual = empresa;
        headerMap = null;
        if (!normText(cellText(row.getCell(1))).includes("FECHA")) return;
      }

      const esEncabezado = values.some(value => value.includes("FECHA")) &&
        values.some(value => value.includes("PROVEEDOR") || value.includes("PROVEDOR")) &&
        values.some(value => value.includes("FACTURA"));

      if (esEncabezado) {
        headerMap = {};
        row.eachCell((cell, colNumber) => {
          const header = normText(cellText(cell));
          if (header.includes("FECHA") && header.includes("SOLICITUD")) headerMap.fechaSolicitud = colNumber;
          if (header.includes("PROVEEDOR") || header.includes("PROVEDOR")) headerMap.proveedor = colNumber;
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
      const filaNormalizada = normText(text);
      if (
        filaNormalizada.includes("TOTAL SOLICITADO") ||
        filaNormalizada.includes("TOTAL GENERAL") ||
        filaNormalizada.startsWith("NOTAS:")
      ) return;

      const proveedor = cellText(row.getCell(headerMap.proveedor));
      const monto = toMoney(cellRaw(row.getCell(headerMap.monto)));
      if (!proveedor || monto <= 0) return;

      const fechaSolicitud = toSqlDate(cellRaw(row.getCell(headerMap.fechaSolicitud)));
      const fechaPago = toSqlDate(cellRaw(row.getCell(headerMap.fechaPago))) || fechaSolicitud;

      rows.push({
        hoja: sheet.name,
        fila: row.number,
        empresa: empresaActual || "GAS TOMZA",
        fecha: fechaSolicitud || fechaPago || `${PERIODO_CIERRE}-31`,
        fecha_pago: fechaPago || fechaSolicitud || `${PERIODO_CIERRE}-31`,
        proveedor_nombre: proveedor.trim(),
        cuenta_iban: cellText(row.getCell(headerMap.iban)) || null,
        concepto: cellText(row.getCell(headerMap.concepto)) || "Factura pagada",
        numero_factura: cellText(row.getCell(headerMap.factura)).trim().slice(0, 100) || null,
        placa: normalizarPlaca(cellText(row.getCell(headerMap.placa))),
        monto,
        partida_presupuestaria: cellText(row.getCell(headerMap.partida)) || null
      });
    });
  }

  return rows;
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
  for (const [table, afterColumn] of [["facturas", "periodo_cierre"], ["ordenes_compra", "periodo_cierre"]]) {
    if (!(await columnExists(connection, table, "periodo_cierre"))) {
      await connection.query(`ALTER TABLE ${table} ADD COLUMN periodo_cierre CHAR(7) NULL AFTER fecha_pago`);
    }
    if (!(await columnExists(connection, table, "monto_pagado_cierre"))) {
      await connection.query(`ALTER TABLE ${table} ADD COLUMN monto_pagado_cierre DECIMAL(14,4) NULL AFTER ${afterColumn}`);
    }
  }

  await connection.query("ALTER TABLE facturas MODIFY COLUMN monto DECIMAL(14,4) NOT NULL DEFAULT 0");
  await connection.query("ALTER TABLE facturas MODIFY COLUMN abono_monto DECIMAL(14,4) NOT NULL DEFAULT 0");
  await connection.query("ALTER TABLE facturas MODIFY COLUMN nota_credito_monto DECIMAL(14,4) NOT NULL DEFAULT 0");
}

function addToIndex(index, key, row) {
  if (!key) return;
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(row);
}

async function loadFacturas(connection) {
  const [rows] = await connection.query(`
    SELECT id, numero_factura, proveedor_nombre
    FROM facturas
    WHERE numero_factura IS NOT NULL AND TRIM(numero_factura) <> ''
    ORDER BY id ASC
  `);

  const byExact = new Map();
  const byInvoice = new Map();
  rows.forEach(row => {
    addToIndex(byExact, facturaKey(row.proveedor_nombre, row.numero_factura), row);
    addToIndex(byInvoice, normKey(row.numero_factura), row);
  });

  return { byExact, byInvoice };
}

function tomarDisponible(index, key, usados) {
  const rows = index.get(key) || [];
  return rows.find(row => !usados.has(row.id));
}

async function getProveedorId(connection, nombre) {
  const [[row]] = await connection.query(
    "SELECT id FROM proveedores WHERE REPLACE(UPPER(nombre), ' ', '') = REPLACE(UPPER(?), ' ', '') LIMIT 1",
    [nombre]
  );
  return row?.id || null;
}

async function totalDashboardFacturasJulio(connection) {
  const [[row]] = await connection.query(`
    SELECT COUNT(*) AS registros, ROUND(COALESCE(SUM(monto_pagado), 0), 2) AS total
    FROM (
      SELECT CASE
        WHEN COALESCE(o.monto_pagado_cierre, 0) > 0 THEN o.monto_pagado_cierre
        WHEN COALESCE(o.abono_monto, 0) > 0 THEN LEAST(o.abono_monto, GREATEST(COALESCE(o.total, 0) - COALESCE(o.nota_credito_monto, 0), 0))
        ELSE GREATEST(COALESCE(o.total, 0) - COALESCE(o.nota_credito_monto, 0), 0)
      END AS monto_pagado
      FROM ordenes_compra o
      WHERE o.facturada = 1
        AND COALESCE(o.pagada, 0) = 1
        AND o.periodo_cierre = ?
      UNION ALL
      SELECT CASE
        WHEN COALESCE(f.monto_pagado_cierre, 0) > 0 THEN f.monto_pagado_cierre
        WHEN COALESCE(f.abono_monto, 0) > 0 THEN LEAST(f.abono_monto, GREATEST(COALESCE(f.monto, 0) - COALESCE(f.nota_credito_monto, 0), 0))
        ELSE GREATEST(COALESCE(f.monto, 0) - COALESCE(f.nota_credito_monto, 0), 0)
      END AS monto_pagado
      FROM facturas f
      WHERE COALESCE(f.pagada, 0) = 1
        AND f.periodo_cierre = ?
    ) pagadas
  `, [PERIODO_CIERRE, PERIODO_CIERRE]);

  return {
    registros: Number(row?.registros || 0),
    total: Number(row?.total || 0)
  };
}

async function main() {
  const fileArg = process.argv.find(arg => arg.startsWith("--file="));
  const filePath = path.resolve(fileArg ? fileArg.slice("--file=".length) : DEFAULT_FILE);
  const rows = await leerPagos(filePath);
  const totalExcel = Number(rows.reduce((sum, row) => sum + row.monto, 0).toFixed(2));

  if (Math.abs(totalExcel - TOTAL_OFICIAL) >= 0.01) {
    throw new Error(`El Excel suma ${totalExcel}, no ${TOTAL_OFICIAL}. No se toca la base.`);
  }

  const connection = await pool.getConnection();
  const usados = new Set();
  const proveedorCache = new Map();

  try {
    await ensureSchema(connection);
    await connection.beginTransaction();

    const antes = await totalDashboardFacturasJulio(connection);

    await connection.query(
      "UPDATE facturas SET periodo_cierre = NULL, monto_pagado_cierre = NULL WHERE periodo_cierre = ?",
      [PERIODO_CIERRE]
    );
    await connection.query(
      "UPDATE ordenes_compra SET periodo_cierre = NULL, monto_pagado_cierre = NULL WHERE periodo_cierre = ?",
      [PERIODO_CIERRE]
    );
    await connection.query(
      "DELETE FROM facturas WHERE factura_observacion LIKE ?",
      [`%${OBS_AJUSTE}%`]
    );

    const { byExact, byInvoice } = await loadFacturas(connection);
    let actualizadas = 0;
    let insertadas = 0;

    for (const row of rows) {
      const exactKey = facturaKey(row.proveedor_nombre, row.numero_factura);
      const invoiceKey = normKey(row.numero_factura);
      const existente = tomarDisponible(byExact, exactKey, usados) ||
        (invoiceKey.length >= 8 ? tomarDisponible(byInvoice, invoiceKey, usados) : null);

      const observacion = [
        row.concepto,
        row.partida_presupuestaria ? `Partida: ${row.partida_presupuestaria}` : "",
        row.cuenta_iban ? `IBAN: ${row.cuenta_iban}` : "",
        `${OBS_AJUSTE}: ${path.basename(filePath)} hoja ${row.hoja}, fila ${row.fila}`
      ].filter(Boolean).join(" | ");

      if (existente) {
        usados.add(existente.id);
        await connection.query(
          `UPDATE facturas
           SET pagada = 1,
               fecha_pago = ?,
               periodo_cierre = ?,
               monto_pagado_cierre = ?,
               factura_fecha_recepcion = COALESCE(factura_fecha_recepcion, ?),
               factura_recibido_por = COALESCE(factura_recibido_por, 'admin'),
               factura_producto_recibido = 1,
               factura_observacion = CASE
                 WHEN factura_observacion IS NULL OR factura_observacion = '' THEN ?
                 WHEN factura_observacion LIKE ? THEN factura_observacion
                 ELSE CONCAT(factura_observacion, ' | ', ?)
               END,
               factura_placa_producto = COALESCE(factura_placa_producto, ?)
           WHERE id = ?`,
          [
            row.fecha_pago,
            PERIODO_CIERRE,
            row.monto,
            row.fecha_pago,
            observacion,
            `%${OBS_AJUSTE}%`,
            observacion,
            row.placa,
            existente.id
          ]
        );
        actualizadas += 1;
        continue;
      }

      if (!proveedorCache.has(row.proveedor_nombre)) {
        proveedorCache.set(row.proveedor_nombre, await getProveedorId(connection, row.proveedor_nombre));
      }

      await connection.query(
        `INSERT INTO facturas (
          numero_factura, fecha, monto, proveedor_id, proveedor_nombre, pagada, fecha_pago, periodo_cierre,
          monto_pagado_cierre, creado_por, factura_fecha_recepcion, factura_tipo_entrega, factura_entregado_por,
          factura_recibido_por, factura_producto_recibido, factura_observacion, factura_placa_producto
        )
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, ?, 'Importacion Excel', 'PAGOS JULIO EMILY', 'admin', 1, ?, ?)`,
        [
          row.numero_factura,
          row.fecha,
          row.monto,
          proveedorCache.get(row.proveedor_nombre),
          row.proveedor_nombre,
          row.fecha_pago,
          PERIODO_CIERRE,
          row.monto,
          row.fecha_pago,
          observacion,
          row.placa
        ]
      );
      insertadas += 1;
    }

    const despues = await totalDashboardFacturasJulio(connection);
    if (Math.abs(despues.total - TOTAL_OFICIAL) >= 0.01) {
      throw new Error(`Facturas pagadas quedaria en ${despues.total}, no ${TOTAL_OFICIAL}. Se revierte.`);
    }

    await connection.commit();
    console.log(`Antes: ${antes.registros} movimientos, total ${antes.total.toFixed(2)}.`);
    console.log(`Despues: ${despues.registros} movimientos, total ${despues.total.toFixed(2)}.`);
    console.log(`Actualizadas: ${actualizadas}. Insertadas: ${insertadas}.`);
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
