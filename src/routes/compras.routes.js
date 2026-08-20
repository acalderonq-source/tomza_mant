const express = require("express");
const router = express.Router();
const pool = require("../db");
const fs = require("fs");
const path = require("path");
const PdfPrinter = require("pdfmake");
const ExcelJS = require("exceljs");
const { generarPDFOrden } = require('../utils/pdfOrdenCompra');
const { agregarFiltroPlacaSql, normalizarPlaca: normalizarPlacaSistema } = require("../utils/placas");
const { ensureTipoMantenimientoColumns, normalizarTipoMantenimiento } = require("../utils/tipoMantenimiento");

// ===================== MIDDLEWARES =====================
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (roles.includes(req.session.user.rol)) return next();
    return res.status(403).send("No autorizado");
  };
}

const ROLES_GESTION_FACTURAS = ["ADMIN", "TALLER", "PROVEEDURIA_TALLER"];
const ROLES_MENSAJERO_FACTURAS = ["MENSAJERO", "MENSAJERIA", "MENSAJERO_FACTURAS"];
const ROLES_RECEPCION_FACTURAS = [
  ...ROLES_GESTION_FACTURAS
];
const ROLES_VER_ORDENES = [...ROLES_GESTION_FACTURAS, "CONTABILIDAD", ...ROLES_MENSAJERO_FACTURAS];
const ROLES_REGISTRAR_FACTURA_ORDEN = [...ROLES_GESTION_FACTURAS, ...ROLES_MENSAJERO_FACTURAS];
const PDF_FONTS = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique"
  }
};

function esMensajeroFacturas(user) {
  return ROLES_MENSAJERO_FACTURAS.includes(user.rol);
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseFacturaRef(value) {
  const raw = String(value || "");
  const [tipo, id] = raw.includes(":") ? raw.split(":") : ["orden", raw];

  if (!["orden", "independiente"].includes(tipo) || !/^\d+$/.test(String(id))) {
    return null;
  }

  return { tipo, id };
}

function normalizarLineas(lineas) {
  if (!lineas) return [];

  const lineasArray = Array.isArray(lineas) ? lineas : Object.values(lineas);

  return lineasArray
    .map(linea => {
      const cantidad = parseMontoCotizacion(linea.cantidad) || 0;
      const precioUnitario = parseMontoCotizacion(linea.precio_unitario) || 0;
      const subtotal = cantidad * precioUnitario;
      return {
        codigo: normalizarPlaca(linea.codigo),
        codigo_producto: String(linea.codigo_producto || "").trim().toUpperCase(),
        descripcion: String(linea.descripcion || "").trim(),
        cantidad,
        precio_unitario: precioUnitario,
        subtotal
      };
    })
    .filter(linea => linea.descripcion);
}

function calcularTotalesOrden(lineasOrden, valores = {}) {
  const subtotal = lineasOrden.reduce((sum, linea) => sum + (parseMontoCotizacion(linea.subtotal) || 0), 0);
  const descuento = Math.max(parseMontoCotizacion(valores.descuento), 0);
  const transporte = parseMontoCotizacion(valores.transporte);
  const iva = valores.iva === null || valores.iva === undefined || valores.iva === ""
    ? 13
    : parseMontoCotizacion(valores.iva);
  const baseIva = Math.max(subtotal - descuento, 0) + transporte;
  const total = baseIva + (baseIva * iva / 100);

  return {
    subtotal: subtotal.toFixed(2),
    descuento: descuento.toFixed(2),
    transporte: transporte.toFixed(2),
    iva: iva.toFixed(2),
    total: total.toFixed(2)
  };
}

function normalizarPlaca(value) {
  return normalizarPlacaSistema(value);
}

function obtenerPlacaOrden(lineasOrden, placaUnidad = null) {
  return normalizarPlaca(placaUnidad) || normalizarPlaca((lineasOrden.find(linea => linea.codigo) || {}).codigo);
}

function normalizarTextoBusqueda(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizarClaveCierre(value) {
  return normalizarTextoBusqueda(value).replace(/[^a-z0-9]/g, "");
}

function normalizarSedeDashboard(value) {
  return String(value || "").trim();
}

function esSedeGranelDashboard(sede) {
  const texto = normalizarSedeDashboard(sede).toUpperCase();
  return texto === "GRANEL" || texto.includes("GRANEL_") || texto.includes("GRANEL ");
}

function clasificarPlacaCompra(placa, sede) {
  const placaLimpia = normalizarPlaca(placa) || "SIN PLACA";
  const sedeLimpia = normalizarSedeDashboard(sede);
  const sedeUpper = sedeLimpia.toUpperCase();

  if (placaLimpia === "ACEITES" || sedeUpper === "ACEITES") return "Aceites";
  if (placaLimpia === "GENERALES GASTOS" || ["GENERAL GASTOS", "GENERALES GASTOS", "GASTOS GENERAL", "GASTOS GENERALES", "GENERALES DE GASTOS"].includes(sedeUpper)) return "Generales de gastos";
  if (placaLimpia === "GENERALES TALLER" || ["GENERAL", "GENERALES", "GENERAL TALLER", "GENERALES TALLER"].includes(sedeUpper)) return "General taller";
  if (placaLimpia === "SIN PLACA") return "Sin placa / revisar";
  if (esSedeGranelDashboard(sedeLimpia)) return "Graneles";
  if (sedeUpper === "TRANSPORTADORA" || /^S\d{5,6}$/.test(placaLimpia)) return "Transportadora";
  if (/^C[L]?\d{5,6}$/.test(placaLimpia) && !["TALLER", "TECNICOS"].includes(sedeUpper)) return "Cilindreros";
  return "Otros";
}

function agruparGastosPorPlaca(gastos = []) {
  const ordenCategorias = ["Cilindreros", "Graneles", "Transportadora", "Aceites", "General taller", "Generales de gastos", "Otros", "Sin placa / revisar"];
  const grupos = ordenCategorias.map(nombre => ({
    nombre,
    total: 0,
    ordenes: 0,
    sedes: []
  }));
  const porCategoria = Object.fromEntries(grupos.map(grupo => [grupo.nombre, grupo]));

  gastos.forEach(item => {
    const categoria = clasificarPlacaCompra(item.placa, item.sede);
    const grupo = porCategoria[categoria] || porCategoria["Otros"];
    const sede = normalizarSedeDashboard(item.sede) || "Por revisar";
    const total = Number(item.total_gastado || 0);
    const ordenes = Number(item.ordenes || 0);

    grupo.total += total;
    grupo.ordenes += ordenes;

    let sedeGrupo = grupo.sedes.find(actual => actual.nombre === sede);
    if (!sedeGrupo) {
      sedeGrupo = { nombre: sede, total: 0, ordenes: 0, placas: [] };
      grupo.sedes.push(sedeGrupo);
    }

    sedeGrupo.total += total;
    sedeGrupo.ordenes += ordenes;
    sedeGrupo.placas.push({
      ...item,
      categoria,
      sede,
      total_gastado: total,
      ordenes
    });
  });

  grupos.forEach(grupo => {
    grupo.sedes.sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre));
    grupo.sedes.forEach(sede => {
      sede.placas.sort((a, b) => Number(b.total_gastado || 0) - Number(a.total_gastado || 0));
    });
  });

  return grupos;
}

function extraerJsonRespuestaIA(texto) {
  const raw = String(texto || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (error) {
      return null;
    }
  }
}

function parseMontoCotizacion(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const raw = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .trim();
  if (!raw) return 0;

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized = raw;

  if (lastComma > -1 && lastDot > -1) {
    normalized = lastComma > lastDot
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  } else if (lastComma > -1) {
    normalized = raw.replace(",", ".");
  }

  const monto = parseFloat(normalized);
  return Number.isFinite(monto) ? monto : 0;
}

function sanearAnalisisCotizacion(data, proveedores = []) {
  const resultado = data && typeof data === "object" ? data : {};
  const proveedorDetectado = String(resultado.proveedor_nombre || "").trim();
  const proveedorNormalizado = normalizarTextoBusqueda(proveedorDetectado);
  const proveedorMatch = proveedores.find(p => {
    const nombre = normalizarTextoBusqueda(p.nombre);
    return proveedorNormalizado && (nombre === proveedorNormalizado || nombre.includes(proveedorNormalizado) || proveedorNormalizado.includes(nombre));
  });

  const moneda = String(resultado.moneda || "CRC").toUpperCase().includes("USD") ? "USD" : "CRC";
  const lineas = Array.isArray(resultado.lineas) ? resultado.lineas : [];

  return {
    proveedor_id: proveedorMatch ? proveedorMatch.id : null,
    proveedor_nombre: proveedorDetectado,
    forma_pago: String(resultado.forma_pago || "").trim(),
    moneda,
    placa_unidad: normalizarPlaca(resultado.placa_unidad),
    descuento: parseMontoCotizacion(resultado.descuento),
    transporte: parseMontoCotizacion(resultado.transporte),
    iva: resultado.iva === null || resultado.iva === undefined || resultado.iva === "" ? 13 : parseMontoCotizacion(resultado.iva),
    observaciones: String(resultado.observaciones || "").trim(),
    lineas: lineas
      .map(linea => {
        const cantidad = parseMontoCotizacion(linea.cantidad || 1) || 1;
        const precio = parseMontoCotizacion(linea.precio_unitario || linea.precio || 0);
        const subtotal = parseMontoCotizacion(linea.subtotal || (cantidad * precio));
        return {
          codigo: normalizarPlaca(linea.codigo || linea.placa || ""),
          codigo_producto: String(linea.codigo_producto || linea.codigo_repuesto || linea.cod_producto || "").trim().toUpperCase(),
          descripcion: String(linea.descripcion || linea.detalle || "").trim(),
          cantidad,
          precio_unitario: precio,
          subtotal
        };
      })
      .filter(linea => linea.descripcion)
  };
}

async function queryWithRetry(sql, params = []) {
  try {
    return await pool.query(sql, params);
  } catch (error) {
    if (["ECONNRESET", "PROTOCOL_CONNECTION_LOST", "ETIMEDOUT"].includes(error.code)) {
      console.warn("Reintentando consulta MySQL por conexión reiniciada:", error.code);
      return pool.query(sql, params);
    }
    throw error;
  }
}

const ensureFacturasState = {
  ready: false,
  promise: null
};

async function ensureFacturasSchema() {
  if (ensureFacturasState.ready) return;
  if (!ensureFacturasState.promise) {
    ensureFacturasState.promise = (async () => {
      await ensureFacturaRecepcionColumns();
      await ensurePeriodoCierreColumns();
      await ensureNotaCreditoColumns();
      await ensureAbonoColumns();
      ensureFacturasState.ready = true;
    })().finally(() => {
      ensureFacturasState.promise = null;
    });
  }
  await ensureFacturasState.promise;
}

async function columnExists(tableName, columnName) {
  const [[row]] = await queryWithRetry(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return Number(row.count) > 0;
}

async function tableExists(tableName) {
  const [[row]] = await queryWithRetry(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(row.count) > 0;
}

async function columnInfo(tableName, columnName) {
  const [[row]] = await queryWithRetry(
    `SELECT DATA_TYPE AS dataType, CHARACTER_MAXIMUM_LENGTH AS maxLength
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return row || null;
}

async function ensureFacturaNumeroColumns() {
  const columns = [
    ["facturas", "numero_factura"],
    ["ordenes_compra", "factura"]
  ];

  for (const [table, column] of columns) {
    const info = await columnInfo(table, column);
    if (info && String(info.dataType).toLowerCase() !== "text") {
      await queryWithRetry(`ALTER TABLE ${table} MODIFY COLUMN ${column} TEXT NULL`);
    }
  }
}

async function ensureNotaCreditoColumns() {
  const tables = ["ordenes_compra", "facturas"];
  const columns = [
    ["nota_credito_numero", "VARCHAR(100) NULL"],
    ["nota_credito_fecha", "DATE NULL"],
    ["nota_credito_monto", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["nota_credito_motivo", "TEXT NULL"]
  ];

  for (const table of tables) {
    for (const [column, definition] of columns) {
      if (!(await columnExists(table, column))) {
        await queryWithRetry(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }
  }
}

async function ensureAbonoColumns() {
  const tables = ["ordenes_compra", "facturas"];
  const columns = [
    ["abono_monto", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["abono_fecha", "DATE NULL"],
    ["abono_observacion", "TEXT NULL"]
  ];

  for (const table of tables) {
    for (const [column, definition] of columns) {
      if (!(await columnExists(table, column))) {
        await queryWithRetry(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }
  }
}

async function ensureFacturaRecepcionColumns() {
  await ensureFacturaNumeroColumns();

  const ordenColumns = [
    ["factura_fecha", "DATE NULL"],
    ["factura_fecha_recepcion", "DATE NULL"],
    ["factura_tipo_entrega", "VARCHAR(80) NULL"],
    ["factura_entregado_por", "VARCHAR(150) NULL"],
    ["factura_recibido_por", "VARCHAR(150) NULL"],
    ["factura_producto_recibido", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["factura_observacion", "TEXT NULL"],
    ["factura_foto_producto", "VARCHAR(255) NULL"],
    ["factura_placa_producto", "VARCHAR(50) NULL"]
  ];

  const facturaColumns = [
    ["factura_fecha_recepcion", "DATE NULL"],
    ["factura_tipo_entrega", "VARCHAR(80) NULL"],
    ["factura_entregado_por", "VARCHAR(150) NULL"],
    ["factura_recibido_por", "VARCHAR(150) NULL"],
    ["factura_producto_recibido", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["factura_observacion", "TEXT NULL"],
    ["factura_foto_producto", "VARCHAR(255) NULL"],
    ["factura_placa_producto", "VARCHAR(50) NULL"]
  ];

  for (const [column, definition] of ordenColumns) {
    if (!(await columnExists("ordenes_compra", column))) {
      await queryWithRetry(`ALTER TABLE ordenes_compra ADD COLUMN ${column} ${definition}`);
    }
  }

  for (const [column, definition] of facturaColumns) {
    if (!(await columnExists("facturas", column))) {
      await queryWithRetry(`ALTER TABLE facturas ADD COLUMN ${column} ${definition}`);
    }
  }
}

async function ensurePagosProveedorTable() {
  await queryWithRetry(`
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
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pagos_proveedor_empresa (empresa),
      INDEX idx_pagos_proveedor_fecha (fecha_solicitud),
      INDEX idx_pagos_proveedor_periodo_cierre (periodo_cierre),
      INDEX idx_pagos_proveedor_proveedor (proveedor_nombre),
      INDEX idx_pagos_proveedor_placa (placa)
    )
  `);

  if (!(await columnExists("pagos_proveedor", "pagada"))) {
    await queryWithRetry("ALTER TABLE pagos_proveedor ADD COLUMN pagada TINYINT(1) NOT NULL DEFAULT 0 AFTER partida_presupuestaria");
  }

  const [[montoColumn]] = await queryWithRetry(
    `SELECT NUMERIC_SCALE AS numeric_scale, NUMERIC_PRECISION AS numeric_precision
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'pagos_proveedor'
       AND COLUMN_NAME = 'monto'
     LIMIT 1`
  );
  if (Number(montoColumn?.numeric_scale || 0) < 4 || Number(montoColumn?.numeric_precision || 0) < 14) {
    await queryWithRetry("ALTER TABLE pagos_proveedor MODIFY COLUMN monto DECIMAL(14,4) NOT NULL DEFAULT 0");
  }

  if (!(await columnExists("pagos_proveedor", "periodo_cierre"))) {
    await queryWithRetry("ALTER TABLE pagos_proveedor ADD COLUMN periodo_cierre CHAR(7) NULL AFTER fecha_pago");
  }

  await queryWithRetry(`
    UPDATE pagos_proveedor
    SET pagada = 1,
        periodo_cierre = COALESCE(periodo_cierre, DATE_FORMAT(fecha_pago, '%Y-%m'))
    WHERE fecha_pago IS NOT NULL
      AND COALESCE(pagada, 0) = 0
  `);

  await queryWithRetry(`
    UPDATE pagos_proveedor
    SET periodo_cierre = DATE_FORMAT(COALESCE(fecha_pago, fecha_solicitud, DATE(creado_en)), '%Y-%m')
    WHERE periodo_cierre IS NULL
      AND (fecha_pago IS NOT NULL OR fecha_solicitud IS NOT NULL OR creado_en IS NOT NULL)
  `);
}

async function ensurePeriodoCierreColumns() {
  await ensurePagosProveedorTable();

  const columns = [
    ["ordenes_compra", "fecha_pago"],
    ["facturas", "fecha_pago"],
    ["ordenes_motor", "fecha_pago"]
  ];

  for (const [table, afterColumn] of columns) {
    if (!(await tableExists(table))) continue;
    if (table === "ordenes_motor") {
      if (!(await columnExists(table, "pagada"))) {
        await queryWithRetry("ALTER TABLE ordenes_motor ADD COLUMN pagada TINYINT(1) NOT NULL DEFAULT 0 AFTER estado");
      }
      if (!(await columnExists(table, "fecha_pago"))) {
        await queryWithRetry("ALTER TABLE ordenes_motor ADD COLUMN fecha_pago DATE NULL AFTER pagada");
      }
    }
    if (!(await columnExists(table, "periodo_cierre"))) {
      await queryWithRetry(`ALTER TABLE ${table} ADD COLUMN periodo_cierre CHAR(7) NULL AFTER ${afterColumn}`);
    }
    if (!(await columnExists(table, "monto_pagado_cierre"))) {
      await queryWithRetry(`ALTER TABLE ${table} ADD COLUMN monto_pagado_cierre DECIMAL(14,4) NULL AFTER periodo_cierre`);
    }
  }
}

async function ensureCajaChicaTable() {
  await queryWithRetry(`
    CREATE TABLE IF NOT EXISTS caja_chica_reintegros (
      id INT AUTO_INCREMENT PRIMARY KEY,
      fecha DATE NOT NULL,
      monto DECIMAL(14,2) NOT NULL DEFAULT 0,
      observacion TEXT NULL,
      creado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_caja_chica_fecha (fecha)
    )
  `);
}

async function ensureReintegroGastosTable() {
  await queryWithRetry(`
    CREATE TABLE IF NOT EXISTS reintegros_gastos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      fecha DATE NOT NULL,
      entregado_a VARCHAR(180) NOT NULL,
      numero_factura VARCHAR(100) NOT NULL,
      monto DECIMAL(14,2) NOT NULL DEFAULT 0,
      observacion TEXT NULL,
      creado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_reintegros_gastos_fecha (fecha),
      INDEX idx_reintegros_gastos_entregado_a (entregado_a),
      INDEX idx_reintegros_gastos_factura (numero_factura)
    )
  `);
}

async function ensureOrdenPlacaColumn() {
  if (!(await columnExists("ordenes_compra", "placa_unidad"))) {
    await queryWithRetry("ALTER TABLE ordenes_compra ADD COLUMN placa_unidad VARCHAR(50) NULL");
  }
}

async function ensureOrdenDetalleCodigoProductoColumn() {
  if (!(await columnExists("ordenes_compra_detalle", "codigo_producto"))) {
    await queryWithRetry("ALTER TABLE ordenes_compra_detalle ADD COLUMN codigo_producto VARCHAR(80) NULL AFTER codigo");
  }
}

async function ensureOrdenCotizacionColumns() {
  const columns = [
    ["cotizacion_archivo", "VARCHAR(255) NULL"],
    ["cotizacion_nombre", "VARCHAR(255) NULL"],
    ["cotizacion_tipo", "VARCHAR(100) NULL"]
  ];

  for (const [column, definition] of columns) {
    if (!(await columnExists("ordenes_compra", column))) {
      await queryWithRetry(`ALTER TABLE ordenes_compra ADD COLUMN ${column} ${definition}`);
    }
  }
}

function guardarFotoProducto(dataUrl, usuarioId) {
  if (!dataUrl) return null;

  const match = String(dataUrl).match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
  if (!match) {
    throw new Error("La foto del producto debe ser JPG, PNG o WEBP.");
  }

  const extension = match[1] === "jpeg" ? "jpg" : match[1];
  const buffer = Buffer.from(match[2], "base64");
  const maxBytes = 5 * 1024 * 1024;

  if (buffer.length > maxBytes) {
    throw new Error("La foto del producto supera 5 MB.");
  }

  const uploadDir = path.join(__dirname, "..", "..", "public", "uploads", "facturas");
  fs.mkdirSync(uploadDir, { recursive: true });

  const fileName = `producto_${Date.now()}_${usuarioId || "user"}_${Math.round(Math.random() * 1e6)}.${extension}`;
  fs.writeFileSync(path.join(uploadDir, fileName), buffer);

  return `/uploads/facturas/${fileName}`;
}

function guardarCotizacionOrden(dataUrl, originalName, mimeType, usuarioId) {
  if (!dataUrl) return null;

  const match = String(dataUrl).match(/^data:(application\/pdf|image\/jpeg|image\/jpg|image\/png|image\/webp);base64,(.+)$/);
  if (!match) {
    throw new Error("La cotización debe ser PDF, JPG, PNG o WEBP.");
  }

  const tipo = match[1];
  const extensionMap = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };
  const extension = extensionMap[tipo] || "bin";
  const buffer = Buffer.from(match[2], "base64");
  const maxBytes = 5 * 1024 * 1024;

  if (buffer.length > maxBytes) {
    throw new Error("La cotización supera 5 MB.");
  }

  const uploadDir = path.join(__dirname, "..", "..", "public", "uploads", "cotizaciones");
  fs.mkdirSync(uploadDir, { recursive: true });

  const fileName = `cotizacion_${Date.now()}_${usuarioId || "user"}_${Math.round(Math.random() * 1e6)}.${extension}`;
  fs.writeFileSync(path.join(uploadDir, fileName), buffer);

  return {
    archivo: `/uploads/cotizaciones/${fileName}`,
    nombre: String(originalName || `cotizacion.${extension}`).trim().slice(0, 255),
    tipo: String(mimeType || tipo).trim().slice(0, 100)
  };
}

function parseMonto(value) {
  const monto = parseFloat(value);
  return Number.isFinite(monto) ? monto : 0;
}

function valorCeldaExcel(cell) {
  if (!cell) return null;
  let value = cell.value;

  if (value && typeof value === "object") {
    if (value.result !== undefined) value = value.result;
    else if (value.text !== undefined) value = value.text;
    else if (value.richText) value = value.richText.map(item => item.text || "").join("");
    else if (value.hyperlink && value.text) value = value.text;
  }

  return value;
}

function textoCeldaExcel(cell) {
  const value = valorCeldaExcel(cell);
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function fechaExcelToSql(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const local = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (local) {
    const year = local[3].length === 2 ? `20${local[3]}` : local[3];
    return `${year}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function normalizarPeriodoCierre(value, fallbackDate = null) {
  const texto = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(texto)) return texto;

  const fechaFallback = fechaExcelToSql(fallbackDate);
  if (fechaFallback) return fechaFallback.slice(0, 7);

  return null;
}

function rangoFechasDesdePeriodo(periodo) {
  const limpio = normalizarPeriodoCierre(periodo);
  if (!limpio) return { desde: "", hasta: "" };

  const [year, month] = limpio.split("-").map(Number);
  const ultimoDia = new Date(year, month, 0).getDate();
  return {
    desde: `${limpio}-01`,
    hasta: `${limpio}-${String(ultimoDia).padStart(2, "0")}`
  };
}

function etiquetaPeriodoCierre(periodo) {
  const limpio = normalizarPeriodoCierre(periodo);
  if (!limpio) return "-";

  const [year, month] = limpio.split("-");
  const date = new Date(`${year}-${month}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return limpio;

  return date.toLocaleDateString("es-CR", { month: "long", year: "numeric" });
}

function parseMontoExcel(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let text = String(value || "").trim();
  if (!text) return 0;

  text = text
    .replace(/[₡$]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^\d,.-]/g, "");

  if (text.includes(",") && !text.includes(".")) {
    text = text.replace(",", ".");
  } else if (text.includes(",") && text.includes(".")) {
    text = text.replace(/,/g, "");
  }

  const monto = Number(text);
  return Number.isFinite(monto) ? monto : 0;
}

function normalizarEmpresaPago(value) {
  const texto = String(value || "").toUpperCase();
  if (texto.includes("SUPER")) return "SUPER GAS";
  if (texto.includes("TOMZA")) return "GAS TOMZA";
  return "";
}

function parsePagoProveedorDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Debe adjuntar un archivo Excel válido.");

  const mime = match[1];
  if (![
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/octet-stream"
  ].includes(mime)) {
    throw new Error("El archivo debe ser Excel (.xlsx o .xls).");
  }

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 8 * 1024 * 1024) {
    throw new Error("El archivo supera 8 MB.");
  }

  return buffer;
}

async function leerPagosProveedorExcel(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const pagos = [];

  workbook.worksheets.forEach(worksheet => {
    let empresaActual = "";
    let headerMap = null;

    worksheet.eachRow({ includeEmpty: false }, row => {
      const valoresNormalizados = row.values
        .slice(1)
        .map(value => String(value?.text || value?.result || value || "").trim());
      const textoFila = valoresNormalizados.filter(Boolean).join(" ");

      const empresaDetectada = normalizarEmpresaPago(textoFila);
      if (empresaDetectada) {
        empresaActual = empresaDetectada;
        headerMap = null;
        if (!textoCeldaExcel(row.getCell(1)).toLowerCase().includes("fecha")) return;
      }

      const pareceEncabezado = valoresNormalizados.some(value => normalizarTextoBusqueda(value).includes("fecha")) &&
        valoresNormalizados.some(value => normalizarTextoBusqueda(value).includes("proveedor") || normalizarTextoBusqueda(value).includes("provedor")) &&
        valoresNormalizados.some(value => normalizarTextoBusqueda(value).includes("factura"));

      if (pareceEncabezado) {
        headerMap = {};
        row.eachCell((cell, colNumber) => {
          const header = normalizarTextoBusqueda(textoCeldaExcel(cell));
          if (header.includes("fecha") && header.includes("solicitud")) headerMap.fechaSolicitud = colNumber;
          if (header.includes("proveedor") || header.includes("provedor")) headerMap.proveedor = colNumber;
          if (header.includes("cuenta") || header.includes("iban")) headerMap.cuentaIban = colNumber;
          if (header.includes("concepto")) headerMap.concepto = colNumber;
          if (header.includes("factura")) headerMap.numeroFactura = colNumber;
          if (header.includes("placa")) headerMap.placa = colNumber;
          if (header.includes("monto")) headerMap.monto = colNumber;
          if (header.includes("partida")) headerMap.partida = colNumber;
          if (header.includes("fecha") && header.includes("pago")) headerMap.fechaPago = colNumber;
        });
        return;
      }

      if (!headerMap) return;

      const filaNormalizada = normalizarTextoBusqueda(textoFila);
      if (
        filaNormalizada.includes("total solicitado") ||
        filaNormalizada.includes("total general") ||
        filaNormalizada.startsWith("notas:")
      ) {
        return;
      }

      const fechaSolicitudRaw = valorCeldaExcel(row.getCell(headerMap.fechaSolicitud || 1));
      const proveedor = textoCeldaExcel(row.getCell(headerMap.proveedor || 2));
      const cuentaIban = textoCeldaExcel(row.getCell(headerMap.cuentaIban || 3));
      const concepto = textoCeldaExcel(row.getCell(headerMap.concepto || 4));
      const numeroFactura = textoCeldaExcel(row.getCell(headerMap.numeroFactura || 5));
      const placa = normalizarPlaca(textoCeldaExcel(row.getCell(headerMap.placa || 6)));
      const monto = parseMontoExcel(valorCeldaExcel(row.getCell(headerMap.monto || 7)));
      const partida = textoCeldaExcel(row.getCell(headerMap.partida || 8));
      const fechaPagoRaw = valorCeldaExcel(row.getCell(headerMap.fechaPago || 9));

      if (!proveedor && !concepto && !monto) return;
      if (!proveedor || monto <= 0) return;
      if (normalizarTextoBusqueda(proveedor).includes("total solicitado")) return;

      pagos.push({
        empresa: empresaActual || "GAS TOMZA",
        fecha_solicitud: fechaExcelToSql(fechaSolicitudRaw),
        proveedor_nombre: proveedor,
        cuenta_iban: cuentaIban || null,
        concepto: concepto || null,
        numero_factura: numeroFactura || null,
        placa,
        monto,
        partida_presupuestaria: partida || null,
        fecha_pago: fechaExcelToSql(fechaPagoRaw)
      });
    });
  });

  return pagos;
}

function calcularSaldoFactura(monto, notaCredito = 0, abono = 0, pagada = 0) {
  const montoOriginal = parseMonto(monto);
  const notaCreditoMonto = Math.min(parseMonto(notaCredito), montoOriginal);
  const basePagar = Math.max(montoOriginal - notaCreditoMonto, 0);
  const abonoMonto = Math.min(parseMonto(abono), basePagar);
  const saldo = pagada ? 0 : Math.max(basePagar - abonoMonto, 0);

  return {
    montoOriginal,
    notaCreditoMonto,
    abonoMonto,
    basePagar,
    saldo
  };
}

function calcularMontoPagadoCierre(saldos, pagada = 0, montoPagadoCierre = null) {
  const montoCierre = parseMonto(montoPagadoCierre);
  if (montoCierre > 0) return montoCierre;
  if (saldos.abonoMonto > 0) return saldos.abonoMonto;
  return Number(pagada || 0) ? saldos.basePagar : 0;
}

function redirectFacturas(req, res) {
  const returnTo = String(req.body.return_to || "");
  if (returnTo.startsWith("/compras/facturas")) {
    return res.redirect(returnTo);
  }
  return res.redirect("/compras/facturas");
}

async function obtenerOrdenesDisponiblesFactura() {
  const [ordenesDisponibles] = await queryWithRetry(`
    SELECT
      o.id,
      o.po_numero,
      o.fecha,
      o.total,
      o.estado,
      p.nombre AS proveedor_nombre
    FROM ordenes_compra o
    JOIN proveedores p ON p.id = o.proveedor_id
    WHERE COALESCE(o.facturada, 0) = 0
    ORDER BY o.fecha DESC, o.id DESC
    LIMIT 300
  `);
  return ordenesDisponibles;
}

async function obtenerResumenPagosProveedor(filtros = {}) {
  await ensurePagosProveedorTable();

  const periodoCierre = normalizarPeriodoCierre(filtros.periodo_cierre);
  const where = [];
  const params = [];
  if (periodoCierre) {
    where.push("periodo_cierre = ?");
    params.push(periodoCierre);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const whereAndSql = where.length ? `AND ${where.join(" AND ")}` : "";

  const [totalesEmpresa] = await queryWithRetry(`
    SELECT
      empresa,
      COUNT(*) AS pagos,
      COALESCE(SUM(monto), 0) AS total,
      COALESCE(SUM(CASE WHEN COALESCE(pagada, 0) = 1 THEN monto ELSE 0 END), 0) AS total_pagado,
      COALESCE(SUM(CASE WHEN COALESCE(pagada, 0) = 0 THEN monto ELSE 0 END), 0) AS total_pendiente,
      SUM(CASE WHEN COALESCE(pagada, 0) = 1 THEN 1 ELSE 0 END) AS pagos_pagados,
      SUM(CASE WHEN COALESCE(pagada, 0) = 0 THEN 1 ELSE 0 END) AS pagos_pendientes
    FROM pagos_proveedor
    ${whereSql}
    GROUP BY empresa
    ORDER BY FIELD(empresa, 'GAS TOMZA', 'SUPER GAS'), empresa
  `, params);

  const [topProveedores] = await queryWithRetry(`
    SELECT proveedor_nombre, COUNT(*) AS pagos, COALESCE(SUM(monto), 0) AS total
    FROM pagos_proveedor
    WHERE COALESCE(pagada, 0) = 1
      ${whereAndSql}
    GROUP BY proveedor_nombre
    ORDER BY total DESC
    LIMIT 10
  `, params);

  const [pendientes] = await queryWithRetry(`
    SELECT *
    FROM pagos_proveedor
    WHERE COALESCE(pagada, 0) = 0
      ${whereAndSql}
    ORDER BY COALESCE(fecha_solicitud, DATE(creado_en)) ASC, id ASC
    LIMIT 500
  `, params);

  const [pagados] = await queryWithRetry(`
    SELECT *
    FROM pagos_proveedor
    WHERE COALESCE(pagada, 0) = 1
      ${whereAndSql}
    ORDER BY COALESCE(fecha_pago, fecha_solicitud, DATE(creado_en)) DESC, id DESC
    LIMIT 300
  `, params);

  const [[estado]] = await queryWithRetry(`
    SELECT
      COUNT(*) AS total_registros,
      COALESCE(SUM(monto), 0) AS total_general,
      SUM(CASE WHEN COALESCE(pagada, 0) = 1 THEN 1 ELSE 0 END) AS pagados,
      COALESCE(SUM(CASE WHEN COALESCE(pagada, 0) = 1 THEN monto ELSE 0 END), 0) AS total_pagado,
      SUM(CASE WHEN COALESCE(pagada, 0) = 0 THEN 1 ELSE 0 END) AS pendientes,
      COALESCE(SUM(CASE WHEN COALESCE(pagada, 0) = 0 THEN monto ELSE 0 END), 0) AS total_pendiente
    FROM pagos_proveedor
    ${whereSql}
  `, params);

  return {
    totalesEmpresa,
    topProveedores,
    recientes: pagados,
    pendientes,
    pagados,
    estado: estado || {},
    totalGeneral: totalesEmpresa.reduce((sum, item) => sum + Number(item.total || 0), 0),
    totalPagos: totalesEmpresa.reduce((sum, item) => sum + Number(item.pagos || 0), 0),
    totalPagado: Number(estado?.total_pagado || 0),
    totalPendiente: Number(estado?.total_pendiente || 0),
    pagosPagados: Number(estado?.pagados || 0),
    pagosPendientes: Number(estado?.pendientes || 0),
    periodo_cierre: periodoCierre
  };
}

async function obtenerCierrePagosProveedor(periodoCierre) {
  const periodo = normalizarPeriodoCierre(periodoCierre);
  if (!periodo) {
    return {
      periodo: "",
      titulo: "Pagos de cierre",
      totalGeneral: 0,
      totalOficial: null,
      diferencia: 0,
      movimientos: 0,
      proveedores: [],
      detalles: []
    };
  }

  const facturas = await obtenerFacturasCompras({
    periodo_cierre: periodo,
    pagada: "1",
    orden: "asc"
  });

  const proveedoresMap = new Map();
  const detalles = facturas.map(factura => {
    const proveedor = factura.proveedor_nombre || "Sin proveedor";
    if (!proveedoresMap.has(proveedor)) {
      proveedoresMap.set(proveedor, { proveedor, movimientos: 0, total: 0 });
    }

    const grupo = proveedoresMap.get(proveedor);
    const monto = parseMonto(factura.monto_pagado);
    grupo.movimientos += 1;
    grupo.total += monto;

    return {
      id: factura.id,
      proveedor_nombre: proveedor,
      numero_factura: factura.numero_factura,
      concepto: factura.po_numero ? `Orden ${factura.po_numero}` : (factura.factura_observacion || "Factura pagada"),
      fecha_pago: factura.fecha_pago,
      fecha_solicitud: factura.fecha,
      periodo_cierre: factura.periodo_cierre,
      placa: factura.factura_placa_producto,
      monto_pagado: monto,
      monto_original: parseMonto(factura.monto_original),
      fecha_factura: factura.fecha,
      origen_factura: factura.tipo === "orden" ? "Orden de compra" : "Factura"
    };
  });
  const totalGeneral = detalles.reduce((sum, pago) => sum + parseMonto(pago.monto_pagado), 0);

  const totalOficial = periodo === "2026-07" ? 62615263.92 : null;
  return {
    periodo,
    titulo: `Pagos ${etiquetaPeriodoCierre(periodo).toUpperCase()}`,
    totalGeneral,
    totalOficial,
    diferencia: totalOficial === null ? 0 : Number((totalGeneral - totalOficial).toFixed(2)),
    movimientos: detalles.length,
    proveedores: Array.from(proveedoresMap.values()).sort((a, b) => b.total - a.total || a.proveedor.localeCompare(b.proveedor, "es")),
    detalles
  };
}

function clavePagoFactura(proveedor, factura) {
  return `${normalizarClaveCierre(proveedor)}|${normalizarClaveCierre(factura)}`;
}

async function obtenerReferenciasFacturasPorPago(pagos = []) {
  const facturas = [...new Set(pagos.map(pago => normalizarClaveCierre(pago.numero_factura)).filter(Boolean))];
  if (!facturas.length) return new Map();

  const [rows] = await queryWithRetry(`
    SELECT proveedor_nombre, numero_factura, monto AS monto_original, fecha AS fecha_factura, 'Factura manual' AS origen
    FROM facturas
    WHERE numero_factura IS NOT NULL
      AND TRIM(numero_factura) <> ''
      AND REPLACE(REPLACE(REPLACE(UPPER(numero_factura), '-', ''), ' ', ''), '.', '') IN (?)
    UNION ALL
    SELECT p.nombre AS proveedor_nombre, o.factura AS numero_factura, o.total AS monto_original, COALESCE(o.factura_fecha, o.fecha) AS fecha_factura, 'Orden de compra' AS origen
    FROM ordenes_compra o
    LEFT JOIN proveedores p ON p.id = o.proveedor_id
    WHERE o.factura IS NOT NULL
      AND TRIM(o.factura) <> ''
      AND REPLACE(REPLACE(REPLACE(UPPER(o.factura), '-', ''), ' ', ''), '.', '') IN (?)
  `, [facturas, facturas]);

  const referencias = new Map();
  rows.forEach(row => {
    const key = clavePagoFactura(row.proveedor_nombre, row.numero_factura);
    if (!key.endsWith("|")) referencias.set(key, row);
  });

  return referencias;
}

async function existePagoProveedor(connection, pago) {
  const [rows] = await connection.query(
    `SELECT id
     FROM pagos_proveedor
     WHERE empresa = ?
       AND COALESCE(fecha_solicitud, '1000-01-01') = COALESCE(?, '1000-01-01')
       AND proveedor_nombre = ?
       AND COALESCE(concepto, '') = COALESCE(?, '')
       AND COALESCE(numero_factura, '') = COALESCE(?, '')
       AND COALESCE(placa, '') = COALESCE(?, '')
       AND monto = ?
     LIMIT 1`,
    [
      pago.empresa,
      pago.fecha_solicitud,
      pago.proveedor_nombre,
      pago.concepto,
      pago.numero_factura,
      pago.placa,
      pago.monto
    ]
  );

  return rows.length > 0;
}

async function obtenerResumenCajaChica() {
  await ensureCajaChicaTable();

  const [resumenRows] = await queryWithRetry(`
    SELECT
      COUNT(*) AS registros,
      COALESCE(SUM(monto), 0) AS total,
      COALESCE(SUM(CASE WHEN YEAR(fecha) = YEAR(CURDATE()) AND MONTH(fecha) = MONTH(CURDATE()) THEN monto ELSE 0 END), 0) AS total_mes
    FROM caja_chica_reintegros
  `);

  const [porMes] = await queryWithRetry(`
    SELECT DATE_FORMAT(fecha, '%Y-%m') AS mes, COUNT(*) AS registros, COALESCE(SUM(monto), 0) AS total
    FROM caja_chica_reintegros
    GROUP BY DATE_FORMAT(fecha, '%Y-%m')
    ORDER BY mes DESC
    LIMIT 12
  `);

  const [historial] = await queryWithRetry(`
    SELECT c.*, u.usuario AS creado_por_usuario
    FROM caja_chica_reintegros c
    LEFT JOIN usuarios u ON u.id = c.creado_por
    ORDER BY c.fecha DESC, c.id DESC
    LIMIT 300
  `);

  return {
    resumen: resumenRows[0] || { registros: 0, total: 0, total_mes: 0 },
    porMes,
    historial
  };
}

async function obtenerResumenReintegroGastos() {
  await ensureReintegroGastosTable();

  const [resumenRows] = await queryWithRetry(`
    SELECT
      COUNT(*) AS registros,
      COALESCE(SUM(monto), 0) AS total,
      COALESCE(SUM(CASE WHEN YEAR(fecha) = YEAR(CURDATE()) AND MONTH(fecha) = MONTH(CURDATE()) THEN monto ELSE 0 END), 0) AS total_mes
    FROM reintegros_gastos
  `);

  const [porMes] = await queryWithRetry(`
    SELECT DATE_FORMAT(fecha, '%Y-%m') AS mes, COUNT(*) AS registros, COALESCE(SUM(monto), 0) AS total
    FROM reintegros_gastos
    GROUP BY DATE_FORMAT(fecha, '%Y-%m')
    ORDER BY mes DESC
    LIMIT 12
  `);

  const [porPersona] = await queryWithRetry(`
    SELECT entregado_a, COUNT(*) AS registros, COALESCE(SUM(monto), 0) AS total
    FROM reintegros_gastos
    GROUP BY entregado_a
    ORDER BY total DESC, entregado_a ASC
    LIMIT 10
  `);

  const [historial] = await queryWithRetry(`
    SELECT r.*, u.usuario AS creado_por_usuario
    FROM reintegros_gastos r
    LEFT JOIN usuarios u ON u.id = r.creado_por
    ORDER BY r.fecha DESC, r.id DESC
    LIMIT 300
  `);

  return {
    resumen: resumenRows[0] || { registros: 0, total: 0, total_mes: 0 },
    porMes,
    porPersona,
    historial
  };
}

function agregarFiltroFecha(sqlParts, params, campoFecha, fechaDesde, fechaHasta) {
  if (fechaDesde) {
    sqlParts.push(`${campoFecha} >= ?`);
    params.push(fechaDesde);
  }
  if (fechaHasta) {
    sqlParts.push(`${campoFecha} <= ?`);
    params.push(fechaHasta);
  }
}

function periodoCierreDesdeRango(fechaDesde, fechaHasta) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaDesde || ""))) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaHasta || ""))) return null;

  const desde = String(fechaDesde).slice(0, 10);
  const hasta = String(fechaHasta).slice(0, 10);
  const periodo = desde.slice(0, 7);
  if (hasta.slice(0, 7) !== periodo || !desde.endsWith("-01")) return null;

  const [year, month] = periodo.split("-").map(Number);
  const ultimoDia = new Date(year, month, 0).getDate();
  return hasta.endsWith(`-${String(ultimoDia).padStart(2, "0")}`) ? periodo : null;
}

function agregarFiltroFechaConPeriodoCierre(sqlParts, params, campoFecha, campoPeriodo, fechaDesde, fechaHasta, periodoCierre) {
  const periodo = normalizarPeriodoCierre(periodoCierre) || periodoCierreDesdeRango(fechaDesde, fechaHasta);

  if (periodo) {
    sqlParts.push(`${campoPeriodo} = ?`);
    params.push(periodo);
    return periodo;
  }

  agregarFiltroFecha(sqlParts, params, campoFecha, fechaDesde, fechaHasta);
  return null;
}

function montoPagadoFacturaSql(alias, montoColumn) {
  const base = `GREATEST(COALESCE(${montoColumn}, 0) - COALESCE(${alias}.nota_credito_monto, 0), 0)`;
  return `CASE
    WHEN COALESCE(${alias}.monto_pagado_cierre, 0) > 0 THEN COALESCE(${alias}.monto_pagado_cierre, 0)
    WHEN COALESCE(${alias}.abono_monto, 0) > 0 THEN LEAST(COALESCE(${alias}.abono_monto, 0), ${base})
    ELSE ${base}
  END`;
}

async function obtenerDashboardFinancieroFacturas(filtros = {}) {
  await ensureFacturasSchema();
  await ensureCajaChicaTable();
  await ensureReintegroGastosTable();

  const { proveedor_id, periodo_cierre } = filtros;
  const periodoCierre = normalizarPeriodoCierre(periodo_cierre);
  const rangoPeriodo = rangoFechasDesdePeriodo(periodoCierre);
  const fecha_desde = filtros.fecha_desde || rangoPeriodo.desde;
  const fecha_hasta = filtros.fecha_hasta || rangoPeriodo.hasta;
  const whereOrdenes = [];
  const paramsOrdenes = [];
  agregarFiltroFecha(whereOrdenes, paramsOrdenes, "o.fecha", fecha_desde, fecha_hasta);
  if (proveedor_id) {
    whereOrdenes.push("o.proveedor_id = ?");
    paramsOrdenes.push(proveedor_id);
  }
  const whereOrdenesSql = whereOrdenes.length ? `WHERE ${whereOrdenes.join(" AND ")}` : "";

  const whereOrdenesMotor = [];
  const paramsOrdenesMotor = [];
  agregarFiltroFecha(whereOrdenesMotor, paramsOrdenesMotor, "om.fecha", fecha_desde, fecha_hasta);
  if (proveedor_id) {
    whereOrdenesMotor.push("om.proveedor_id = ?");
    paramsOrdenesMotor.push(proveedor_id);
  }
  const whereOrdenesMotorSql = whereOrdenesMotor.length ? `WHERE ${whereOrdenesMotor.join(" AND ")}` : "";

  const whereFacturasOrdenesPagadas = ["o.facturada = 1", "COALESCE(o.pagada, 0) = 1"];
  const paramsFacturasOrdenesPagadas = [];
  agregarFiltroFechaConPeriodoCierre(whereFacturasOrdenesPagadas, paramsFacturasOrdenesPagadas, "o.fecha_pago", "o.periodo_cierre", fecha_desde, fecha_hasta, periodoCierre);
  if (proveedor_id) {
    whereFacturasOrdenesPagadas.push("o.proveedor_id = ?");
    paramsFacturasOrdenesPagadas.push(proveedor_id);
  }
  const whereFacturasOrdenesPagadasSql = `WHERE ${whereFacturasOrdenesPagadas.join(" AND ")}`;

  const whereFacturasIndependientesPagadas = ["COALESCE(f.pagada, 0) = 1"];
  const paramsFacturasIndependientesPagadas = [];
  agregarFiltroFechaConPeriodoCierre(whereFacturasIndependientesPagadas, paramsFacturasIndependientesPagadas, "f.fecha_pago", "f.periodo_cierre", fecha_desde, fecha_hasta, periodoCierre);
  if (proveedor_id) {
    whereFacturasIndependientesPagadas.push("f.proveedor_id = ?");
    paramsFacturasIndependientesPagadas.push(proveedor_id);
  }
  const whereFacturasIndependientesPagadasSql = `WHERE ${whereFacturasIndependientesPagadas.join(" AND ")}`;

  const fechaPagoProveedor = "COALESCE(pp.fecha_pago, pp.fecha_solicitud, DATE(pp.creado_en))";
  const wherePagos = [];
  const paramsPagos = [];
  agregarFiltroFechaConPeriodoCierre(wherePagos, paramsPagos, fechaPagoProveedor, "pp.periodo_cierre", fecha_desde, fecha_hasta, periodoCierre);
  const wherePagosSql = wherePagos.length ? `WHERE ${wherePagos.join(" AND ")}` : "";
  const wherePagosPagadosSql = wherePagos.length
    ? `WHERE ${wherePagos.join(" AND ")} AND COALESCE(pp.pagada, 0) = 1`
    : "WHERE COALESCE(pp.pagada, 0) = 1";

  const whereCaja = [];
  const paramsCaja = [];
  agregarFiltroFecha(whereCaja, paramsCaja, "cc.fecha", fecha_desde, fecha_hasta);
  const whereCajaSql = whereCaja.length ? `WHERE ${whereCaja.join(" AND ")}` : "";

  const whereReintegros = [];
  const paramsReintegros = [];
  agregarFiltroFecha(whereReintegros, paramsReintegros, "rg.fecha", fecha_desde, fecha_hasta);
  const whereReintegrosSql = whereReintegros.length ? `WHERE ${whereReintegros.join(" AND ")}` : "";

  const [[ordenesResumen]] = await queryWithRetry(`
    SELECT COUNT(*) AS registros, COALESCE(SUM(total), 0) AS total
    FROM ordenes_compra o
    ${whereOrdenesSql}
  `, paramsOrdenes);

  const [[ordenesMotorResumen]] = await queryWithRetry(`
    SELECT COUNT(*) AS registros, COALESCE(SUM(total), 0) AS total
    FROM ordenes_motor om
    ${whereOrdenesMotorSql}
  `, paramsOrdenesMotor);

  const [[facturasPagadasResumen]] = await queryWithRetry(`
    SELECT COALESCE(SUM(monto_pagado), 0) AS total, COUNT(*) AS registros
    FROM (
      SELECT ${montoPagadoFacturaSql("o", "o.total")} AS monto_pagado
      FROM ordenes_compra o
      ${whereFacturasOrdenesPagadasSql}
      UNION ALL
      SELECT ${montoPagadoFacturaSql("f", "f.monto")} AS monto_pagado
      FROM facturas f
      ${whereFacturasIndependientesPagadasSql}
    ) facturas_pagadas
  `, [...paramsFacturasOrdenesPagadas, ...paramsFacturasIndependientesPagadas]);

  const [[pagosResumen]] = await queryWithRetry(`
    SELECT COUNT(*) AS registros, COALESCE(SUM(monto), 0) AS total
    FROM pagos_proveedor pp
    ${wherePagosSql}
  `, paramsPagos);

  const [[pagosPagadosResumen]] = await queryWithRetry(`
    SELECT COUNT(*) AS registros, COALESCE(SUM(monto), 0) AS total
    FROM pagos_proveedor pp
    ${wherePagosPagadosSql}
  `, paramsPagos);

  const [[cajaResumen]] = await queryWithRetry(`
    SELECT COUNT(*) AS registros, COALESCE(SUM(monto), 0) AS total
    FROM caja_chica_reintegros cc
    ${whereCajaSql}
  `, paramsCaja);

  const [[reintegrosResumen]] = await queryWithRetry(`
    SELECT COUNT(*) AS registros, COALESCE(SUM(monto), 0) AS total
    FROM reintegros_gastos rg
    ${whereReintegrosSql}
  `, paramsReintegros);

  const [ordenesMes] = await queryWithRetry(`
    SELECT DATE_FORMAT(o.fecha, '%Y-%m') AS mes, COUNT(*) AS registros, COALESCE(SUM(o.total), 0) AS total
    FROM ordenes_compra o
    ${whereOrdenesSql}
    GROUP BY DATE_FORMAT(o.fecha, '%Y-%m')
  `, paramsOrdenes);

  const [ordenesMotorMes] = await queryWithRetry(`
    SELECT DATE_FORMAT(om.fecha, '%Y-%m') AS mes, COUNT(*) AS registros, COALESCE(SUM(om.total), 0) AS total
    FROM ordenes_motor om
    ${whereOrdenesMotorSql}
    GROUP BY DATE_FORMAT(om.fecha, '%Y-%m')
  `, paramsOrdenesMotor);

  const [pagosMes] = await queryWithRetry(`
    SELECT COALESCE(pp.periodo_cierre, DATE_FORMAT(${fechaPagoProveedor}, '%Y-%m')) AS mes, COUNT(*) AS registros, COALESCE(SUM(pp.monto), 0) AS total
    FROM pagos_proveedor pp
    ${wherePagosSql}
    GROUP BY COALESCE(pp.periodo_cierre, DATE_FORMAT(${fechaPagoProveedor}, '%Y-%m'))
  `, paramsPagos);

  const [cajaMes] = await queryWithRetry(`
    SELECT DATE_FORMAT(cc.fecha, '%Y-%m') AS mes, COUNT(*) AS registros, COALESCE(SUM(cc.monto), 0) AS total
    FROM caja_chica_reintegros cc
    ${whereCajaSql}
    GROUP BY DATE_FORMAT(cc.fecha, '%Y-%m')
  `, paramsCaja);

  const [reintegrosMes] = await queryWithRetry(`
    SELECT DATE_FORMAT(rg.fecha, '%Y-%m') AS mes, COUNT(*) AS registros, COALESCE(SUM(rg.monto), 0) AS total
    FROM reintegros_gastos rg
    ${whereReintegrosSql}
    GROUP BY DATE_FORMAT(rg.fecha, '%Y-%m')
  `, paramsReintegros);

  const porMesMap = new Map();
  const asegurarMes = (mes) => {
    const key = mes || "Sin fecha";
    if (!porMesMap.has(key)) {
      porMesMap.set(key, { mes: key, ordenes: 0, pagosProveedor: 0, cajaChica: 0, reintegrosGastos: 0, total: 0 });
    }
    return porMesMap.get(key);
  };

  ordenesMes.forEach(row => {
    const item = asegurarMes(row.mes);
    item.ordenes += Number(row.total || 0);
    item.total += Number(row.total || 0);
  });
  ordenesMotorMes.forEach(row => {
    const item = asegurarMes(row.mes);
    item.ordenesMotor = (item.ordenesMotor || 0) + Number(row.total || 0);
    item.total += Number(row.total || 0);
  });
  pagosMes.forEach(row => {
    const item = asegurarMes(row.mes);
    item.pagosProveedor += Number(row.total || 0);
    item.total += Number(row.total || 0);
  });
  cajaMes.forEach(row => {
    const item = asegurarMes(row.mes);
    item.cajaChica += Number(row.total || 0);
    item.total += Number(row.total || 0);
  });
  reintegrosMes.forEach(row => {
    const item = asegurarMes(row.mes);
    item.reintegrosGastos += Number(row.total || 0);
    item.total += Number(row.total || 0);
  });

  const totalOrdenes = Number(ordenesResumen?.total || 0);
  const totalOrdenesMotor = Number(ordenesMotorResumen?.total || 0);
  const totalOrdenesMotorPagadas = totalOrdenesMotor;
  const totalFacturasPagadas = Number(facturasPagadasResumen?.total || 0);
  const totalPagosProveedor = Number(pagosResumen?.total || 0);
  const totalPagosProveedorPagados = Number(pagosPagadosResumen?.total || 0);
  const totalCajaChica = Number(cajaResumen?.total || 0);
  const totalReintegrosGastos = Number(reintegrosResumen?.total || 0);
  const porTipo = [
    { tipo: "Ordenes de compra", total: totalOrdenes, registros: Number(ordenesResumen?.registros || 0), color: "#0f3b82" },
    { tipo: "Ordenes motor", total: totalOrdenesMotor, registros: Number(ordenesMotorResumen?.registros || 0), color: "#ea580c" },
    { tipo: "Pago de proveedor", total: totalPagosProveedor, registros: Number(pagosResumen?.registros || 0), color: "#0ea5e9" },
    { tipo: "Caja chica", total: totalCajaChica, registros: Number(cajaResumen?.registros || 0), color: "#f59e0b" },
    { tipo: "Reintegro de gastos", total: totalReintegrosGastos, registros: Number(reintegrosResumen?.registros || 0), color: "#7c3aed" }
  ];

  return {
    resumen: {
      totalOrdenes,
      totalOrdenesMotor,
      totalOrdenesMotorPagadas,
      totalFacturasPagadas,
      totalPagosProveedor,
      totalPagosProveedorPagados,
      totalCajaChica,
      totalReintegrosGastos,
      totalPagado: totalFacturasPagadas + totalOrdenesMotor + totalPagosProveedorPagados + totalCajaChica,
      totalGeneral: totalOrdenes + totalOrdenesMotor + totalPagosProveedor + totalCajaChica + totalReintegrosGastos,
      registros: porTipo.reduce((sum, item) => sum + item.registros, 0)
    },
    porTipo,
    porMes: Array.from(porMesMap.values()).sort((a, b) => a.mes.localeCompare(b.mes, "es"))
  };
}

function construirConsultaFacturas(filtros = {}, modo = "full") {
  const { proveedor_id, fecha_desde, fecha_hasta, pagada, vencida, periodo_cierre } = filtros;
  const selectOrdenes = modo === "count"
    ? "o.id, 'orden' as tipo, COALESCE(o.factura_fecha, o.fecha) as fecha"
    : `
      o.id,
      o.po_numero,
      COALESCE(o.factura_fecha, o.fecha) as fecha,
      o.total as monto,
      o.factura as numero_factura,
      o.fecha_vencimiento_factura,
      o.pagada,
      o.fecha_pago,
      o.periodo_cierre,
      o.monto_pagado_cierre,
      o.abono_monto,
      o.abono_fecha,
      o.abono_observacion,
      o.factura_fecha_recepcion,
      o.factura_tipo_entrega,
      o.factura_entregado_por,
      o.factura_recibido_por,
      o.factura_producto_recibido,
      o.factura_observacion,
      o.factura_foto_producto,
      o.factura_placa_producto,
      o.nota_credito_numero,
      o.nota_credito_fecha,
      o.nota_credito_monto,
      o.nota_credito_motivo,
      o.proveedor_id,
      p.nombre as proveedor_nombre,
      'orden' as tipo
    `;
  const selectIndependientes = modo === "count"
    ? "f.id, 'independiente' as tipo, f.fecha"
    : `
      f.id,
      NULL as po_numero,
      f.fecha,
      f.monto,
      f.numero_factura,
      NULL as fecha_vencimiento_factura,
      f.pagada,
      f.fecha_pago,
      f.periodo_cierre,
      f.monto_pagado_cierre,
      f.abono_monto,
      f.abono_fecha,
      f.abono_observacion,
      f.factura_fecha_recepcion,
      f.factura_tipo_entrega,
      f.factura_entregado_por,
      f.factura_recibido_por,
      f.factura_producto_recibido,
      f.factura_observacion,
      f.factura_foto_producto,
      f.factura_placa_producto,
      f.nota_credito_numero,
      f.nota_credito_fecha,
      f.nota_credito_monto,
      f.nota_credito_motivo,
      f.proveedor_id,
      f.proveedor_nombre,
      'independiente' as tipo
    `;

  let sqlOrdenes = `
    SELECT ${selectOrdenes}
    FROM ordenes_compra o
    JOIN proveedores p ON p.id = o.proveedor_id
    WHERE o.facturada = 1
  `;
  let sqlIndependientes = `
    SELECT ${selectIndependientes}
    FROM facturas f
    WHERE 1=1
  `;
  const paramsOrdenes = [];
  const paramsIndependientes = [];

  if (proveedor_id && proveedor_id !== "") {
    sqlOrdenes += ` AND o.proveedor_id = ?`;
    sqlIndependientes += ` AND f.proveedor_id = ?`;
    paramsOrdenes.push(proveedor_id);
    paramsIndependientes.push(proveedor_id);
  }
  if (fecha_desde && fecha_desde !== "") {
    sqlOrdenes += ` AND COALESCE(o.factura_fecha, o.fecha) >= ?`;
    sqlIndependientes += ` AND f.fecha >= ?`;
    paramsOrdenes.push(fecha_desde);
    paramsIndependientes.push(fecha_desde);
  }
  if (fecha_hasta && fecha_hasta !== "") {
    sqlOrdenes += ` AND COALESCE(o.factura_fecha, o.fecha) <= ?`;
    sqlIndependientes += ` AND f.fecha <= ?`;
    paramsOrdenes.push(fecha_hasta);
    paramsIndependientes.push(fecha_hasta);
  }
  const periodoCierre = normalizarPeriodoCierre(periodo_cierre);
  if (periodoCierre) {
    sqlOrdenes += ` AND o.periodo_cierre = ?`;
    sqlIndependientes += ` AND f.periodo_cierre = ?`;
    paramsOrdenes.push(periodoCierre);
    paramsIndependientes.push(periodoCierre);
  }
  if (pagada !== undefined && pagada !== "") {
    const pagadaVal = pagada === "1" ? 1 : 0;
    sqlOrdenes += ` AND COALESCE(o.pagada, 0) = ?`;
    sqlIndependientes += ` AND COALESCE(f.pagada, 0) = ?`;
    paramsOrdenes.push(pagadaVal);
    paramsIndependientes.push(pagadaVal);
  }

  if (vencida === "1") {
    sqlOrdenes += ` AND COALESCE(o.pagada, 0) = 0 AND o.fecha_vencimiento_factura IS NOT NULL AND o.fecha_vencimiento_factura < CURDATE()`;
    sqlIndependientes += ` AND 1 = 0`;
  }

  return {
    sqlOrdenes,
    sqlIndependientes,
    params: [...paramsOrdenes, ...paramsIndependientes]
  };
}

function normalizarPaginacionFacturas({ pagina, por_pagina } = {}) {
  const paginaActual = Math.max(parseInt(pagina || "1", 10) || 1, 1);
  const porPagina = Math.min(Math.max(parseInt(por_pagina || "100", 10) || 100, 25), 300);
  return {
    pagina: paginaActual,
    porPagina,
    offset: (paginaActual - 1) * porPagina
  };
}

async function contarFacturasCompras(filtros = {}) {
  const { sqlOrdenes, sqlIndependientes, params } = construirConsultaFacturas(filtros, "count");
  const [[row]] = await queryWithRetry(
    `SELECT COUNT(*) AS total FROM ((${sqlOrdenes}) UNION ALL (${sqlIndependientes})) facturas_total`,
    params
  );
  return Number(row?.total || 0);
}

async function obtenerFacturasCompras(filtros = {}) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const orden = filtros.orden === "asc" ? "asc" : "desc";
  const { sqlOrdenes, sqlIndependientes, params } = construirConsultaFacturas(filtros);
  const orderDirection = orden === "asc" ? "ASC" : "DESC";
  let finalSql = `(${sqlOrdenes}) UNION ALL (${sqlIndependientes}) ORDER BY fecha ${orderDirection}, id ${orderDirection}`;
  const queryParams = [...params];
  const limit = parseInt(filtros.limit, 10);
  const offset = parseInt(filtros.offset, 10);

  if (Number.isFinite(limit) && limit > 0) {
    finalSql += ` LIMIT ? OFFSET ?`;
    queryParams.push(Math.min(limit, 500), Number.isFinite(offset) && offset > 0 ? offset : 0);
  }

  const [facturasUnidas] = await queryWithRetry(finalSql, queryParams);

  const facturasConEstado = facturasUnidas.map(f => {
    const saldos = calcularSaldoFactura(f.monto, f.nota_credito_monto, f.abono_monto, f.pagada);
    const montoPagado = calcularMontoPagadoCierre(saldos, f.pagada, f.monto_pagado_cierre);
    return {
      ...f,
      monto_original: saldos.montoOriginal,
      nota_credito_monto: saldos.notaCreditoMonto,
      abono_monto: saldos.abonoMonto,
      monto_pagado: montoPagado,
      saldo: saldos.saldo,
      cubierta_por_nc: saldos.notaCreditoMonto > 0 && saldos.basePagar <= 0,
      tiene_nc: saldos.notaCreditoMonto > 0 || Boolean(f.nota_credito_numero),
      tiene_abono: saldos.abonoMonto > 0,
      vencida: (f.tipo === "orden" && !f.pagada && saldos.saldo > 0 && f.fecha_vencimiento_factura && new Date(f.fecha_vencimiento_factura) < hoy)
    };
  });

  return facturasConEstado;
}

function agruparFacturasPendientesPorProveedor(facturas = []) {
  return Array.from(facturas.reduce((map, factura) => {
    const proveedorNombre = factura.proveedor_nombre || "Sin proveedor";
    if (!map.has(proveedorNombre)) {
      map.set(proveedorNombre, {
        proveedor: proveedorNombre,
        facturas: [],
        totales: {
          montoOriginal: 0,
          notasCredito: 0,
          abonos: 0,
          pagado: 0,
          saldo: 0
        }
      });
    }

    const grupo = map.get(proveedorNombre);
    grupo.facturas.push(factura);
    grupo.totales.montoOriginal += parseMonto(factura.monto_original ?? factura.monto);
    grupo.totales.notasCredito += parseMonto(factura.nota_credito_monto);
    grupo.totales.abonos += parseMonto(factura.abono_monto);
    grupo.totales.pagado += parseMonto(factura.monto_pagado);
    grupo.totales.saldo += parseMonto(factura.saldo);

    return map;
  }, new Map()).values()).sort((a, b) =>
    b.totales.saldo - a.totales.saldo ||
    a.proveedor.localeCompare(b.proveedor, "es")
  );
}

function calcularTotalesFacturas(facturas = []) {
  return facturas.reduce((acc, f) => {
    acc.montoOriginal += parseMonto(f.monto_original ?? f.monto);
    acc.notasCredito += parseMonto(f.nota_credito_monto);
    acc.abonos += parseMonto(f.abono_monto);
    acc.pagado += parseMonto(f.monto_pagado);
    acc.saldo += parseMonto(f.saldo);
    acc.vencidas += f.vencida ? 1 : 0;
    return acc;
  }, {
    montoOriginal: 0,
    notasCredito: 0,
    abonos: 0,
    pagado: 0,
    saldo: 0,
    vencidas: 0
  });
}

function normalizarFiltroPagadaReporte(value) {
  const limpio = String(value ?? "").trim();
  return limpio === "0" || limpio === "1" ? limpio : "";
}

function obtenerMetaReporteFacturas(pagada = "") {
  if (pagada === "0") {
    return {
      titulo: "Facturas pendientes por pagar",
      descripcion: "pendiente",
      archivo: "reporte_facturas_pendientes",
      hoja: "Pendientes",
      totalEtiqueta: "Total pendiente",
      columnaResumen: "Saldo",
      totalClave: "saldo",
      vacio: "No hay cuentas pendientes por pagar."
    };
  }

  if (pagada === "1") {
    return {
      titulo: "Facturas pagadas",
      descripcion: "pagada",
      archivo: "reporte_facturas_pagadas",
      hoja: "Pagadas",
      totalEtiqueta: "Total pagado",
      columnaResumen: "Pagado",
      totalClave: "pagado",
      vacio: "No hay facturas pagadas para los filtros seleccionados."
    };
  }

  return {
    titulo: "Reporte general de facturas",
    descripcion: "registrada",
    archivo: "reporte_facturas",
    hoja: "Facturas",
    totalEtiqueta: "Total facturado",
    columnaResumen: "Monto original",
    totalClave: "montoOriginal",
    vacio: "No hay facturas para los filtros seleccionados."
  };
}

function formatDateCR(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("es-CR");
}

function formatMoneyCR(value) {
  return Number(value || 0).toLocaleString("es-CR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function pdfStreamToBuffer(pdfDoc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    pdfDoc.on("data", chunk => chunks.push(chunk));
    pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
    pdfDoc.on("error", reject);
    pdfDoc.end();
  });
}

async function generarPDFFacturasPendientes({ gruposProveedor, facturas, filtros, totales, fechaGeneracion, metaReporte }) {
  const meta = metaReporte || obtenerMetaReporteFacturas("0");
  const printer = new PdfPrinter(PDF_FONTS);
  const body = [
    [
      { text: "Proveedor", style: "tableHeader" },
      { text: meta.columnaResumen, style: "tableHeader", alignment: "right" }
    ]
  ];

  gruposProveedor.forEach(grupo => {
    body.push([
      { text: grupo.proveedor, bold: true },
      { text: `CRC ${formatMoneyCR(grupo.totales[meta.totalClave])}`, alignment: "right", bold: true }
    ]);
  });

  if (!gruposProveedor.length) {
    body.push([{ text: meta.vacio, colSpan: 2, alignment: "center", color: "#64748b", margin: [0, 12, 0, 12] }, {}]);
  } else {
    body.push([
      { text: "Total general", bold: true, fillColor: "#dcfce7", color: "#14532d" },
      { text: `CRC ${formatMoneyCR(totales[meta.totalClave])}`, alignment: "right", bold: true, fillColor: "#dcfce7", color: "#14532d" }
    ]);
  }

  const docDefinition = {
    pageSize: "LETTER",
    pageOrientation: "landscape",
    pageMargins: [24, 24, 24, 28],
    defaultStyle: { font: "Helvetica", fontSize: 7.2, color: "#111827" },
    footer: (currentPage, pageCount) => ({
      text: `Pagina ${currentPage} de ${pageCount}`,
      alignment: "right",
      margin: [0, 0, 24, 0],
      fontSize: 7,
      color: "#64748b"
    }),
    content: [
      {
        columns: [
          [
            { text: meta.titulo, fontSize: 16, bold: true },
            { text: "Gas Tomza - Sistema de compras", color: "#64748b", margin: [0, 2, 0, 0] }
          ],
          [
            { text: `Generado: ${fechaGeneracion}`, alignment: "right", bold: true },
            { text: `${facturas.length} factura${facturas.length === 1 ? "" : "s"} ${meta.descripcion}${facturas.length === 1 ? "" : "s"}`, alignment: "right", color: "#64748b" }
          ]
        ],
        margin: [0, 0, 0, 10]
      },
      {
        table: {
          widths: ["*", "*", "*", "*", "*"],
          body: [[
            { text: `Proveedor: ${filtros.proveedor_nombre || "Todos"}`, style: "filterBox" },
            { text: `Desde: ${filtros.fecha_desde || "-"}`, style: "filterBox" },
            { text: `Hasta: ${filtros.fecha_hasta || "-"}`, style: "filterBox" },
            { text: `Periodo: ${etiquetaPeriodoCierre(filtros.periodo_cierre)}`, style: "filterBox" },
            { text: `Solo vencidas: ${filtros.vencida === "1" ? "Si" : "No"}`, style: "filterBox" }
          ]]
        },
        layout: "noBorders",
        margin: [0, 0, 0, 8]
      },
      {
        table: {
          headerRows: 1,
          widths: ["*", 120],
          body
        },
        layout: {
          hLineColor: () => "#cbd5e1",
          vLineColor: () => "#e2e8f0",
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          paddingLeft: () => 3,
          paddingRight: () => 3,
          paddingTop: () => 3,
          paddingBottom: () => 3
        }
      },
      { text: `${meta.totalEtiqueta}: CRC ${formatMoneyCR(totales[meta.totalClave])}`, alignment: "right", fontSize: 11, bold: true, color: "#14532d", margin: [0, 10, 0, 0] }
    ],
    styles: {
      tableHeader: { fillColor: "#111827", color: "#ffffff", bold: true, fontSize: 7 },
      filterBox: { fillColor: "#f8fafc", margin: [4, 4, 4, 4], bold: true },
      totalBox: { fillColor: "#f8fafc", margin: [4, 5, 4, 5], bold: true },
      totalBoxMain: { fillColor: "#dcfce7", color: "#14532d", margin: [4, 5, 4, 5], bold: true }
    }
  };

  return pdfStreamToBuffer(printer.createPdfKitDocument(docDefinition));
}

// ===================== FUNCIÓN PARA GENERAR NÚMERO DE PO =====================
async function generarNumeroPO() {
  const año = new Date().getFullYear();
  const [rows] = await pool.query(
    "SELECT po_numero FROM ordenes_compra WHERE po_numero LIKE ? ORDER BY id DESC LIMIT 1",
    [`${año}-%`]
  );
  let consecutivo = 1;
  if (rows.length > 0) {
    const ultimo = rows[0].po_numero;
    const num = parseInt(ultimo.split('-')[1]);
    consecutivo = num + 1;
  }
  return `${año}-${consecutivo.toString().padStart(3, '0')}`;
}

function construirConsultaOrdenes(filtros = {}) {
  const { proveedor_id, fecha_desde, fecha_hasta, po_numero, placa_unidad, estado, facturada } = filtros;
  let sql = `
    SELECT o.*, p.nombre as proveedor_nombre
    FROM ordenes_compra o
    JOIN proveedores p ON p.id = o.proveedor_id
    WHERE 1=1
  `;
  const params = [];

  if (proveedor_id && proveedor_id !== '') {
    sql += ` AND o.proveedor_id = ?`;
    params.push(proveedor_id);
  }
  if (fecha_desde && fecha_desde !== '') {
    sql += ` AND o.fecha >= ?`;
    params.push(fecha_desde);
  }
  if (fecha_hasta && fecha_hasta !== '') {
    sql += ` AND o.fecha <= ?`;
    params.push(fecha_hasta);
  }
  if (po_numero && po_numero !== '') {
    sql += ` AND o.po_numero LIKE ?`;
    params.push(`%${po_numero}%`);
  }
  const placaFiltro = normalizarPlaca(placa_unidad);
  if (placaFiltro) {
    const condicionesPlaca = [];
    agregarFiltroPlacaSql(condicionesPlaca, params, "o.placa_unidad", placaFiltro);
    if (condicionesPlaca.length) {
      sql += ` AND ${condicionesPlaca[0]}`;
    }
  }
  if (estado && estado !== '') {
    sql += ` AND o.estado = ?`;
    params.push(estado);
  }
  if (facturada !== undefined && facturada !== '') {
    sql += ` AND o.facturada = ?`;
    params.push(facturada === '1' ? 1 : 0);
  }

  sql += ` ORDER BY o.fecha DESC, o.id DESC`;
  return { sql, params };
}

async function obtenerOrdenesReporteCompleto(filtros = {}) {
  const { sql, params } = construirConsultaOrdenes(filtros);
  let [ordenes] = await pool.query(sql, params);

  if (!ordenes.length) return [];

  const ordenIds = ordenes.map(orden => orden.id);
  const placeholders = ordenIds.map(() => "?").join(",");
  let [lineas] = await pool.query(
    `SELECT orden_compra_id, codigo, codigo_producto, descripcion, cantidad, precio_unitario, subtotal
     FROM ordenes_compra_detalle
     WHERE orden_compra_id IN (${placeholders})
     ORDER BY orden_compra_id, id`,
    ordenIds
  );

  const placasReporte = new Set();
  ordenes.forEach(orden => {
    const placa = normalizarPlaca(orden.placa_unidad);
    if (placa && placa !== "GENERALES TALLER") placasReporte.add(placa);
  });
  lineas.forEach(linea => {
    const placa = normalizarPlaca(linea.codigo);
    if (placa && placa !== "GENERALES TALLER") placasReporte.add(placa);
  });

  const sedePorPlaca = new Map();
  if (placasReporte.size) {
    const [unidadesReporte] = await pool.query("SELECT placa, sede FROM unidades");
    unidadesReporte.forEach(unidad => {
      const placa = normalizarPlaca(unidad.placa);
      if (placa && placasReporte.has(placa)) sedePorPlaca.set(placa, unidad.sede || "");
    });
  }

  lineas = lineas.map(linea => {
    const placaNormalizada = normalizarPlaca(linea.codigo);
    return {
      ...linea,
      placa_normalizada: placaNormalizada,
      sede_resuelta: placaNormalizada ? sedePorPlaca.get(placaNormalizada) || "" : ""
    };
  });

  const lineasPorOrden = lineas.reduce((map, linea) => {
    if (!map.has(linea.orden_compra_id)) map.set(linea.orden_compra_id, []);
    map.get(linea.orden_compra_id).push(linea);
    return map;
  }, new Map());

  ordenes = ordenes.map(orden => ({
    ...orden,
    placa_normalizada: normalizarPlaca(orden.placa_unidad),
    sede_resuelta: sedePorPlaca.get(normalizarPlaca(orden.placa_unidad)) || "",
    lineas: lineasPorOrden.get(orden.id) || []
  }));

  return ordenes;
}

function excelDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pintarFilaHeader(row, color = "FF111827") {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.height = 22;
}

function aplicarBordesWorksheet(worksheet) {
  worksheet.eachRow(row => {
    row.eachCell(cell => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } }
      };
      cell.alignment = cell.alignment || { vertical: "middle" };
    });
  });
}

function estadoFacturaOrden(orden) {
  if (orden.facturada || orden.factura) return "Facturada";
  return "Sin factura";
}

function resumenPreciosUnitariosOrden(orden) {
  const lineas = Array.isArray(orden.lineas) ? orden.lineas : [];
  if (!lineas.length) return "-";

  return lineas.map(linea => {
    const codigo = linea.codigo ? `${linea.codigo} · ` : "";
    const descripcion = String(linea.descripcion || "Sin descripcion").trim();
    const cantidad = parseMonto(linea.cantidad);
    const precio = parseMonto(linea.precio_unitario);
    return `${codigo}${descripcion}: ${cantidad.toLocaleString("es-CR")} x ₡${precio.toLocaleString("es-CR", { maximumFractionDigits: 2 })}`;
  }).join("\n");
}

function textoExcelLimpio(value, fallback = "-") {
  const texto = String(value || "").replace(/\s+/g, " ").trim();
  return texto || fallback;
}

function agruparOrdenesPorDescripcion(ordenes = []) {
  const grupos = new Map();

  ordenes.forEach(orden => {
    const lineas = Array.isArray(orden.lineas) ? orden.lineas : [];

    lineas.forEach(linea => {
      const descripcion = textoExcelLimpio(linea.descripcion, "Sin descripcion");
      const clave = descripcion.toUpperCase();
      const cantidad = parseMonto(linea.cantidad);
      const precio = parseMonto(linea.precio_unitario);
      const subtotal = parseMonto(linea.subtotal) || cantidad * precio;
      const fecha = excelDate(orden.fecha);

      if (!grupos.has(clave)) {
        grupos.set(clave, {
          descripcion,
          categorias: new Set(),
          sedes: new Set(),
          codigos: new Set(),
          codigosProducto: new Set(),
          proveedores: new Set(),
          ordenes: new Set(),
          cantidadTotal: 0,
          vecesComprado: 0,
          montoTotal: 0,
          precioMin: null,
          precioMax: null,
          ultimoPrecio: 0,
          ultimaFecha: null,
          ultimoProveedor: "-"
        });
      }

      const grupo = grupos.get(clave);
      const placaLinea = normalizarPlaca(linea.codigo) || normalizarPlaca(orden.placa_unidad);
      const sedeLinea = linea.sede_resuelta || orden.sede_resuelta || "";
      grupo.categorias.add(clasificarPlacaCompra(placaLinea, sedeLinea));
      if (sedeLinea) grupo.sedes.add(textoExcelLimpio(sedeLinea));
      grupo.codigos.add(textoExcelLimpio(linea.codigo));
      grupo.codigosProducto.add(textoExcelLimpio(linea.codigo_producto, ""));
      grupo.proveedores.add(textoExcelLimpio(orden.proveedor_nombre));
      grupo.ordenes.add(textoExcelLimpio(orden.po_numero));
      grupo.cantidadTotal += cantidad;
      grupo.vecesComprado += 1;
      grupo.montoTotal += subtotal;

      if (precio > 0) {
        grupo.precioMin = grupo.precioMin === null ? precio : Math.min(grupo.precioMin, precio);
        grupo.precioMax = grupo.precioMax === null ? precio : Math.max(grupo.precioMax, precio);
      }

      if (fecha && (!grupo.ultimaFecha || fecha > grupo.ultimaFecha)) {
        grupo.ultimaFecha = fecha;
        grupo.ultimoPrecio = precio;
        grupo.ultimoProveedor = textoExcelLimpio(orden.proveedor_nombre);
      }
    });
  });

  return Array.from(grupos.values())
    .map(grupo => ({
      ...grupo,
      categoriasTexto: Array.from(grupo.categorias).filter(Boolean).join(", ") || "Otros",
      sedesTexto: Array.from(grupo.sedes).filter(Boolean).join(", ") || "-",
      codigosTexto: Array.from(grupo.codigos).filter(Boolean).join(", ") || "-",
      codigosProductoTexto: Array.from(grupo.codigosProducto).filter(Boolean).join(", ") || "-",
      proveedoresTexto: Array.from(grupo.proveedores).filter(Boolean).join(", ") || "-",
      ordenesTexto: Array.from(grupo.ordenes).filter(Boolean).join(", ") || "-",
      ordenesCantidad: grupo.ordenes.size,
      precioPromedio: grupo.cantidadTotal > 0 ? grupo.montoTotal / grupo.cantidadTotal : 0,
      precioMin: grupo.precioMin || 0,
      precioMax: grupo.precioMax || 0
    }))
    .sort((a, b) => a.descripcion.localeCompare(b.descripcion, "es", { sensitivity: "base" }));
}

// ===================== PROVEEDORES =====================
router.get("/proveedores", requireAuth, allowRoles("ADMIN", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    const [proveedores] = await pool.query("SELECT * FROM proveedores ORDER BY nombre");
    res.render("compras/proveedores", { proveedores, user: req.session.user });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error cargando proveedores");
  }
});

router.get("/proveedores/nuevo", requireAuth, allowRoles("ADMIN", "PROVEEDURIA_TALLER"), (req, res) => {
  res.render("compras/proveedor_form", { proveedor: null, user: req.session.user });
});

router.get("/proveedores/editar/:id", requireAuth, allowRoles("ADMIN", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    const [[proveedor]] = await pool.query("SELECT * FROM proveedores WHERE id = ?", [req.params.id]);
    if (!proveedor) return res.status(404).send("Proveedor no encontrado");
    res.render("compras/proveedor_form", { proveedor, user: req.session.user });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error cargando proveedor");
  }
});

router.post("/proveedores", requireAuth, allowRoles("ADMIN", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    const { id, nombre, direccion, telefono, email, contacto, cedula_juridica } = req.body;
    if (id) {
      await pool.query(
        "UPDATE proveedores SET nombre=?, direccion=?, telefono=?, email=?, contacto=?, cedula_juridica=? WHERE id=?",
        [nombre, direccion, telefono, email, contacto, cedula_juridica || null, id]
      );
    } else {
      await pool.query(
        "INSERT INTO proveedores (nombre, direccion, telefono, email, contacto, cedula_juridica) VALUES (?,?,?,?,?,?)",
        [nombre, direccion, telefono, email, contacto, cedula_juridica || null]
      );
    }
    res.redirect("/compras/proveedores");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error guardando proveedor");
  }
});

router.get("/proveedores/eliminar/:id", requireAuth, allowRoles("ADMIN", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    await pool.query("DELETE FROM proveedores WHERE id = ?", [req.params.id]);
    res.redirect("/compras/proveedores");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error eliminando proveedor");
  }
});

// ===================== ÓRDENES DE COMPRA =====================
router.get("/ordenes/nueva", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    await ensureOrdenPlacaColumn();
    await ensureOrdenDetalleCodigoProductoColumn();
    await ensureOrdenCotizacionColumns();
    await ensureTipoMantenimientoColumns(pool);
    const [proveedores] = await pool.query("SELECT id, nombre FROM proveedores ORDER BY nombre");
    const siguientePO = await generarNumeroPO();
    res.render("compras/orden_form", {
      orden: null,
      lineas: [],
      proveedores,
      user: req.session.user,
      siguientePO,
      fechaActual: new Date().toISOString().slice(0, 10)
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error cargando formulario");
  }
});

router.get("/ordenes/:id/editar", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    await ensureOrdenPlacaColumn();
    await ensureOrdenDetalleCodigoProductoColumn();
    await ensureOrdenCotizacionColumns();
    await ensureTipoMantenimientoColumns(pool);
    const id = req.params.id;
    const [[orden]] = await pool.query("SELECT * FROM ordenes_compra WHERE id = ?", [id]);
    if (!orden) return res.status(404).send("Orden no encontrada");

    const [proveedores] = await pool.query("SELECT id, nombre FROM proveedores ORDER BY nombre");
    const [lineas] = await pool.query("SELECT * FROM ordenes_compra_detalle WHERE orden_compra_id = ? ORDER BY id", [id]);

    res.render("compras/orden_form", {
      orden,
      lineas,
      proveedores,
      user: req.session.user,
      siguientePO: orden.po_numero,
      fechaActual: orden.fecha
    });
  } catch (error) {
    console.error("Error cargando orden para editar:", error);
    res.status(500).send("Error cargando orden");
  }
});

router.post("/ordenes", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await ensureOrdenPlacaColumn();
    await ensureOrdenDetalleCodigoProductoColumn();
    await ensureOrdenCotizacionColumns();
    await ensureTipoMantenimientoColumns(pool);
    await connection.beginTransaction();

    const po_numero = await generarNumeroPO();
    const fecha = new Date().toISOString().slice(0, 10);

    const { proveedor_id, forma_pago, moneda, placa_unidad, lineas, observaciones, empresa_destino, cotizacion_data, cotizacion_nombre, cotizacion_tipo } = req.body;
    const tipoMantenimiento = normalizarTipoMantenimiento(req.body.tipo_mantenimiento);
    const lineasOrden = normalizarLineas(lineas);
    const placaOrden = obtenerPlacaOrden(lineasOrden, placa_unidad);
    const cotizacion = guardarCotizacionOrden(cotizacion_data, cotizacion_nombre, cotizacion_tipo, req.session.user.id);

    if (!lineasOrden.length) {
      await connection.rollback();
      return res.status(400).send("Debe agregar al menos una línea a la orden");
    }

    const totalesOrden = calcularTotalesOrden(lineasOrden, req.body);

    const [result] = await connection.query(
      `INSERT INTO ordenes_compra
       (po_numero, fecha, proveedor_id, forma_pago, moneda, placa_unidad, tipo_mantenimiento, subtotal, descuento, transporte, iva, total, observaciones, cotizacion_archivo, cotizacion_nombre, cotizacion_tipo, creado_por, estado, empresa_destino)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'BORRADOR', ?)`,
      [
        po_numero,
        fecha,
        proveedor_id,
        forma_pago,
        moneda,
        placaOrden,
        tipoMantenimiento,
        totalesOrden.subtotal,
        totalesOrden.descuento,
        totalesOrden.transporte,
        totalesOrden.iva,
        totalesOrden.total,
        observaciones || null,
        cotizacion ? cotizacion.archivo : null,
        cotizacion ? cotizacion.nombre : null,
        cotizacion ? cotizacion.tipo : null,
        req.session.user.id,
        empresa_destino || 'GAS TOMZA'
      ]
    );
    const ordenId = result.insertId;

    for (const linea of lineasOrden) {
      await connection.query(
        `INSERT INTO ordenes_compra_detalle
         (orden_compra_id, codigo, codigo_producto, descripcion, cantidad, precio_unitario, subtotal)
         VALUES (?,?,?,?,?,?,?)`,
        [ordenId, linea.codigo, linea.codigo_producto || null, linea.descripcion, linea.cantidad, linea.precio_unitario, linea.subtotal]
      );
    }
    await connection.commit();
    res.redirect("/compras/ordenes");
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).send("Error guardando orden");
  } finally {
    connection.release();
  }
});

router.post("/ordenes/:id/editar", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await ensureOrdenPlacaColumn();
    await ensureOrdenDetalleCodigoProductoColumn();
    await ensureOrdenCotizacionColumns();
    await ensureTipoMantenimientoColumns(pool);
    await connection.beginTransaction();

    const id = req.params.id;
    const { proveedor_id, forma_pago, moneda, placa_unidad, lineas, observaciones, empresa_destino, cotizacion_data, cotizacion_nombre, cotizacion_tipo } = req.body;
    const tipoMantenimiento = normalizarTipoMantenimiento(req.body.tipo_mantenimiento);
    const lineasOrden = normalizarLineas(lineas);
    const placaOrden = obtenerPlacaOrden(lineasOrden, placa_unidad);
    const cotizacion = guardarCotizacionOrden(cotizacion_data, cotizacion_nombre, cotizacion_tipo, req.session.user.id);

    if (!lineasOrden.length) {
      await connection.rollback();
      return res.status(400).send("Debe agregar al menos una línea a la orden");
    }

    const totalesOrden = calcularTotalesOrden(lineasOrden, req.body);

    const [[orden]] = await connection.query("SELECT id FROM ordenes_compra WHERE id = ?", [id]);
    if (!orden) {
      await connection.rollback();
      return res.status(404).send("Orden no encontrada");
    }

    let updateSql = `UPDATE ordenes_compra
       SET proveedor_id = ?,
           forma_pago = ?,
           moneda = ?,
           placa_unidad = ?,
           tipo_mantenimiento = ?,
           subtotal = ?,
           descuento = ?,
           transporte = ?,
           iva = ?,
           total = ?,
           observaciones = ?,
           empresa_destino = ?
    `;
    const updateParams = [
      proveedor_id,
      forma_pago,
      moneda,
      placaOrden,
      tipoMantenimiento,
      totalesOrden.subtotal,
      totalesOrden.descuento,
      totalesOrden.transporte,
      totalesOrden.iva,
      totalesOrden.total,
      observaciones || null,
      empresa_destino || 'GAS TOMZA'
    ];

    if (cotizacion) {
      updateSql += `,
           cotizacion_archivo = ?,
           cotizacion_nombre = ?,
           cotizacion_tipo = ?
      `;
      updateParams.push(cotizacion.archivo, cotizacion.nombre, cotizacion.tipo);
    }

    updateSql += " WHERE id = ?";
    updateParams.push(id);

    await connection.query(updateSql, updateParams);

    await connection.query("DELETE FROM ordenes_compra_detalle WHERE orden_compra_id = ?", [id]);

    for (const linea of lineasOrden) {
      await connection.query(
        `INSERT INTO ordenes_compra_detalle
         (orden_compra_id, codigo, codigo_producto, descripcion, cantidad, precio_unitario, subtotal)
         VALUES (?,?,?,?,?,?,?)`,
        [id, linea.codigo, linea.codigo_producto || null, linea.descripcion, linea.cantidad, linea.precio_unitario, linea.subtotal]
      );
    }

    await connection.commit();
    res.redirect(`/compras/ordenes/${id}/detalle`);
  } catch (error) {
    await connection.rollback();
    console.error("Error editando orden:", error);
    res.status(500).send("Error editando orden");
  } finally {
    connection.release();
  }
});

router.get("/ordenes", requireAuth, allowRoles(...ROLES_VER_ORDENES), async (req, res) => {
  try {
    await ensureOrdenPlacaColumn();
    await ensureOrdenDetalleCodigoProductoColumn();
    await ensureOrdenCotizacionColumns();
    const { proveedor_id, fecha_desde, fecha_hasta, po_numero, placa_unidad, estado, facturada } = req.query;
    const { sql, params } = construirConsultaOrdenes({ proveedor_id, fecha_desde, fecha_hasta, po_numero, placa_unidad, estado, facturada });

    const [ordenes] = await pool.query(sql, params);
    const [proveedores] = await pool.query("SELECT id, nombre FROM proveedores ORDER BY nombre");
    const estados = ['BORRADOR', 'ENVIADA', 'RECIBIDA_PARCIAL', 'RECIBIDA_TOTAL'];

    let totalFiltrado = 0;
    ordenes.forEach(o => totalFiltrado += parseFloat(o.total) || 0);
    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("compras/ordenes", {
      ordenes,
      user: req.session.user,
      proveedores,
      estados,
      filtros: { proveedor_id, fecha_desde, fecha_hasta, po_numero, placa_unidad, estado, facturada },
      totalFiltrado,
      success,
      error,
      hoy: new Date().toISOString().slice(0, 10)
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error");
  }
});

router.get("/ordenes/reporte/pdf", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    await ensureOrdenPlacaColumn();
    await ensureOrdenDetalleCodigoProductoColumn();
    await ensureOrdenCotizacionColumns();
    const { proveedor_id, fecha_desde, fecha_hasta, po_numero, placa_unidad, estado, facturada } = req.query;
    const filtros = { proveedor_id, fecha_desde, fecha_hasta, po_numero, placa_unidad, estado, facturada };
    const { sql, params } = construirConsultaOrdenes(filtros);
    let [ordenes] = await pool.query(sql, params);

    if (ordenes.length) {
      const ordenIds = ordenes.map(orden => orden.id);
      const placeholders = ordenIds.map(() => "?").join(",");
      const [lineas] = await pool.query(
        `SELECT orden_compra_id, codigo, codigo_producto, descripcion, cantidad, precio_unitario, subtotal
         FROM ordenes_compra_detalle
         WHERE orden_compra_id IN (${placeholders})
         ORDER BY orden_compra_id, id`,
        ordenIds
      );

      const lineasPorOrden = lineas.reduce((map, linea) => {
        if (!map.has(linea.orden_compra_id)) map.set(linea.orden_compra_id, []);
        map.get(linea.orden_compra_id).push(linea);
        return map;
      }, new Map());

      ordenes = ordenes.map(orden => ({
        ...orden,
        lineas: lineasPorOrden.get(orden.id) || []
      }));
    }

    const [[proveedorFiltro]] = proveedor_id
      ? await pool.query("SELECT nombre FROM proveedores WHERE id = ?", [proveedor_id])
      : [[null]];

    const totalFiltrado = ordenes.reduce((sum, orden) => sum + (parseFloat(orden.total) || 0), 0);
    const ejs = require("ejs");
    const path = require("path");
    const fs = require("fs");
    const pdf = require("html-pdf");
    const tmpDir = path.join(process.cwd(), "tmp");
    fs.mkdirSync(tmpDir, { recursive: true });

    const html = await ejs.renderFile(path.join(__dirname, "../views/compras/ordenes_reporte_pdf.ejs"), {
      ordenes,
      filtros: {
        ...filtros,
        proveedor_nombre: proveedorFiltro ? proveedorFiltro.nombre : null
      },
      totalFiltrado,
      fechaGeneracion: new Date().toLocaleString("es-CR")
    });

    pdf.create(html, { format: "Letter", orientation: "landscape", border: "8mm", directory: tmpDir }).toBuffer((err, buffer) => {
      if (err) {
        console.error("Error generando reporte de órdenes:", err);
        return res.status(500).send("Error al generar reporte");
      }
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=reporte_ordenes_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.pdf`);
      res.send(buffer);
    });
  } catch (error) {
    console.error("Error descargando reporte de órdenes:", error);
    res.status(500).send("Error descargando reporte");
  }
});

router.get("/ordenes/reporte/excel", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    await ensureOrdenPlacaColumn();
    await ensureOrdenDetalleCodigoProductoColumn();
    await ensureOrdenCotizacionColumns();

    const { proveedor_id, fecha_desde, fecha_hasta, po_numero, placa_unidad, estado, facturada } = req.query;
    const filtros = { proveedor_id, fecha_desde, fecha_hasta, po_numero, placa_unidad, estado, facturada };
    const ordenes = await obtenerOrdenesReporteCompleto(filtros);

    const [[proveedorFiltro]] = proveedor_id
      ? await pool.query("SELECT nombre FROM proveedores WHERE id = ?", [proveedor_id])
      : [[null]];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Gas Tomza";
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.views = [{ activeTab: 0 }];

    const totalFiltrado = ordenes.reduce((sum, orden) => sum + (parseMonto(orden.total) || 0), 0);
    const totalSubtotal = ordenes.reduce((sum, orden) => sum + (parseMonto(orden.subtotal) || 0), 0);
    const totalDescuento = ordenes.reduce((sum, orden) => sum + (parseMonto(orden.descuento) || 0), 0);
    const totalTransporte = ordenes.reduce((sum, orden) => sum + (parseMonto(orden.transporte) || 0), 0);
    const totalRecibidas = ordenes.filter(orden => orden.estado === "RECIBIDA_TOTAL" || orden.estado === "RECIBIDA_PARCIAL").length;
    const totalFacturadas = ordenes.filter(orden => orden.facturada || orden.factura).length;
    const productosPorDescripcion = agruparOrdenesPorDescripcion(ordenes);

    const wsProductos = workbook.addWorksheet("Productos", {
      views: [{ state: "frozen", ySplit: 1 }]
    });
    wsProductos.columns = [
      { header: "Categoria", key: "categoria", width: 18 },
      { header: "Sede", key: "sede", width: 22 },
      { header: "Descripcion", key: "descripcion", width: 48 },
      { header: "Placas", key: "codigos", width: 32 },
      { header: "Codigos producto", key: "codigos_producto", width: 24 },
      { header: "Cantidad total", key: "cantidad_total", width: 16 },
      { header: "Veces comprado", key: "veces_comprado", width: 16 },
      { header: "Ordenes", key: "ordenes_cantidad", width: 12 },
      { header: "Precio minimo", key: "precio_min", width: 16 },
      { header: "Precio promedio", key: "precio_promedio", width: 18 },
      { header: "Ultimo precio", key: "ultimo_precio", width: 16 },
      { header: "Precio maximo", key: "precio_max", width: 16 },
      { header: "Monto total", key: "monto_total", width: 16 },
      { header: "Ultima compra", key: "ultima_fecha", width: 14 },
      { header: "Ultimo proveedor", key: "ultimo_proveedor", width: 30 },
      { header: "Proveedores", key: "proveedores", width: 42 },
      { header: "PO relacionados", key: "ordenes", width: 42 }
    ];
    pintarFilaHeader(wsProductos.getRow(1), "FF0B3B82");

    productosPorDescripcion.forEach(producto => {
      const row = wsProductos.addRow({
        categoria: producto.categoriasTexto,
        sede: producto.sedesTexto,
        descripcion: producto.descripcion,
        codigos: producto.codigosTexto,
        codigos_producto: producto.codigosProductoTexto,
        cantidad_total: producto.cantidadTotal,
        veces_comprado: producto.vecesComprado,
        ordenes_cantidad: producto.ordenesCantidad,
        precio_min: producto.precioMin,
        precio_promedio: producto.precioPromedio,
        ultimo_precio: producto.ultimoPrecio,
        precio_max: producto.precioMax,
        monto_total: producto.montoTotal,
        ultima_fecha: producto.ultimaFecha,
        ultimo_proveedor: producto.ultimoProveedor,
        proveedores: producto.proveedoresTexto,
        ordenes: producto.ordenesTexto
      });
      [8, 9, 10, 11, 12].forEach(col => {
        row.getCell(col).numFmt = '"CRC" #,##0.00';
      });
      row.getCell(13).numFmt = "yyyy-mm-dd";
      [1, 2, 3, 4, 14, 15, 16].forEach(col => {
        row.getCell(col).alignment = { wrapText: true, vertical: "top" };
      });
    });
    wsProductos.autoFilter = { from: "A1", to: "P1" };

    const wsOrdenes = workbook.addWorksheet("Ordenes", {
      views: [{ state: "frozen", ySplit: 1 }]
    });
    wsOrdenes.columns = [
      { header: "PO", key: "po", width: 15 },
      { header: "Fecha", key: "fecha", width: 13 },
      { header: "Proveedor", key: "proveedor", width: 30 },
      { header: "Placa / general", key: "placa", width: 17 },
      { header: "Estado", key: "estado", width: 18 },
      { header: "Factura", key: "factura", width: 18 },
      { header: "Forma pago", key: "forma_pago", width: 18 },
      { header: "Moneda", key: "moneda", width: 14 },
      { header: "Empresa destinataria", key: "empresa", width: 28 },
      { header: "Lineas", key: "lineas", width: 10 },
      { header: "Subtotal", key: "subtotal", width: 15 },
      { header: "Descuento", key: "descuento", width: 15 },
      { header: "Transporte", key: "transporte", width: 15 },
      { header: "IVA (%)", key: "iva", width: 10 },
      { header: "Total", key: "total", width: 16 },
      { header: "Precio unitario / detalle", key: "precios_unitarios", width: 62 },
      { header: "Observaciones", key: "observaciones", width: 52 }
    ];
    pintarFilaHeader(wsOrdenes.getRow(1));

    ordenes.forEach(orden => {
      const row = wsOrdenes.addRow({
        po: orden.po_numero,
        fecha: excelDate(orden.fecha),
        proveedor: orden.proveedor_nombre,
        placa: orden.placa_unidad || "-",
        estado: String(orden.estado || "").replaceAll("_", " "),
        factura: orden.factura || estadoFacturaOrden(orden),
        forma_pago: orden.forma_pago || "-",
        moneda: orden.moneda || "-",
        empresa: orden.empresa_destino || "-",
        lineas: Array.isArray(orden.lineas) ? orden.lineas.length : 0,
        subtotal: parseMonto(orden.subtotal),
        descuento: parseMonto(orden.descuento),
        transporte: parseMonto(orden.transporte),
        iva: parseMonto(orden.iva),
        total: parseMonto(orden.total),
        precios_unitarios: resumenPreciosUnitariosOrden(orden),
        observaciones: orden.observaciones || "-"
      });
      row.getCell(2).numFmt = "yyyy-mm-dd";
      [11, 12, 13, 15].forEach(col => {
        row.getCell(col).numFmt = '"CRC" #,##0.00';
      });
      row.getCell(16).alignment = { wrapText: true, vertical: "top" };
      row.getCell(17).alignment = { wrapText: true, vertical: "top" };
    });
    wsOrdenes.autoFilter = { from: "A1", to: "Q1" };

    const wsCompleto = workbook.addWorksheet("Órdenes completas", {
      views: [{ showGridLines: false }]
    });
    wsCompleto.columns = [
      { width: 16 },
      { width: 13 },
      { width: 30 },
      { width: 17 },
      { width: 18 },
      { width: 18 },
      { width: 18 },
      { width: 48 },
      { width: 12 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 48 }
    ];

    wsCompleto.mergeCells("A1:M1");
    wsCompleto.getCell("A1").value = "Órdenes de compra completas";
    wsCompleto.getCell("A1").font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
    wsCompleto.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };
    wsCompleto.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF071A44" } };
    wsCompleto.getRow(1).height = 30;

    wsCompleto.addRow([]);

    if (!ordenes.length) {
      const emptyRow = wsCompleto.addRow(["No hay órdenes con los filtros seleccionados."]);
      wsCompleto.mergeCells(emptyRow.number, 1, emptyRow.number, 13);
      emptyRow.font = { bold: true, color: { argb: "FF64748B" } };
      emptyRow.alignment = { horizontal: "center" };
    }

    ordenes.forEach((orden, index) => {
      const tituloRow = wsCompleto.addRow([
        `Orden ${index + 1}: PO ${orden.po_numero || "-"} · ${orden.proveedor_nombre || "-"} · Total ₡${parseMonto(orden.total).toLocaleString("es-CR", { maximumFractionDigits: 2 })}`
      ]);
      wsCompleto.mergeCells(tituloRow.number, 1, tituloRow.number, 13);
      tituloRow.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
      tituloRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3B82" } };

      const metaRow = wsCompleto.addRow([
        "Fecha", excelDate(orden.fecha),
        "Proveedor", orden.proveedor_nombre || "-",
        "Placa / general", orden.placa_unidad || "-",
        "Estado", String(orden.estado || "").replaceAll("_", " "),
        "Factura", orden.factura || estadoFacturaOrden(orden),
        "Forma pago", orden.forma_pago || "-"
      ]);
      metaRow.getCell(1).font = { bold: true, color: { argb: "FF475569" } };
      metaRow.getCell(3).font = { bold: true, color: { argb: "FF475569" } };
      metaRow.getCell(5).font = { bold: true, color: { argb: "FF475569" } };
      metaRow.getCell(7).font = { bold: true, color: { argb: "FF475569" } };
      metaRow.getCell(9).font = { bold: true, color: { argb: "FF475569" } };
      metaRow.getCell(11).font = { bold: true, color: { argb: "FF475569" } };
      metaRow.getCell(2).numFmt = "yyyy-mm-dd";

      const lineHeader = wsCompleto.addRow([
        "PO", "Fecha", "Proveedor", "Placa", "Estado", "Factura", "Placa línea", "Código",
        "Descripción", "Cantidad", "Precio unitario", "Subtotal línea", "Total orden", "Observaciones"
      ]);
      pintarFilaHeader(lineHeader, "FF111827");

      const lineas = orden.lineas.length
        ? orden.lineas
        : [{ codigo: orden.placa_unidad, codigo_producto: "", descripcion: "Orden sin detalle de líneas", cantidad: 1, precio_unitario: orden.total, subtotal: orden.total }];

      lineas.forEach(linea => {
        const row = wsCompleto.addRow([
          orden.po_numero || "-",
          excelDate(orden.fecha),
          orden.proveedor_nombre || "-",
          orden.placa_unidad || "-",
          String(orden.estado || "").replaceAll("_", " "),
          orden.factura || estadoFacturaOrden(orden),
          linea.codigo || "-",
          linea.codigo_producto || "-",
          linea.descripcion || "-",
          parseMonto(linea.cantidad),
          parseMonto(linea.precio_unitario),
          parseMonto(linea.subtotal),
          parseMonto(orden.total),
          orden.observaciones || "-"
        ]);
        row.getCell(2).numFmt = "yyyy-mm-dd";
        [11, 12, 13].forEach(col => {
          row.getCell(col).numFmt = '"CRC" #,##0.00';
        });
        row.getCell(9).alignment = { wrapText: true, vertical: "top" };
        row.getCell(14).alignment = { wrapText: true, vertical: "top" };
      });

      const totalRow = wsCompleto.addRow([
        "", "", "", "", "", "", "", "", "Total de la orden",
        "", "", "", parseMonto(orden.total), orden.observaciones || "-"
      ]);
      totalRow.font = { bold: true, color: { argb: "FF14532D" } };
      totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
      totalRow.getCell(13).numFmt = '"CRC" #,##0.00';
      totalRow.getCell(14).alignment = { wrapText: true, vertical: "top" };
      wsCompleto.addRow([]);
    });

    const resumen = workbook.addWorksheet("Resumen", {
      views: [{ showGridLines: false }]
    });
    resumen.columns = [
      { width: 26 },
      { width: 28 },
      { width: 24 },
      { width: 24 },
      { width: 24 },
      { width: 24 }
    ];

    resumen.mergeCells("A1:F1");
    resumen.getCell("A1").value = "Reporte de órdenes de compra";
    resumen.getCell("A1").font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
    resumen.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };
    resumen.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF071A44" } };
    resumen.getRow(1).height = 30;

    resumen.addRow([]);
    const metaRows = [
      ["Generado", new Date(), "Proveedor", proveedorFiltro ? proveedorFiltro.nombre : "Todos", "Estado", estado || "Todos"],
      ["Desde", fecha_desde || "-", "Hasta", fecha_hasta || "-", "Facturada", facturada === "1" ? "Si" : facturada === "0" ? "No" : "Todas"],
      ["PO", po_numero || "-", "Placa", placa_unidad || "-", "Órdenes", ordenes.length]
    ];
    metaRows.forEach(values => resumen.addRow(values));
    resumen.getCell("B3").numFmt = "yyyy-mm-dd hh:mm";
    ["A3", "C3", "E3", "A4", "C4", "E4", "A5", "C5", "E5"].forEach(cell => {
      resumen.getCell(cell).font = { bold: true, color: { argb: "FF475569" } };
    });

    resumen.addRow([]);
    const kpiHeader = resumen.addRow(["Indicador", "Valor", "", "Indicador", "Valor", ""]);
    pintarFilaHeader(kpiHeader, "FF0B3B82");
    const kpiRows = [
      ["Total órdenes", ordenes.length, "", "Monto total", totalFiltrado, ""],
      ["Subtotal", totalSubtotal, "", "Descuento", totalDescuento, ""],
      ["Transporte", totalTransporte, "", "Recibidas", totalRecibidas, ""],
      ["Facturadas", totalFacturadas, "", "Pendientes de recibir", Math.max(ordenes.length - totalRecibidas, 0), ""]
    ];
    kpiRows.forEach(values => {
      const row = resumen.addRow(values);
      row.getCell(1).font = { bold: true };
      row.getCell(4).font = { bold: true };
      if (["Subtotal", "Transporte"].includes(values[0])) row.getCell(2).numFmt = '"CRC" #,##0.00';
      if (["Monto total", "Descuento"].includes(values[3])) row.getCell(5).numFmt = '"CRC" #,##0.00';
    });

    resumen.addRow([]);
    const ordenTitle = resumen.addRow(["Resumen por orden"]);
    resumen.mergeCells(ordenTitle.number, 1, ordenTitle.number, 6);
    ordenTitle.font = { bold: true, size: 13, color: { argb: "FF071A44" } };
    const ordenHeader = resumen.addRow(["PO", "Fecha", "Proveedor", "Placa", "Estado", "Total"]);
    pintarFilaHeader(ordenHeader, "FF111827");
    ordenes.forEach(orden => {
      const row = resumen.addRow([
        orden.po_numero || "-",
        excelDate(orden.fecha),
        orden.proveedor_nombre || "-",
        orden.placa_unidad || "-",
        String(orden.estado || "").replaceAll("_", " "),
        parseMonto(orden.total)
      ]);
      row.getCell(2).numFmt = "yyyy-mm-dd";
      row.getCell(6).numFmt = '"CRC" #,##0.00';
    });

    const wsDetalle = workbook.addWorksheet("Detalle completo", {
      views: [{ state: "frozen", ySplit: 1 }]
    });
    wsDetalle.columns = [
      { header: "PO", key: "po", width: 15 },
      { header: "Fecha", key: "fecha", width: 13 },
      { header: "Proveedor", key: "proveedor", width: 30 },
      { header: "Estado orden", key: "estado", width: 18 },
      { header: "Factura", key: "factura", width: 18 },
      { header: "Placa orden", key: "placa_orden", width: 17 },
      { header: "Placa línea", key: "codigo", width: 18 },
      { header: "Código", key: "codigo_producto", width: 18 },
      { header: "Descripción", key: "descripcion", width: 45 },
      { header: "Cantidad", key: "cantidad", width: 12 },
      { header: "Precio unitario", key: "precio", width: 16 },
      { header: "Subtotal línea", key: "subtotal", width: 16 },
      { header: "Total orden", key: "total_orden", width: 16 },
      { header: "Observaciones", key: "observaciones", width: 48 }
    ];
    pintarFilaHeader(wsDetalle.getRow(1));

    ordenes.forEach(orden => {
      const lineas = orden.lineas.length ? orden.lineas : [{ codigo: orden.placa_unidad, codigo_producto: "", descripcion: "Orden sin detalle de líneas", cantidad: 1, precio_unitario: orden.total, subtotal: orden.total }];
      lineas.forEach(linea => {
        const row = wsDetalle.addRow({
          po: orden.po_numero,
          fecha: excelDate(orden.fecha),
          proveedor: orden.proveedor_nombre,
          estado: String(orden.estado || "").replaceAll("_", " "),
          factura: orden.factura || estadoFacturaOrden(orden),
          placa_orden: orden.placa_unidad || "-",
          codigo: linea.codigo || "-",
          codigo_producto: linea.codigo_producto || "-",
          descripcion: linea.descripcion || "-",
          cantidad: parseMonto(linea.cantidad),
          precio: parseMonto(linea.precio_unitario),
          subtotal: parseMonto(linea.subtotal),
          total_orden: parseMonto(orden.total),
          observaciones: orden.observaciones || "-"
        });
        row.getCell(2).numFmt = "yyyy-mm-dd";
        [11, 12, 13].forEach(col => {
          row.getCell(col).numFmt = '"CRC" #,##0.00';
        });
        row.getCell(9).alignment = { wrapText: true, vertical: "top" };
        row.getCell(14).alignment = { wrapText: true, vertical: "top" };
      });
    });
    wsDetalle.autoFilter = { from: "A1", to: "N1" };

    [wsProductos, wsOrdenes, wsCompleto, resumen, wsDetalle].forEach(worksheet => {
      aplicarBordesWorksheet(worksheet);
      worksheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=reporte_ordenes_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.xlsx`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Error descargando Excel de órdenes:", error);
    res.status(500).send("Error descargando Excel de órdenes");
  }
});

router.get("/ordenes/:id/detalle", requireAuth, allowRoles(...ROLES_VER_ORDENES), async (req, res) => {
  try {
    await ensureOrdenPlacaColumn();
    await ensureOrdenDetalleCodigoProductoColumn();
    await ensureOrdenCotizacionColumns();
    const id = req.params.id;
    const [[orden]] = await pool.query("SELECT * FROM ordenes_compra WHERE id = ?", [id]);
    if (!orden) return res.status(404).send("Orden no encontrada");
    const [[proveedor]] = await pool.query("SELECT * FROM proveedores WHERE id = ?", [orden.proveedor_id]);
    const [lineas] = await pool.query("SELECT * FROM ordenes_compra_detalle WHERE orden_compra_id = ?", [id]);
    res.render("compras/orden_detalle", { orden, proveedor, lineas, user: req.session.user });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error cargando detalle");
  }
});

router.get("/ordenes/:id/pdf", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    await ensureOrdenPlacaColumn();
    await ensureOrdenCotizacionColumns();
    const ordenId = req.params.id;
    const [[orden]] = await pool.query("SELECT * FROM ordenes_compra WHERE id = ?", [ordenId]);
    if (!orden) return res.status(404).send("Orden no encontrada");
    const [[proveedor]] = await pool.query("SELECT * FROM proveedores WHERE id = ?", [orden.proveedor_id]);
    const [lineas] = await pool.query("SELECT * FROM ordenes_compra_detalle WHERE orden_compra_id = ?", [ordenId]);
    const pdfBuffer = await generarPDFOrden(orden, proveedor, lineas);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=PO_${orden.po_numero}.pdf`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error generando PDF");
  }
});

router.post("/cotizacion/analizar", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        ok: false,
        error: "Falta configurar OPENAI_API_KEY para leer cotizaciones automáticamente."
      });
    }

    const { archivo_data, archivo_nombre, archivo_tipo } = req.body;
    const dataUrl = String(archivo_data || "").trim();
    const mimeType = String(archivo_tipo || "").trim();

    if (!dataUrl) {
      return res.status(400).json({ ok: false, error: "Debe adjuntar una cotización." });
    }

    if (!/^data:(application\/pdf|image\/jpeg|image\/jpg|image\/png|image\/webp);base64,/.test(dataUrl)) {
      return res.status(400).json({ ok: false, error: "La cotización debe ser PDF, JPG, PNG o WEBP." });
    }

    const base64 = dataUrl.split(",")[1] || "";
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ ok: false, error: "La cotización supera 5 MB." });
    }

    const [proveedores] = await queryWithRetry("SELECT id, nombre FROM proveedores ORDER BY nombre");
    const proveedoresTexto = proveedores.map(p => `${p.id}: ${p.nombre}`).join("\n");
    const contenidoArchivo = mimeType === "application/pdf" || dataUrl.startsWith("data:application/pdf")
      ? {
          type: "input_file",
          filename: archivo_nombre || "cotizacion.pdf",
          file_data: dataUrl
        }
      : {
          type: "input_image",
          image_url: dataUrl
        };

    const prompt = [
      "Lee esta cotización de compra y devuelve SOLO JSON válido.",
      "Debe servir para llenar una orden de compra.",
      "Campos requeridos:",
      "{",
      '  "proveedor_nombre": "nombre del proveedor si aparece",',
      '  "forma_pago": "contado, credito, transferencia, etc si aparece",',
      '  "moneda": "CRC o USD",',
      '  "placa_unidad": "placa si aparece, si no null",',
      '  "descuento": monto numerico de descuento o 0, no porcentaje,',
      '  "transporte": monto numerico o 0,',
      '  "iva": porcentaje numerico, normalmente 13 si aplica, 0 si indica exento,',
      '  "observaciones": "notas utiles breves",',
      '  "lineas": [',
      '    {"codigo": "placa si aparece, GENERAL TALLER/GENERAL GASTOS/ACEITES si aplica", "codigo_producto": "código del producto si aparece", "descripcion": "producto/servicio", "cantidad": numero, "precio_unitario": numero, "subtotal": numero}',
      "  ]",
      "}",
      "Reglas:",
      "- No inventes líneas. Si no puedes leer algo, omítelo o usa 0.",
      "- Los montos deben ir sin símbolos ni separadores de miles.",
      "- Si hay varias líneas, sepáralas.",
      "- Si la descripción contiene llantas/repuestos/trabajo, mantenla clara.",
      "- Si el proveedor coincide con uno de estos, usa el nombre más parecido:",
      proveedoresTexto
    ].join("\n");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL_COTIZACIONES || process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              contenidoArchivo
            ]
          }
        ],
        temperature: 0,
        max_output_tokens: 1800
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data.error && data.error.message ? data.error.message : "No se pudo analizar la cotización.";
      throw new Error(message);
    }

    const texto = data.output_text || (data.output || []).flatMap(item => item.content || []).map(content => content.text || "").join("\n");
    const json = extraerJsonRespuestaIA(texto);
    if (!json) {
      return res.status(422).json({ ok: false, error: "La IA no devolvió datos válidos de la cotización." });
    }

    const orden = sanearAnalisisCotizacion(json, proveedores);
    if (!orden.lineas.length) {
      return res.status(422).json({ ok: false, error: "No se detectaron líneas de productos o servicios en la cotización." });
    }

    res.json({ ok: true, orden });
  } catch (error) {
    console.error("Error analizando cotización:", error);
    res.status(500).json({
      ok: false,
      error: error.message || "No se pudo analizar la cotización."
    });
  }
});

router.post("/ordenes/:id/recibir", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    const id = req.params.id;
    const { proveedor_id, fecha_desde, fecha_hasta, po_numero, placa_unidad, estado, facturada } = req.body;
    await pool.query("UPDATE ordenes_compra SET estado = 'RECIBIDA_TOTAL' WHERE id = ?", [id]);
    const queryParams = [];
    if (proveedor_id) queryParams.push(`proveedor_id=${encodeURIComponent(proveedor_id)}`);
    if (fecha_desde) queryParams.push(`fecha_desde=${encodeURIComponent(fecha_desde)}`);
    if (fecha_hasta) queryParams.push(`fecha_hasta=${encodeURIComponent(fecha_hasta)}`);
    if (po_numero) queryParams.push(`po_numero=${encodeURIComponent(po_numero)}`);
    if (placa_unidad) queryParams.push(`placa_unidad=${encodeURIComponent(placa_unidad)}`);
    if (estado) queryParams.push(`estado=${encodeURIComponent(estado)}`);
    if (facturada !== undefined && facturada !== '') queryParams.push(`facturada=${encodeURIComponent(facturada)}`);
    const redirectUrl = "/compras/ordenes" + (queryParams.length ? "?" + queryParams.join("&") : "");
    res.redirect(redirectUrl);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error al marcar orden como recibida");
  }
});

router.post("/ordenes/:id/eliminar", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    const id = req.params.id;
    const { proveedor_id, fecha_desde, fecha_hasta, po_numero, placa_unidad, estado, facturada } = req.body;
    const [[orden]] = await pool.query("SELECT * FROM ordenes_compra WHERE id = ?", [id]);
    if (!orden) return res.status(404).send("Orden no encontrada");
    await pool.query("DELETE FROM ordenes_compra_detalle WHERE orden_compra_id = ?", [id]);
    await pool.query("DELETE FROM ordenes_compra WHERE id = ?", [id]);
    const queryParams = [];
    if (proveedor_id) queryParams.push(`proveedor_id=${encodeURIComponent(proveedor_id)}`);
    if (fecha_desde) queryParams.push(`fecha_desde=${encodeURIComponent(fecha_desde)}`);
    if (fecha_hasta) queryParams.push(`fecha_hasta=${encodeURIComponent(fecha_hasta)}`);
    if (po_numero) queryParams.push(`po_numero=${encodeURIComponent(po_numero)}`);
    if (placa_unidad) queryParams.push(`placa_unidad=${encodeURIComponent(placa_unidad)}`);
    if (estado) queryParams.push(`estado=${encodeURIComponent(estado)}`);
    if (facturada !== undefined && facturada !== '') queryParams.push(`facturada=${encodeURIComponent(facturada)}`);
    const redirectUrl = "/compras/ordenes" + (queryParams.length ? "?" + queryParams.join("&") : "");
    res.redirect(redirectUrl);
  } catch (error) {
    console.error("❌ Error al eliminar orden:", error);
    res.status(500).send("Error al eliminar la orden");
  }
});

router.post("/ordenes/:id/factura", requireAuth, allowRoles(...ROLES_REGISTRAR_FACTURA_ORDEN), async (req, res) => {
  try {
    await ensureFacturasSchema();
    const id = req.params.id;
    const {
      factura,
      fecha_factura,
      fecha_recepcion,
      tipo_entrega,
      entregado_por,
      recibido_por,
      producto_recibido,
      observacion_recepcion,
      foto_producto_data,
      proveedor_id,
      fecha_desde,
      fecha_hasta,
      po_numero,
      placa_unidad,
      estado,
      facturada
    } = req.body;

    const queryParams = [];
    if (proveedor_id) queryParams.push(`proveedor_id=${encodeURIComponent(proveedor_id)}`);
    if (fecha_desde) queryParams.push(`fecha_desde=${encodeURIComponent(fecha_desde)}`);
    if (fecha_hasta) queryParams.push(`fecha_hasta=${encodeURIComponent(fecha_hasta)}`);
    if (po_numero) queryParams.push(`po_numero=${encodeURIComponent(po_numero)}`);
    if (placa_unidad) queryParams.push(`placa_unidad=${encodeURIComponent(placa_unidad)}`);
    if (estado) queryParams.push(`estado=${encodeURIComponent(estado)}`);
    if (facturada !== undefined && facturada !== '') queryParams.push(`facturada=${encodeURIComponent(facturada)}`);
    const redirectUrl = "/compras/ordenes" + (queryParams.length ? "?" + queryParams.join("&") : "");

    const [[orden]] = await pool.query("SELECT fecha, po_numero, facturada FROM ordenes_compra WHERE id = ?", [id]);
    if (!orden) {
      req.session.error = "Orden no encontrada.";
      return res.redirect(redirectUrl);
    }
    if (orden.facturada) {
      req.session.error = `La orden ${orden.po_numero} ya tiene factura registrada.`;
      return res.redirect(redirectUrl);
    }
    if (!factura || String(factura).trim() === "") {
      req.session.error = "Debe indicar el número de factura.";
      return res.redirect(redirectUrl);
    }

    const fechaBase = fecha_factura || new Date().toISOString().slice(0, 10);
    const fechaVencimiento = new Date(fechaBase);
    fechaVencimiento.setDate(fechaVencimiento.getDate() + 30);
    const fechaVencimientoStr = fechaVencimiento.toISOString().slice(0, 10);
    const fotoProductoPath = guardarFotoProducto(foto_producto_data, req.session.user.id);
    await pool.query(
      `UPDATE ordenes_compra
       SET factura = ?,
           factura_fecha = ?,
           facturada = 1,
           estado = 'RECIBIDA_TOTAL',
           fecha_vencimiento_factura = ?,
           pagada = 0,
           factura_fecha_recepcion = ?,
           factura_tipo_entrega = ?,
           factura_entregado_por = ?,
           factura_recibido_por = ?,
           factura_producto_recibido = 1,
           factura_observacion = ?,
           factura_foto_producto = ?
       WHERE id = ?`,
      [
        factura || null,
        fechaBase,
        fechaVencimientoStr,
        fecha_recepcion || new Date().toISOString().slice(0, 10),
        tipo_entrega || null,
        entregado_por || null,
        recibido_por || req.session.user.usuario || null,
        observacion_recepcion || null,
        fotoProductoPath,
        id
      ]
    );
    req.session.success = `Factura ${factura} registrada en la orden ${orden.po_numero}. La orden quedó recibida automáticamente.`;
    res.redirect(redirectUrl);
  } catch (error) {
    console.error("❌ Error al registrar factura:", error);
    req.session.error = "Error al registrar factura.";
    res.redirect("/compras/ordenes");
  }
});

router.post("/facturas/agregar", requireAuth, allowRoles(...ROLES_RECEPCION_FACTURAS), async (req, res) => {
  try {
    await ensureFacturasSchema();
    const {
      orden_id,
      po_numero,
      factura,
      fecha_factura,
      fecha_recepcion,
      tipo_entrega,
      entregado_por,
      recibido_por,
      producto_recibido,
      observacion_recepcion,
      foto_producto_data,
      monto,
      proveedor_id
    } = req.body;

    if (!factura || !fecha_factura) {
      req.session.error = "Debe completar número de factura y fecha.";
      return res.redirect("/compras/facturas");
    }

    if (esMensajeroFacturas(req.session.user) && !orden_id && !(po_numero && po_numero.trim() !== "")) {
      req.session.error = "Debe seleccionar una orden de compra para recibir la factura.";
      return res.redirect("/compras/facturas");
    }

    if (orden_id || (po_numero && po_numero.trim() !== '')) {
      const [[orden]] = await pool.query(
        `SELECT id, po_numero, facturada
         FROM ordenes_compra
         WHERE ${orden_id ? "id = ?" : "po_numero = ?"}
         LIMIT 1`,
        [orden_id || po_numero]
      );
      if (orden && !orden.facturada) {
        const fotoProductoPath = guardarFotoProducto(foto_producto_data, req.session.user.id);
        const fechaVencimiento = new Date(fecha_factura);
        fechaVencimiento.setDate(fechaVencimiento.getDate() + 30);
        const fechaVencimientoStr = fechaVencimiento.toISOString().slice(0, 10);
        await pool.query(
          `UPDATE ordenes_compra 
           SET factura = ?,
               factura_fecha = ?,
               facturada = 1,
               estado = 'RECIBIDA_TOTAL',
               fecha_vencimiento_factura = ?,
               pagada = 0,
               factura_fecha_recepcion = ?,
               factura_tipo_entrega = ?,
               factura_entregado_por = ?,
               factura_recibido_por = ?,
               factura_producto_recibido = 1,
               factura_observacion = ?,
               factura_foto_producto = ?
           WHERE id = ?`,
          [
            factura,
            fecha_factura,
            fechaVencimientoStr,
            fecha_recepcion || new Date().toISOString().slice(0, 10),
            tipo_entrega || null,
            entregado_por || null,
            recibido_por || req.session.user.usuario || null,
            observacion_recepcion || null,
            fotoProductoPath,
            orden.id
          ]
        );
        req.session.success = `Factura ${factura} asociada a la orden ${orden.po_numero}. La orden quedó recibida automáticamente.`;
        return res.redirect("/compras/facturas");
      } else if (orden && orden.facturada) {
        req.session.error = `La orden ${orden.po_numero} ya está facturada.`;
        return res.redirect("/compras/facturas");
      }

      req.session.error = "No se encontró la orden de compra indicada.";
      return res.redirect("/compras/facturas");
    }

    if (!proveedor_id || proveedor_id === '') {
      req.session.error = "Debe seleccionar un proveedor para facturas sin orden de compra.";
      return res.redirect("/compras/facturas");
    }
    const [[proveedor]] = await pool.query("SELECT nombre FROM proveedores WHERE id = ?", [proveedor_id]);
    if (!proveedor) {
      req.session.error = "Proveedor no válido.";
      return res.redirect("/compras/facturas");
    }
    const fotoProductoPath = guardarFotoProducto(foto_producto_data, req.session.user.id);
    await pool.query(
      `INSERT INTO facturas (
        numero_factura, fecha, monto, proveedor_id, proveedor_nombre, pagada, creado_por,
        factura_fecha_recepcion, factura_tipo_entrega, factura_entregado_por,
        factura_recibido_por, factura_producto_recibido, factura_observacion, factura_foto_producto
       )
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        factura,
        fecha_factura,
        monto || 0,
        proveedor_id,
        proveedor.nombre,
        req.session.user.id,
        fecha_recepcion || new Date().toISOString().slice(0, 10),
        tipo_entrega || null,
        entregado_por || null,
        recibido_por || req.session.user.usuario || null,
        producto_recibido === "1" ? 1 : 0,
        observacion_recepcion || null,
        fotoProductoPath
      ]
    );
    req.session.success = `Factura independiente ${factura} agregada correctamente.`;
    res.redirect("/compras/facturas");
  } catch (error) {
    console.error("Error al agregar factura:", error);
    req.session.error = "Error interno al agregar la factura.";
    res.redirect("/compras/facturas");
  }
});

router.post("/facturas/pagos-proveedor/importar", requireAuth, allowRoles(...ROLES_GESTION_FACTURAS), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await ensurePagosProveedorTable();

    const buffer = parsePagoProveedorDataUrl(req.body.archivo_pago_data);
    const archivoNombre = String(req.body.archivo_pago_nombre || "plantilla_pagos.xlsx").trim().slice(0, 255);
    const periodoCierreArchivo = normalizarPeriodoCierre(req.body.periodo_cierre);
    const pagos = await leerPagosProveedorExcel(buffer);

    if (!pagos.length) {
      req.session.error = "No se encontraron pagos válidos en el archivo.";
      return res.redirect("/compras/facturas/pagos-proveedor");
    }

    await connection.beginTransaction();

    let insertados = 0;
    let duplicados = 0;

    for (const pago of pagos) {
      if (await existePagoProveedor(connection, pago)) {
        duplicados += 1;
        continue;
      }

      await connection.query(
        `INSERT INTO pagos_proveedor
         (empresa, fecha_solicitud, proveedor_nombre, cuenta_iban, concepto, numero_factura, placa, monto,
          partida_presupuestaria, pagada, fecha_pago, periodo_cierre, archivo_nombre, creado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          pago.fecha_pago ? 1 : 0,
          pago.fecha_pago,
          periodoCierreArchivo || normalizarPeriodoCierre(null, pago.fecha_pago || pago.fecha_solicitud),
          archivoNombre,
          req.session.user.id || null
        ]
      );
      insertados += 1;
    }

    await connection.commit();
    req.session.success = `Pagos de proveedor importados: ${insertados}. Duplicados omitidos: ${duplicados}.`;
    res.redirect("/compras/facturas/pagos-proveedor");
  } catch (error) {
    try {
      await connection.rollback();
    } catch (_) {}
    console.error("Error importando pagos de proveedor:", error);
    req.session.error = error.message || "Error al importar pagos de proveedor.";
    res.redirect("/compras/facturas/pagos-proveedor");
  } finally {
    connection.release();
  }
});

router.post("/facturas/pagos-proveedor/:id/estado", requireAuth, allowRoles(...ROLES_GESTION_FACTURAS), async (req, res) => {
  try {
    await ensurePagosProveedorTable();
    const id = Number(req.params.id);
    const accion = String(req.body.accion || "").trim();
    const fechaPago = String(req.body.fecha_pago || "").trim();
    const periodoCierre = normalizarPeriodoCierre(req.body.periodo_cierre, fechaPago);

    if (!Number.isInteger(id) || id <= 0) {
      req.session.error = "Pago de proveedor no válido.";
      return res.redirect("/compras/facturas/pagos-proveedor");
    }

    if (accion === "pagado") {
      const fechaFinal = /^\d{4}-\d{2}-\d{2}$/.test(fechaPago)
        ? fechaPago
        : new Date().toISOString().slice(0, 10);

      const [result] = await queryWithRetry(
        "UPDATE pagos_proveedor SET pagada = 1, fecha_pago = ?, periodo_cierre = ? WHERE id = ?",
        [fechaFinal, periodoCierre || fechaFinal.slice(0, 7), id]
      );

      req.session[result.affectedRows ? "success" : "error"] = result.affectedRows
        ? "Pago de proveedor marcado como pagado."
        : "No se encontró el pago de proveedor.";
      return res.redirect("/compras/facturas/pagos-proveedor");
    }

    if (accion === "pendiente") {
      const [result] = await queryWithRetry(
        "UPDATE pagos_proveedor SET pagada = 0, fecha_pago = NULL, periodo_cierre = NULL WHERE id = ?",
        [id]
      );

      req.session[result.affectedRows ? "success" : "error"] = result.affectedRows
        ? "Pago de proveedor devuelto a pendiente."
        : "No se encontró el pago de proveedor.";
      return res.redirect("/compras/facturas/pagos-proveedor");
    }

    req.session.error = "Acción no válida.";
    res.redirect("/compras/facturas/pagos-proveedor");
  } catch (error) {
    console.error("Error actualizando estado de pago de proveedor:", error);
    req.session.error = "Error actualizando el pago de proveedor.";
    res.redirect("/compras/facturas/pagos-proveedor");
  }
});

router.post("/facturas/pagos-proveedor/:id/eliminar", requireAuth, allowRoles(...ROLES_GESTION_FACTURAS), async (req, res) => {
  try {
    await ensurePagosProveedorTable();
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      req.session.error = "Pago de proveedor no válido.";
      return res.redirect("/compras/facturas/pagos-proveedor");
    }

    const [result] = await queryWithRetry(
      "DELETE FROM pagos_proveedor WHERE id = ?",
      [id]
    );

    req.session[result.affectedRows ? "success" : "error"] = result.affectedRows
      ? "Pago de proveedor eliminado correctamente."
      : "No se encontró el pago de proveedor.";

    res.redirect("/compras/facturas/pagos-proveedor");
  } catch (error) {
    console.error("Error eliminando pago de proveedor:", error);
    req.session.error = "Error eliminando el pago de proveedor.";
    res.redirect("/compras/facturas/pagos-proveedor");
  }
});

router.get("/facturas/pagos-proveedor", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    await ensurePagosProveedorTable();
    const filtros = {
      periodo_cierre: normalizarPeriodoCierre(req.query.periodo_cierre)
    };
    const pagosProveedor = await obtenerResumenPagosProveedor(filtros);
    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("compras/pagos_proveedor", {
      user: req.session.user,
      pagosProveedor,
      filtros,
      success,
      error
    });
  } catch (error) {
    console.error("Error cargando pagos de proveedor:", error);
    res.status(500).send("Error cargando pagos de proveedor");
  }
});

router.get("/facturas/pagos-proveedor/reporte/excel", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    await ensurePagosProveedorTable();
    const periodoCierre = normalizarPeriodoCierre(req.query.periodo_cierre);
    const where = [];
    const params = [];
    if (periodoCierre) {
      where.push("pp.periodo_cierre = ?");
      params.push(periodoCierre);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [pagos] = await queryWithRetry(`
      SELECT
        pp.id,
        pp.empresa,
        pp.fecha_solicitud,
        pp.proveedor_nombre,
        pp.cuenta_iban,
        pp.concepto,
        pp.numero_factura,
        pp.placa,
        pp.monto,
        pp.partida_presupuestaria,
        pp.pagada,
        pp.fecha_pago,
        pp.periodo_cierre,
        pp.archivo_nombre,
        pp.creado_en,
        u.usuario AS creado_por_usuario
      FROM pagos_proveedor pp
      LEFT JOIN usuarios u ON u.id = pp.creado_por
      ${whereSql}
      ORDER BY COALESCE(pp.fecha_pago, pp.fecha_solicitud, DATE(pp.creado_en)) DESC, pp.id DESC
    `, params);

    const resumenEmpresa = Array.from(pagos.reduce((map, pago) => {
      const key = pago.empresa || "Sin empresa";
      if (!map.has(key)) map.set(key, { empresa: key, pagos: 0, total: 0 });
      const item = map.get(key);
      item.pagos += 1;
      item.total += parseMonto(pago.monto);
      return map;
    }, new Map()).values()).sort((a, b) => b.total - a.total);

    const resumenProveedor = Array.from(pagos.reduce((map, pago) => {
      const key = pago.proveedor_nombre || "Sin proveedor";
      if (!map.has(key)) map.set(key, { proveedor: key, pagos: 0, total: 0 });
      const item = map.get(key);
      item.pagos += 1;
      item.total += parseMonto(pago.monto);
      return map;
    }, new Map()).values()).sort((a, b) => b.total - a.total || a.proveedor.localeCompare(b.proveedor, "es"));

    const totalGeneral = pagos.reduce((sum, pago) => sum + parseMonto(pago.monto), 0);
    const totalPagado = pagos.reduce((sum, pago) => sum + (Number(pago.pagada || 0) ? parseMonto(pago.monto) : 0), 0);
    const totalPendiente = Math.max(totalGeneral - totalPagado, 0);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Gas Tomza";
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.views = [{ activeTab: 0 }];

    const aplicarBordes = worksheet => {
      worksheet.eachRow(row => {
        row.eachCell(cell => {
          cell.border = {
            top: { style: "thin", color: { argb: "FFE2E8F0" } },
            left: { style: "thin", color: { argb: "FFE2E8F0" } },
            bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
            right: { style: "thin", color: { argb: "FFE2E8F0" } }
          };
          cell.alignment = cell.alignment || { vertical: "middle" };
        });
      });
    };

    const pintarTitulo = (worksheet, rango, titulo) => {
      worksheet.mergeCells(rango);
      const cell = worksheet.getCell(rango.split(":")[0]);
      cell.value = titulo;
      cell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F3B82" } };
      worksheet.getRow(1).height = 26;
    };

    const pintarHeader = row => {
      row.font = { bold: true, color: { argb: "FFFFFFFF" } };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
      row.alignment = { vertical: "middle", horizontal: "center" };
      row.height = 20;
    };

    const ws = workbook.addWorksheet("Historial completo", {
      views: [{ state: "frozen", ySplit: 7 }]
    });

    ws.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Empresa", key: "empresa", width: 18 },
      { header: "Fecha solicitud", key: "fecha_solicitud", width: 16 },
      { header: "Fecha pago", key: "fecha_pago", width: 16 },
      { header: "Periodo cierre", key: "periodo_cierre", width: 16 },
      { header: "Proveedor", key: "proveedor_nombre", width: 36 },
      { header: "Cuenta IBAN", key: "cuenta_iban", width: 28 },
      { header: "Concepto", key: "concepto", width: 42 },
      { header: "N. factura", key: "numero_factura", width: 22 },
      { header: "Placa", key: "placa", width: 14 },
      { header: "Monto", key: "monto", width: 16 },
      { header: "Estado", key: "estado", width: 14 },
      { header: "Partida presupuestaria", key: "partida_presupuestaria", width: 26 },
      { header: "Archivo", key: "archivo_nombre", width: 30 },
      { header: "Creado por", key: "creado_por_usuario", width: 18 },
      { header: "Creado en", key: "creado_en", width: 20 }
    ];

    pintarTitulo(ws, "A1:P1", periodoCierre ? `Pagos de proveedor - cierre ${etiquetaPeriodoCierre(periodoCierre)}` : "Historial completo de pagos de proveedor");
    ws.getCell("A3").value = "Generado";
    ws.getCell("B3").value = new Date();
    ws.getCell("B3").numFmt = "yyyy-mm-dd hh:mm";
    ws.getCell("D3").value = "Pagos";
    ws.getCell("E3").value = pagos.length;
    ws.getCell("G3").value = "Total pagado";
    ws.getCell("H3").value = totalPagado;
    ws.getCell("H3").numFmt = '"CRC" #,##0.00';
    ws.getCell("J3").value = "Pendiente";
    ws.getCell("K3").value = totalPendiente;
    ws.getCell("K3").numFmt = '"CRC" #,##0.00';
    ["A3", "D3", "G3", "J3"].forEach(cell => {
      ws.getCell(cell).font = { bold: true, color: { argb: "FF475569" } };
    });
    ws.getCell("H3").font = { bold: true, color: { argb: "FF14532D" } };
    ws.getCell("K3").font = { bold: true, color: { argb: "FF991B1B" } };

    const header = ws.getRow(6);
    header.values = ws.columns.map(col => col.header);
    pintarHeader(header);

    let rowNumber = 7;
    pagos.forEach(pago => {
      const row = ws.getRow(rowNumber++);
      row.values = [
        pago.id,
        pago.empresa || "-",
        pago.fecha_solicitud ? new Date(pago.fecha_solicitud) : null,
        pago.fecha_pago ? new Date(pago.fecha_pago) : null,
        pago.periodo_cierre || "-",
        pago.proveedor_nombre || "-",
        pago.cuenta_iban || "-",
        pago.concepto || "-",
        pago.numero_factura || "-",
        pago.placa || "-",
        parseMonto(pago.monto),
        Number(pago.pagada || 0) ? "Pagado" : "Pendiente",
        pago.partida_presupuestaria || "-",
        pago.archivo_nombre || "-",
        pago.creado_por_usuario || "-",
        pago.creado_en ? new Date(pago.creado_en) : null
      ];
      [3, 4].forEach(col => { row.getCell(col).numFmt = "yyyy-mm-dd"; });
      row.getCell(11).numFmt = '"CRC" #,##0.00';
      row.getCell(12).font = { bold: true, color: { argb: Number(pago.pagada || 0) ? "FF14532D" : "FF991B1B" } };
      row.getCell(16).numFmt = "yyyy-mm-dd hh:mm";
      row.getCell(8).alignment = { wrapText: true, vertical: "top" };
    });

    ws.autoFilter = { from: "A6", to: "P6" };
    aplicarBordes(ws);

    const wsProveedor = workbook.addWorksheet("Resumen proveedor", {
      views: [{ state: "frozen", ySplit: 5 }]
    });
    wsProveedor.columns = [
      { header: "Proveedor", key: "proveedor", width: 44 },
      { header: "Cantidad de pagos", key: "pagos", width: 18 },
      { header: "Total pagado", key: "total", width: 18 }
    ];
    pintarTitulo(wsProveedor, "A1:C1", "Resumen por proveedor");
    wsProveedor.getCell("A3").value = "Total general";
    wsProveedor.getCell("B3").value = pagos.length;
    wsProveedor.getCell("C3").value = totalGeneral;
    wsProveedor.getCell("C3").numFmt = '"CRC" #,##0.00';
    wsProveedor.getRow(5).values = wsProveedor.columns.map(col => col.header);
    pintarHeader(wsProveedor.getRow(5));
    resumenProveedor.forEach(item => {
      const row = wsProveedor.addRow([item.proveedor, item.pagos, item.total]);
      row.getCell(3).numFmt = '"CRC" #,##0.00';
    });
    wsProveedor.autoFilter = { from: "A5", to: "C5" };
    aplicarBordes(wsProveedor);

    const wsEmpresa = workbook.addWorksheet("Resumen empresa", {
      views: [{ state: "frozen", ySplit: 5 }]
    });
    wsEmpresa.columns = [
      { header: "Empresa", key: "empresa", width: 24 },
      { header: "Cantidad de pagos", key: "pagos", width: 18 },
      { header: "Total pagado", key: "total", width: 18 }
    ];
    pintarTitulo(wsEmpresa, "A1:C1", "Resumen por empresa");
    wsEmpresa.getCell("A3").value = "Total general";
    wsEmpresa.getCell("B3").value = pagos.length;
    wsEmpresa.getCell("C3").value = totalGeneral;
    wsEmpresa.getCell("C3").numFmt = '"CRC" #,##0.00';
    wsEmpresa.getRow(5).values = wsEmpresa.columns.map(col => col.header);
    pintarHeader(wsEmpresa.getRow(5));
    resumenEmpresa.forEach(item => {
      const row = wsEmpresa.addRow([item.empresa, item.pagos, item.total]);
      row.getCell(3).numFmt = '"CRC" #,##0.00';
    });
    wsEmpresa.autoFilter = { from: "A5", to: "C5" };
    aplicarBordes(wsEmpresa);

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const nombrePeriodo = periodoCierre ? `cierre_${periodoCierre}_` : "";
    res.setHeader("Content-Disposition", `attachment; filename=${nombrePeriodo}historial_pagos_proveedor_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.xlsx`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Error descargando Excel de pagos de proveedor:", error);
    res.status(500).send("Error descargando Excel de pagos de proveedor");
  }
});

router.get("/facturas/caja-chica", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    const cajaChica = await obtenerResumenCajaChica();
    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("compras/caja_chica", {
      user: req.session.user,
      cajaChica,
      success,
      error,
      hoy: new Date().toISOString().slice(0, 10)
    });
  } catch (error) {
    console.error("Error cargando caja chica:", error);
    res.status(500).send("Error cargando caja chica");
  }
});

router.post("/facturas/caja-chica", requireAuth, allowRoles(...ROLES_GESTION_FACTURAS), async (req, res) => {
  try {
    await ensureCajaChicaTable();
    const fecha = String(req.body.fecha || "").trim();
    const monto = parseMontoCotizacion(req.body.monto);
    const observacion = String(req.body.observacion || "").trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      req.session.error = "Debe indicar una fecha válida.";
      return res.redirect("/compras/facturas/caja-chica");
    }

    if (!monto || monto <= 0) {
      req.session.error = "Debe indicar un monto mayor a cero.";
      return res.redirect("/compras/facturas/caja-chica");
    }

    await queryWithRetry(
      `INSERT INTO caja_chica_reintegros (fecha, monto, observacion, creado_por)
       VALUES (?, ?, ?, ?)`,
      [fecha, monto, observacion || null, req.session.user.id || null]
    );

    req.session.success = `Reintegro de caja chica registrado por ₡${monto.toLocaleString("es-CR", { maximumFractionDigits: 0 })}.`;
    res.redirect("/compras/facturas/caja-chica");
  } catch (error) {
    console.error("Error guardando caja chica:", error);
    req.session.error = "No se pudo guardar el reintegro de caja chica.";
    res.redirect("/compras/facturas/caja-chica");
  }
});

router.get("/facturas/reintegro-gastos", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    const reintegroGastos = await obtenerResumenReintegroGastos();
    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("compras/reintegro_gastos", {
      user: req.session.user,
      reintegroGastos,
      success,
      error,
      hoy: new Date().toISOString().slice(0, 10)
    });
  } catch (error) {
    console.error("Error cargando reintegro de gastos:", error);
    res.status(500).send("Error cargando reintegro de gastos");
  }
});

router.post("/facturas/reintegro-gastos", requireAuth, allowRoles(...ROLES_GESTION_FACTURAS), async (req, res) => {
  try {
    await ensureReintegroGastosTable();
    const fecha = String(req.body.fecha || "").trim();
    const entregadoA = String(req.body.entregado_a || "").trim();
    const numeroFactura = String(req.body.numero_factura || "").trim();
    const monto = parseMontoCotizacion(req.body.monto);
    const observacion = String(req.body.observacion || "").trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      req.session.error = "Debe indicar una fecha válida.";
      return res.redirect("/compras/facturas/reintegro-gastos");
    }

    if (!entregadoA) {
      req.session.error = "Debe indicar a quién se le dio el monto.";
      return res.redirect("/compras/facturas/reintegro-gastos");
    }

    if (!numeroFactura) {
      req.session.error = "Debe indicar el número de factura.";
      return res.redirect("/compras/facturas/reintegro-gastos");
    }

    if (!monto || monto <= 0) {
      req.session.error = "Debe indicar un monto mayor a cero.";
      return res.redirect("/compras/facturas/reintegro-gastos");
    }

    await queryWithRetry(
      `INSERT INTO reintegros_gastos (fecha, entregado_a, numero_factura, monto, observacion, creado_por)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [fecha, entregadoA, numeroFactura, monto, observacion || null, req.session.user.id || null]
    );

    req.session.success = `Reintegro de gastos registrado por ₡${monto.toLocaleString("es-CR", { maximumFractionDigits: 0 })}.`;
    res.redirect("/compras/facturas/reintegro-gastos");
  } catch (error) {
    console.error("Error guardando reintegro de gastos:", error);
    req.session.error = "No se pudo guardar el reintegro de gastos.";
    res.redirect("/compras/facturas/reintegro-gastos");
  }
});

// ===================== LISTADO DE FACTURAS (unificado) =====================
router.get("/facturas", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    await ensureFacturasSchema();
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const { proveedor_id, fecha_desde, fecha_hasta, pagada, vencida, periodo_cierre } = req.query;
    const orden = req.query.orden === 'asc' ? 'asc' : 'desc';
    const periodoCierre = normalizarPeriodoCierre(periodo_cierre);
    const paginacionBase = normalizarPaginacionFacturas(req.query);
    const filtrosFacturas = { proveedor_id, fecha_desde, fecha_hasta, pagada, vencida, periodo_cierre: periodoCierre, orden };
    const totalRegistros = await contarFacturasCompras(filtrosFacturas);
    const totalPaginas = Math.max(Math.ceil(totalRegistros / paginacionBase.porPagina), 1);
    const paginaActual = Math.min(paginacionBase.pagina, totalPaginas);
    const offset = (paginaActual - 1) * paginacionBase.porPagina;
    const facturasFiltradas = await obtenerFacturasCompras({
      ...filtrosFacturas,
      limit: paginacionBase.porPagina,
      offset
    });

    const [proveedores] = await queryWithRetry("SELECT id, nombre FROM proveedores ORDER BY nombre");
    const ordenesDisponibles = await obtenerOrdenesDisponiblesFactura();
    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("compras/facturas", {
      facturas: facturasFiltradas,
      user: req.session.user,
      proveedores,
      ordenesDisponibles,
      filtros: { proveedor_id, fecha_desde, fecha_hasta, pagada, vencida, periodo_cierre: periodoCierre, orden },
      paginacion: {
        pagina: paginaActual,
        porPagina: paginacionBase.porPagina,
        total: totalRegistros,
        totalPaginas,
        desde: totalRegistros ? offset + 1 : 0,
        hasta: Math.min(offset + facturasFiltradas.length, totalRegistros)
      },
      success,
      error,
      hoy: hoy.toISOString().slice(0, 10)
    });
  } catch (error) {
    console.error("Error al cargar facturas:", error);
    res.status(500).send("Error interno");
  }
});

router.get("/facturas/dashboard", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    await ensureFacturasSchema();

    const { proveedor_id, fecha_desde, fecha_hasta, pagada, vencida, periodo_cierre } = req.query;
    const orden = req.query.orden === "asc" ? "asc" : "desc";
    const filtros = { proveedor_id, fecha_desde, fecha_hasta, pagada, vencida, periodo_cierre: normalizarPeriodoCierre(periodo_cierre), orden };
    const facturas = await obtenerFacturasCompras(filtros);
    const financiero = await obtenerDashboardFinancieroFacturas(filtros);
    const cierrePagos = await obtenerCierrePagosProveedor(filtros.periodo_cierre);
    const filtrosDeuda = { pagada: "0", orden: "asc" };
    const facturasPendientesTodas = (await obtenerFacturasCompras(filtrosDeuda))
      .filter(factura => parseMonto(factura.saldo) > 0 && !factura.cubierta_por_nc);
    const [proveedores] = await queryWithRetry("SELECT id, nombre FROM proveedores ORDER BY nombre");

    const resumen = facturas.reduce((acc, factura) => {
      const montoOriginal = parseMonto(factura.monto_original ?? factura.monto);
      const notaCredito = parseMonto(factura.nota_credito_monto);
      const abono = parseMonto(factura.abono_monto);
      const montoPagado = parseMonto(factura.monto_pagado);
      const saldo = factura.pagada || factura.cubierta_por_nc ? 0 : parseMonto(factura.saldo ?? factura.monto);

      acc.totalFacturas += 1;
      acc.montoOriginal += montoOriginal;
      acc.notasCredito += notaCredito;
      acc.abonos += abono;
      acc.pagado += montoPagado;
      acc.saldo += saldo;

      if (factura.pagada || factura.cubierta_por_nc) acc.pagadas += 1;
      else acc.pendientes += 1;
      if (factura.vencida) acc.vencidas += 1;
      if (notaCredito > 0) acc.conNotaCredito += 1;
      if (abono > 0) acc.conAbono += 1;

      return acc;
    }, {
      totalFacturas: 0,
      pagadas: 0,
      pendientes: 0,
      vencidas: 0,
      conNotaCredito: 0,
      conAbono: 0,
      montoOriginal: 0,
      notasCredito: 0,
      abonos: 0,
      pagado: 0,
      saldo: 0
    });

    const porProveedorMap = new Map();
    const porMesMap = new Map();
    const porEstadoMap = new Map([
      ["Pagadas", { estado: "Pagadas", cantidad: 0, monto: 0 }],
      ["Pendientes", { estado: "Pendientes", cantidad: 0, monto: 0 }],
      ["Vencidas", { estado: "Vencidas", cantidad: 0, monto: 0 }],
      ["Con NC", { estado: "Con NC", cantidad: 0, monto: 0 }],
      ["Con abono", { estado: "Con abono", cantidad: 0, monto: 0 }]
    ]);

    facturas.forEach(factura => {
      const proveedor = factura.proveedor_nombre || "Sin proveedor";
      const montoOriginal = parseMonto(factura.monto_original ?? factura.monto);
      const saldo = factura.pagada || factura.cubierta_por_nc ? 0 : parseMonto(factura.saldo ?? factura.monto);
      const notaCredito = parseMonto(factura.nota_credito_monto);
      const abono = parseMonto(factura.abono_monto);
      const montoPagado = parseMonto(factura.monto_pagado);

      if (!porProveedorMap.has(proveedor)) {
        porProveedorMap.set(proveedor, {
          proveedor,
          facturas: 0,
          pagadas: 0,
          pendientes: 0,
          vencidas: 0,
          montoOriginal: 0,
          saldo: 0
        });
      }
      const grupoProveedor = porProveedorMap.get(proveedor);
      grupoProveedor.facturas += 1;
      grupoProveedor.montoOriginal += montoOriginal;
      grupoProveedor.saldo += saldo;
      if (factura.pagada || factura.cubierta_por_nc) grupoProveedor.pagadas += 1;
      else grupoProveedor.pendientes += 1;
      if (factura.vencida) grupoProveedor.vencidas += 1;

      const fecha = factura.fecha ? new Date(factura.fecha) : null;
      const mes = fecha && !Number.isNaN(fecha.getTime())
        ? `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`
        : "Sin fecha";
      if (!porMesMap.has(mes)) {
        porMesMap.set(mes, { mes, facturas: 0, montoOriginal: 0, saldo: 0 });
      }
      const grupoMes = porMesMap.get(mes);
      grupoMes.facturas += 1;
      grupoMes.montoOriginal += montoOriginal;
      grupoMes.saldo += saldo;

      if (factura.pagada || factura.cubierta_por_nc) {
        porEstadoMap.get("Pagadas").cantidad += 1;
        porEstadoMap.get("Pagadas").monto += montoPagado;
      } else {
        porEstadoMap.get("Pendientes").cantidad += 1;
        porEstadoMap.get("Pendientes").monto += saldo;
      }
      if (factura.vencida) {
        porEstadoMap.get("Vencidas").cantidad += 1;
        porEstadoMap.get("Vencidas").monto += saldo;
      }
      if (notaCredito > 0) {
        porEstadoMap.get("Con NC").cantidad += 1;
        porEstadoMap.get("Con NC").monto += notaCredito;
      }
      if (abono > 0) {
        porEstadoMap.get("Con abono").cantidad += 1;
        porEstadoMap.get("Con abono").monto += abono;
      }
    });

    const porProveedor = Array.from(porProveedorMap.values())
      .sort((a, b) => b.saldo - a.saldo || b.montoOriginal - a.montoOriginal)
      .slice(0, 15);
    const porMes = Array.from(porMesMap.values()).sort((a, b) => a.mes.localeCompare(b.mes, "es"));
    const porEstado = Array.from(porEstadoMap.values()).filter(item => item.cantidad > 0);
    const facturasRecientes = facturas.slice(0, 12);
    const gruposDeudaProveedor = agruparFacturasPendientesPorProveedor(facturasPendientesTodas);
    const deudaPorProveedor = gruposDeudaProveedor.map(grupo => ({
      proveedor: grupo.proveedor,
      facturas: grupo.facturas.length,
      vencidas: grupo.facturas.filter(f => f.vencida).length,
      montoOriginal: grupo.totales.montoOriginal,
      notasCredito: grupo.totales.notasCredito,
      abonos: grupo.totales.abonos,
      saldo: grupo.totales.saldo
    }));
    const resumenDeuda = {
      ...calcularTotalesFacturas(facturasPendientesTodas),
      facturas: facturasPendientesTodas.length,
      proveedores: deudaPorProveedor.length
    };

    res.render("compras/dashboard_facturas", {
      user: req.session.user,
      proveedores,
      filtros,
      resumen,
      porProveedor,
      porMes,
      porEstado,
      facturasRecientes,
      deudaPorProveedor,
      resumenDeuda,
      financiero,
      cierrePagos
    });
  } catch (error) {
    console.error("Error en dashboard de facturas:", error);
    res.status(500).send("Error cargando dashboard de facturas");
  }
});

router.get("/facturas/reporte/pdf", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    await ensureFacturasSchema();

    const { proveedor_id, fecha_desde, fecha_hasta, vencida, periodo_cierre } = req.query;
    const pagada = normalizarFiltroPagadaReporte(req.query.pagada);
    const orden = req.query.orden === "asc" ? "asc" : "desc";
    const filtros = { proveedor_id, fecha_desde, fecha_hasta, pagada, vencida, periodo_cierre: normalizarPeriodoCierre(periodo_cierre), orden };
    let facturas = await obtenerFacturasCompras(filtros);
    if (pagada === "0") {
      facturas = facturas.filter(factura => parseMonto(factura.saldo) > 0 && !factura.cubierta_por_nc);
    }

    const [[proveedorFiltro]] = proveedor_id
      ? await queryWithRetry("SELECT nombre FROM proveedores WHERE id = ?", [proveedor_id])
      : [[null]];

    const metaReporte = obtenerMetaReporteFacturas(pagada);
    const gruposProveedor = agruparFacturasPendientesPorProveedor(facturas);

    gruposProveedor.forEach(grupo => {
      grupo.facturas.sort((a, b) => {
        const fechaA = a.fecha ? new Date(a.fecha).getTime() : 0;
        const fechaB = b.fecha ? new Date(b.fecha).getTime() : 0;
        return fechaA - fechaB;
      });
    });

    const totales = calcularTotalesFacturas(facturas);
    const pdfBuffer = await generarPDFFacturasPendientes({
      facturas,
      gruposProveedor,
      filtros: {
        ...filtros,
        proveedor_nombre: proveedorFiltro ? proveedorFiltro.nombre : null
      },
      totales,
      fechaGeneracion: new Date().toLocaleString("es-CR"),
      metaReporte
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${metaReporte.archivo}_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.pdf`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Error descargando reporte de facturas:", error);
    res.status(500).send("Error descargando reporte");
  }
});

router.get("/facturas/reporte/excel", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    await ensureFacturasSchema();

    const { proveedor_id, fecha_desde, fecha_hasta, vencida, periodo_cierre } = req.query;
    const pagada = normalizarFiltroPagadaReporte(req.query.pagada);
    const orden = req.query.orden === "asc" ? "asc" : "desc";
    const filtros = { proveedor_id, fecha_desde, fecha_hasta, pagada, vencida, periodo_cierre: normalizarPeriodoCierre(periodo_cierre), orden };
    let facturas = await obtenerFacturasCompras(filtros);
    if (pagada === "0") {
      facturas = facturas.filter(factura => parseMonto(factura.saldo) > 0 && !factura.cubierta_por_nc);
    }
    const metaReporte = obtenerMetaReporteFacturas(pagada);

    const [[proveedorFiltro]] = proveedor_id
      ? await queryWithRetry("SELECT nombre FROM proveedores WHERE id = ?", [proveedor_id])
      : [[null]];

    const gruposProveedor = agruparFacturasPendientesPorProveedor(facturas)
      .sort((a, b) => a.proveedor.localeCompare(b.proveedor, "es"));

    gruposProveedor.forEach(grupo => {
      grupo.facturas.sort((a, b) => {
        const fechaA = a.fecha ? new Date(a.fecha).getTime() : 0;
        const fechaB = b.fecha ? new Date(b.fecha).getTime() : 0;
        return fechaA - fechaB;
      });
    });

    const totales = calcularTotalesFacturas(facturas);

    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Gas Tomza";
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet(metaReporte.hoja, {
      views: [{ state: "frozen", ySplit: 7 }]
    });

    worksheet.columns = [
      { header: "Proveedor", key: "proveedor", width: 28 },
      { header: "PO", key: "po", width: 15 },
      { header: "Fecha", key: "fecha", width: 13 },
      { header: "Factura", key: "factura", width: 18 },
      { header: "Vencimiento", key: "vencimiento", width: 13 },
      { header: "Monto original", key: "montoOriginal", width: 15 },
      { header: "NC", key: "notaCredito", width: 13 },
      { header: "Abonos", key: "abonos", width: 13 },
      { header: "Pagado", key: "pagado", width: 15 },
      { header: "Saldo", key: "saldo", width: 15 },
      { header: "Periodo cierre", key: "periodo_cierre", width: 16 },
      { header: "Estado", key: "estado", width: 13 },
      { header: "Observación", key: "observacion", width: 42 }
    ];

    worksheet.mergeCells("A1:M1");
    worksheet.getCell("A1").value = metaReporte.titulo;
    worksheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    worksheet.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };
    worksheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
    worksheet.getRow(1).height = 24;

    worksheet.getCell("A3").value = "Generado";
    worksheet.getCell("B3").value = new Date();
    worksheet.getCell("B3").numFmt = "yyyy-mm-dd hh:mm";
    worksheet.getCell("D3").value = "Proveedor";
    worksheet.getCell("E3").value = proveedorFiltro ? proveedorFiltro.nombre : "Todos";
    worksheet.getCell("G3").value = "Solo vencidas";
    worksheet.getCell("H3").value = vencida === "1" ? "Si" : "No";

    worksheet.getCell("A4").value = "Desde";
    worksheet.getCell("B4").value = fecha_desde || "-";
    worksheet.getCell("D4").value = "Hasta";
    worksheet.getCell("E4").value = fecha_hasta || "-";
    worksheet.getCell("G4").value = "Facturas";
    worksheet.getCell("H4").value = facturas.length;
    worksheet.getCell("J4").value = "Periodo cierre";
    worksheet.getCell("K4").value = etiquetaPeriodoCierre(filtros.periodo_cierre);

    worksheet.getCell("A5").value = "Monto original";
    worksheet.getCell("B5").value = totales.montoOriginal;
    worksheet.getCell("D5").value = "Notas de credito";
    worksheet.getCell("E5").value = totales.notasCredito;
    worksheet.getCell("G5").value = "Abonos";
    worksheet.getCell("H5").value = totales.abonos;
    worksheet.getCell("J5").value = metaReporte.totalEtiqueta;
    worksheet.getCell("K5").value = totales[metaReporte.totalClave];

    ["A3", "D3", "G3", "A4", "D4", "G4", "J4", "A5", "D5", "G5", "J5"].forEach(cell => {
      worksheet.getCell(cell).font = { bold: true, color: { argb: "FF475569" } };
    });
    ["B5", "E5", "H5", "K5"].forEach(cell => {
      worksheet.getCell(cell).numFmt = '"CRC" #,##0.00';
      worksheet.getCell(cell).font = { bold: true };
    });
    worksheet.getCell("K5").font = { bold: true, color: { argb: "FF14532D" } };

    const headerRow = worksheet.getRow(7);
    headerRow.values = worksheet.columns.map(col => col.header);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.height = 20;

    let rowNumber = 8;
    gruposProveedor.forEach(grupo => {
      const providerRow = worksheet.getRow(rowNumber++);
      providerRow.getCell(1).value = `${grupo.proveedor} (${grupo.facturas.length} factura${grupo.facturas.length === 1 ? "" : "s"})`;
      worksheet.mergeCells(providerRow.number, 1, providerRow.number, 13);
      providerRow.font = { bold: true, color: { argb: "FF111827" } };
      providerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };

      grupo.facturas.forEach(f => {
        const row = worksheet.getRow(rowNumber++);
        row.values = [
          f.proveedor_nombre || "-",
          f.po_numero || "-",
          f.fecha ? new Date(f.fecha) : null,
          f.numero_factura || "-",
          f.fecha_vencimiento_factura ? new Date(f.fecha_vencimiento_factura) : null,
          parseMonto(f.monto_original ?? f.monto),
          parseMonto(f.nota_credito_monto),
          parseMonto(f.abono_monto),
          parseMonto(f.monto_pagado),
          parseMonto(f.saldo),
          f.periodo_cierre || "-",
          f.pagada || f.cubierta_por_nc ? "Pagada" : (f.vencida ? "Vencida" : "Pendiente"),
          f.factura_observacion || f.abono_observacion || f.nota_credito_motivo || f.observacion || "-"
        ];
        row.getCell(3).numFmt = "yyyy-mm-dd";
        row.getCell(5).numFmt = "yyyy-mm-dd";
        [6, 7, 8, 9, 10].forEach(col => {
          row.getCell(col).numFmt = '"CRC" #,##0.00';
        });
        const estadoPagado = f.pagada || f.cubierta_por_nc;
        row.getCell(12).font = { bold: true, color: { argb: estadoPagado ? "FF14532D" : (f.vencida ? "FF991B1B" : "FF92400E") } };
        row.getCell(13).alignment = { wrapText: true, vertical: "top" };
      });

      const subtotalRow = worksheet.getRow(rowNumber++);
      subtotalRow.values = [
        `Total ${grupo.proveedor}`,
        "", "", "", "",
        grupo.totales.montoOriginal,
        grupo.totales.notasCredito,
        grupo.totales.abonos,
        grupo.totales.pagado,
        grupo.totales.saldo,
        "", "", ""
      ];
      worksheet.mergeCells(subtotalRow.number, 1, subtotalRow.number, 5);
      subtotalRow.font = { bold: true };
      subtotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      [6, 7, 8, 9, 10].forEach(col => {
        subtotalRow.getCell(col).numFmt = '"CRC" #,##0.00';
      });
    });

    const totalRow = worksheet.getRow(rowNumber + 1);
    totalRow.values = [
      "TOTAL GENERAL",
      "", "", "", "",
      totales.montoOriginal,
      totales.notasCredito,
      totales.abonos,
      totales.pagado,
      totales.saldo,
      "", "", ""
    ];
    worksheet.mergeCells(totalRow.number, 1, totalRow.number, 5);
    totalRow.font = { bold: true, color: { argb: "FF14532D" } };
    totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
    [6, 7, 8, 9, 10].forEach(col => {
      totalRow.getCell(col).numFmt = '"CRC" #,##0.00';
    });

    worksheet.eachRow(row => {
      row.eachCell(cell => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFE2E8F0" } },
          left: { style: "thin", color: { argb: "FFE2E8F0" } },
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
          right: { style: "thin", color: { argb: "FFE2E8F0" } }
        };
        cell.alignment = cell.alignment || { vertical: "middle" };
      });
    });

    worksheet.autoFilter = {
      from: "A7",
      to: "M7"
    };

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=${metaReporte.archivo}_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.xlsx`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Error descargando Excel de facturas:", error);
    res.status(500).send("Error descargando Excel");
  }
});

router.post("/facturas/:id/numero", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    await ensureFacturasSchema();
    const id = req.params.id;
    const { tipo, numero_factura } = req.body;
    const nuevoNumero = String(numero_factura || "").trim();

    if (!["orden", "independiente"].includes(tipo)) {
      req.session.error = "Tipo de factura inválido.";
      return redirectFacturas(req, res);
    }

    if (!nuevoNumero) {
      req.session.error = "Debe indicar el número de factura.";
      return redirectFacturas(req, res);
    }

    const table = tipo === "orden" ? "ordenes_compra" : "facturas";
    const numeroColumn = tipo === "orden" ? "factura" : "numero_factura";
    const extraWhere = tipo === "orden" ? "AND facturada = 1" : "";

    const [[factura]] = await pool.query(
      `SELECT id, ${numeroColumn} AS numero_actual
       FROM ${table}
       WHERE id = ? ${extraWhere}`,
      [id]
    );

    if (!factura) {
      req.session.error = "Factura no encontrada.";
      return redirectFacturas(req, res);
    }

    if (tipo === "orden") {
      await pool.query(
        `UPDATE ordenes_compra
         SET factura = ?,
             facturada = 1,
             estado = 'RECIBIDA_TOTAL',
             factura_producto_recibido = 1,
             factura_fecha_recepcion = COALESCE(factura_fecha_recepcion, CURDATE())
         WHERE id = ?`,
        [nuevoNumero, id]
      );
    } else {
      await pool.query(
        `UPDATE ${table}
         SET ${numeroColumn} = ?
         WHERE id = ?`,
        [nuevoNumero, id]
      );
    }

    req.session.success = tipo === "orden"
      ? `Número de factura actualizado de ${factura.numero_actual || "sin número"} a ${nuevoNumero}. La orden quedó recibida automáticamente.`
      : `Número de factura actualizado de ${factura.numero_actual || "sin número"} a ${nuevoNumero}.`;
    return redirectFacturas(req, res);
  } catch (error) {
    console.error("Error editando número de factura:", error);
    req.session.error = "Error interno al editar el número de factura.";
    return redirectFacturas(req, res);
  }
});

router.post("/facturas/:id/editar", requireAuth, allowRoles(...ROLES_GESTION_FACTURAS), async (req, res) => {
  try {
    await ensureFacturasSchema();

    const id = req.params.id;
    const {
      tipo,
      numero_factura,
      fecha_factura,
      fecha_vencimiento_factura,
      monto,
      proveedor_id,
      pagada,
      fecha_pago,
      periodo_cierre,
      numero_nc,
      fecha_nc,
      monto_nc,
      motivo_nc,
      monto_abono,
      fecha_abono,
      observacion_abono,
      fecha_recepcion,
      tipo_entrega,
      entregado_por,
      recibido_por,
      producto_recibido,
      placa_producto,
      observacion_recepcion,
      foto_producto_data
    } = req.body;

    const facturaNumero = String(numero_factura || "").trim();
    const fechaFactura = String(fecha_factura || "").trim();
    const montoFactura = parseMonto(monto);
    const notaCreditoMonto = parseMonto(monto_nc);
    const abonoMonto = parseMonto(monto_abono);
    const pagadaValue = pagada === "1" ? 1 : 0;
    const fechaPagoFinal = pagadaValue ? (fecha_pago || new Date().toISOString().slice(0, 10)) : null;
    const periodoCierreFinal = pagadaValue ? normalizarPeriodoCierre(periodo_cierre, fechaPagoFinal) : null;
    const fechaNcFinal = notaCreditoMonto > 0 ? (fecha_nc || new Date().toISOString().slice(0, 10)) : null;
    const fechaAbonoFinal = abonoMonto > 0 ? (fecha_abono || new Date().toISOString().slice(0, 10)) : null;
    const fotoProductoPath = guardarFotoProducto(foto_producto_data, req.session.user.id);

    if (!["orden", "independiente"].includes(tipo)) {
      req.session.error = "Tipo de factura inválido.";
      return redirectFacturas(req, res);
    }

    if (!facturaNumero || !fechaFactura || montoFactura <= 0) {
      req.session.error = "Debe indicar número, fecha y monto de la factura.";
      return redirectFacturas(req, res);
    }

    if (notaCreditoMonto > montoFactura) {
      req.session.error = "La nota de crédito no puede ser mayor al monto de la factura.";
      return redirectFacturas(req, res);
    }

    const baseDespuesNc = Math.max(montoFactura - notaCreditoMonto, 0);
    if (abonoMonto > baseDespuesNc) {
      req.session.error = "El abono no puede ser mayor al saldo después de la nota de crédito.";
      return redirectFacturas(req, res);
    }

    if (tipo === "orden") {
      let sql = `
        UPDATE ordenes_compra
        SET factura = ?,
            factura_fecha = ?,
            fecha_vencimiento_factura = ?,
            total = ?,
            pagada = ?,
            fecha_pago = ?,
            periodo_cierre = ?,
            nota_credito_numero = ?,
            nota_credito_fecha = ?,
            nota_credito_monto = ?,
            nota_credito_motivo = ?,
            abono_monto = ?,
            abono_fecha = ?,
            abono_observacion = ?,
            factura_fecha_recepcion = ?,
            factura_tipo_entrega = ?,
            factura_entregado_por = ?,
            factura_recibido_por = ?,
            factura_producto_recibido = ?,
            factura_placa_producto = ?,
            factura_observacion = ?,
            facturada = 1,
            estado = 'RECIBIDA_TOTAL'
      `;
      const params = [
        facturaNumero,
        fechaFactura,
        fecha_vencimiento_factura || null,
        montoFactura,
        pagadaValue,
        fechaPagoFinal,
        periodoCierreFinal,
        notaCreditoMonto > 0 ? String(numero_nc || "").trim() || null : null,
        fechaNcFinal,
        notaCreditoMonto,
        notaCreditoMonto > 0 ? motivo_nc || null : null,
        abonoMonto,
        fechaAbonoFinal,
        abonoMonto > 0 ? observacion_abono || null : null,
        fecha_recepcion || null,
        tipo_entrega || null,
        entregado_por || null,
        recibido_por || null,
        producto_recibido === "1" ? 1 : 0,
        normalizarPlaca(placa_producto),
        observacion_recepcion || null
      ];

      if (fotoProductoPath) {
        sql += ", factura_foto_producto = ?";
        params.push(fotoProductoPath);
      }

      sql += " WHERE id = ? AND facturada = 1";
      params.push(id);

      const [result] = await pool.query(sql, params);
      if (!result.affectedRows) {
        req.session.error = "Factura de orden no encontrada.";
        return redirectFacturas(req, res);
      }
    } else {
      if (!proveedor_id) {
        req.session.error = "Debe seleccionar un proveedor para la factura independiente.";
        return redirectFacturas(req, res);
      }

      const [[proveedor]] = await pool.query("SELECT id, nombre FROM proveedores WHERE id = ?", [proveedor_id]);
      if (!proveedor) {
        req.session.error = "Proveedor no válido.";
        return redirectFacturas(req, res);
      }

      let sql = `
        UPDATE facturas
        SET numero_factura = ?,
            fecha = ?,
            monto = ?,
            proveedor_id = ?,
            proveedor_nombre = ?,
            pagada = ?,
            fecha_pago = ?,
            periodo_cierre = ?,
            nota_credito_numero = ?,
            nota_credito_fecha = ?,
            nota_credito_monto = ?,
            nota_credito_motivo = ?,
            abono_monto = ?,
            abono_fecha = ?,
            abono_observacion = ?,
            factura_fecha_recepcion = ?,
            factura_tipo_entrega = ?,
            factura_entregado_por = ?,
            factura_recibido_por = ?,
            factura_producto_recibido = ?,
            factura_placa_producto = ?,
            factura_observacion = ?
      `;
      const params = [
        facturaNumero,
        fechaFactura,
        montoFactura,
        proveedor.id,
        proveedor.nombre,
        pagadaValue,
        fechaPagoFinal,
        periodoCierreFinal,
        notaCreditoMonto > 0 ? String(numero_nc || "").trim() || null : null,
        fechaNcFinal,
        notaCreditoMonto,
        notaCreditoMonto > 0 ? motivo_nc || null : null,
        abonoMonto,
        fechaAbonoFinal,
        abonoMonto > 0 ? observacion_abono || null : null,
        fecha_recepcion || null,
        tipo_entrega || null,
        entregado_por || null,
        recibido_por || null,
        producto_recibido === "1" ? 1 : 0,
        normalizarPlaca(placa_producto),
        observacion_recepcion || null
      ];

      if (fotoProductoPath) {
        sql += ", factura_foto_producto = ?";
        params.push(fotoProductoPath);
      }

      sql += " WHERE id = ?";
      params.push(id);

      const [result] = await pool.query(sql, params);
      if (!result.affectedRows) {
        req.session.error = "Factura independiente no encontrada.";
        return redirectFacturas(req, res);
      }
    }

    req.session.success = `Factura ${facturaNumero} actualizada correctamente.`;
    return redirectFacturas(req, res);
  } catch (error) {
    console.error("Error editando factura:", error);
    req.session.error = error.message || "Error interno al editar la factura.";
    return redirectFacturas(req, res);
  }
});

router.post("/facturas/:id/eliminar", requireAuth, allowRoles(...ROLES_GESTION_FACTURAS), async (req, res) => {
  try {
    await ensureFacturasSchema();

    const id = req.params.id;
    const { tipo } = req.body;

    if (!["orden", "independiente"].includes(tipo)) {
      req.session.error = "Tipo de factura inválido.";
      return redirectFacturas(req, res);
    }

    if (tipo === "orden") {
      const [result] = await pool.query(
        `UPDATE ordenes_compra
         SET factura = NULL,
             factura_fecha = NULL,
             facturada = 0,
             fecha_vencimiento_factura = NULL,
             pagada = 0,
             fecha_pago = NULL,
             periodo_cierre = NULL,
             nota_credito_numero = NULL,
             nota_credito_fecha = NULL,
             nota_credito_monto = 0,
             nota_credito_motivo = NULL,
             abono_monto = 0,
             abono_fecha = NULL,
             abono_observacion = NULL,
             factura_fecha_recepcion = NULL,
             factura_tipo_entrega = NULL,
             factura_entregado_por = NULL,
             factura_recibido_por = NULL,
             factura_producto_recibido = 0,
             factura_placa_producto = NULL,
             factura_observacion = NULL,
             factura_foto_producto = NULL
         WHERE id = ? AND facturada = 1`,
        [id]
      );

      if (!result.affectedRows) {
        req.session.error = "Factura de orden no encontrada.";
        return redirectFacturas(req, res);
      }

      req.session.success = "Factura eliminada de la orden. La orden de compra se conserva.";
      return redirectFacturas(req, res);
    }

    const [result] = await pool.query("DELETE FROM facturas WHERE id = ?", [id]);
    if (!result.affectedRows) {
      req.session.error = "Factura independiente no encontrada.";
      return redirectFacturas(req, res);
    }

    req.session.success = "Factura independiente eliminada correctamente.";
    return redirectFacturas(req, res);
  } catch (error) {
    console.error("Error eliminando factura:", error);
    req.session.error = "Error interno al eliminar la factura.";
    return redirectFacturas(req, res);
  }
});

router.post("/facturas/:id/nota-credito", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    await ensureFacturasSchema();
    const id = req.params.id;
    const { tipo, numero_nc, fecha_nc, monto_nc, motivo_nc } = req.body;
    const montoNC = parseMonto(monto_nc);

    if (!["orden", "independiente"].includes(tipo)) {
      req.session.error = "Tipo de factura inválido para nota de crédito.";
      return res.redirect("/compras/facturas");
    }
    if (!numero_nc || !fecha_nc || montoNC <= 0) {
      req.session.error = "Debe completar número, fecha y monto de la nota de crédito.";
      return res.redirect("/compras/facturas");
    }

    const table = tipo === "orden" ? "ordenes_compra" : "facturas";
    const montoColumn = tipo === "orden" ? "total" : "monto";
    const extraWhere = tipo === "orden" ? "AND facturada = 1" : "";
    const [[factura]] = await pool.query(
      `SELECT id, ${montoColumn} AS monto, COALESCE(pagada, 0) AS pagada, COALESCE(abono_monto, 0) AS abono_monto
       FROM ${table}
       WHERE id = ? ${extraWhere}`,
      [id]
    );

    if (!factura) {
      req.session.error = "Factura no encontrada.";
      return res.redirect("/compras/facturas");
    }

    const montoFactura = parseMonto(factura.monto);
    if (montoNC > montoFactura) {
      req.session.error = "La nota de crédito no puede ser mayor al monto de la factura.";
      return res.redirect("/compras/facturas");
    }

    const cubiertaPorNC = montoNC + parseMonto(factura.abono_monto) >= montoFactura;
    await pool.query(
      `UPDATE ${table}
       SET nota_credito_numero = ?,
           nota_credito_fecha = ?,
           nota_credito_monto = ?,
           nota_credito_motivo = ?,
           pagada = CASE WHEN ? THEN 1 ELSE pagada END,
           fecha_pago = CASE WHEN ? THEN ? ELSE fecha_pago END,
           periodo_cierre = CASE WHEN ? THEN ? ELSE periodo_cierre END
       WHERE id = ?`,
      [
        numero_nc.trim(),
        fecha_nc,
        montoNC,
        motivo_nc || null,
        cubiertaPorNC,
        cubiertaPorNC,
        fecha_nc,
        cubiertaPorNC,
        normalizarPeriodoCierre(null, fecha_nc),
        id
      ]
    );

    req.session.success = cubiertaPorNC
      ? "Nota de crédito registrada. La factura quedó cubierta por NC."
      : "Nota de crédito registrada correctamente.";
    res.redirect("/compras/facturas");
  } catch (error) {
    console.error("Error registrando nota de crédito:", error);
    req.session.error = "Error interno al registrar la nota de crédito.";
    res.redirect("/compras/facturas");
  }
});

router.post("/facturas/:id/abono", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    await ensureFacturasSchema();

    const id = req.params.id;
    const { tipo, monto_abono, fecha_abono, observacion_abono, periodo_cierre } = req.body;
    const montoAbono = parseMonto(monto_abono);
    const fechaAbono = fecha_abono || new Date().toISOString().slice(0, 10);
    const periodoCierre = normalizarPeriodoCierre(periodo_cierre, fechaAbono);

    if (!["orden", "independiente"].includes(tipo)) {
      req.session.error = "Tipo de factura inválido para abono.";
      return res.redirect("/compras/facturas");
    }

    if (montoAbono <= 0) {
      req.session.error = "El monto del abono debe ser mayor a cero.";
      return res.redirect("/compras/facturas");
    }

    const table = tipo === "orden" ? "ordenes_compra" : "facturas";
    const montoColumn = tipo === "orden" ? "total" : "monto";
    const extraWhere = tipo === "orden" ? "AND facturada = 1" : "";

    const [[factura]] = await pool.query(
      `SELECT id,
              ${montoColumn} AS monto,
              COALESCE(nota_credito_monto, 0) AS nota_credito_monto,
              COALESCE(abono_monto, 0) AS abono_monto,
              COALESCE(pagada, 0) AS pagada
       FROM ${table}
       WHERE id = ? ${extraWhere}`,
      [id]
    );

    if (!factura) {
      req.session.error = "Factura no encontrada.";
      return res.redirect("/compras/facturas");
    }

    const saldos = calcularSaldoFactura(factura.monto, factura.nota_credito_monto, factura.abono_monto, factura.pagada);
    if (saldos.saldo <= 0) {
      req.session.error = "La factura no tiene saldo pendiente para abonar.";
      return res.redirect("/compras/facturas");
    }

    if (montoAbono > saldos.saldo) {
      req.session.error = `El abono no puede ser mayor al saldo pendiente: ₡${saldos.saldo.toLocaleString("es-CR")}.`;
      return res.redirect("/compras/facturas");
    }

    const nuevoAbono = saldos.abonoMonto + montoAbono;
    const pagadaCompleta = nuevoAbono >= saldos.basePagar;

    await pool.query(
      `UPDATE ${table}
       SET abono_monto = ?,
           abono_fecha = ?,
           abono_observacion = ?,
           pagada = CASE WHEN ? THEN 1 ELSE pagada END,
           fecha_pago = CASE WHEN ? THEN ? ELSE fecha_pago END,
           periodo_cierre = CASE WHEN ? THEN ? ELSE periodo_cierre END
       WHERE id = ?`,
      [
        nuevoAbono,
        fechaAbono,
        observacion_abono || null,
        pagadaCompleta,
        pagadaCompleta,
        fechaAbono,
        pagadaCompleta,
        periodoCierre,
        id
      ]
    );

    req.session.success = pagadaCompleta
      ? "Abono registrado. La factura quedó pagada completamente."
      : "Abono registrado correctamente.";
    res.redirect("/compras/facturas");
  } catch (error) {
    console.error("Error registrando abono:", error);
    req.session.error = "Error interno al registrar el abono.";
    res.redirect("/compras/facturas");
  }
});

router.post("/facturas/:id/pagar", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    await ensureFacturasSchema();
    const id = req.params.id;
    const { tipo } = req.body;
    const fechaPago = String(req.body.fecha_pago || "").trim();
    const periodoCierre = normalizarPeriodoCierre(req.body.periodo_cierre, fechaPago);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaPago)) {
      req.session.error = "Debe indicar una fecha de pago válida.";
      return res.redirect("/compras/facturas");
    }

    if (tipo === 'orden') {
      const [result] = await pool.query(
        `UPDATE ordenes_compra
         SET pagada = 1,
             fecha_pago = ?,
             periodo_cierre = ?,
             abono_monto = GREATEST(total - COALESCE(nota_credito_monto, 0), COALESCE(abono_monto, 0)),
             abono_fecha = ?
         WHERE id = ?
           AND facturada = 1
           AND COALESCE(pagada, 0) = 0
           AND GREATEST(total - COALESCE(nota_credito_monto, 0) - COALESCE(abono_monto, 0), 0) > 0`,
        [fechaPago, periodoCierre || fechaPago.slice(0, 7), fechaPago, id]
      );
      if (!result.affectedRows) {
        req.session.error = "La factura de orden no existe, ya estaba pagada o no tiene saldo pendiente.";
        return res.redirect("/compras/facturas");
      }
    } else if (tipo === 'independiente') {
      const [result] = await pool.query(
        `UPDATE facturas
         SET pagada = 1,
             fecha_pago = ?,
             periodo_cierre = ?,
             abono_monto = GREATEST(monto - COALESCE(nota_credito_monto, 0), COALESCE(abono_monto, 0)),
             abono_fecha = ?
         WHERE id = ?
           AND COALESCE(pagada, 0) = 0
           AND GREATEST(monto - COALESCE(nota_credito_monto, 0) - COALESCE(abono_monto, 0), 0) > 0`,
        [fechaPago, periodoCierre || fechaPago.slice(0, 7), fechaPago, id]
      );
      if (!result.affectedRows) {
        req.session.error = "La factura independiente no existe, ya estaba pagada o no tiene saldo pendiente.";
        return res.redirect("/compras/facturas");
      }
    } else {
      req.session.error = "Tipo de factura inválido.";
      return res.redirect("/compras/facturas");
    }

    req.session.success = `Factura marcada como pagada el ${new Date(`${fechaPago}T00:00:00`).toLocaleDateString("es-CR")}.`;
    res.redirect("/compras/facturas");
  } catch (error) {
    console.error("Error al pagar factura:", error);
    req.session.error = "Error interno al pagar la factura.";
    res.redirect("/compras/facturas");
  }
});

router.get("/facturas/recibo-preview", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    const fechaPago = new Date().toISOString().slice(0, 10);
    const facturas = [
      {
        po_numero: "2026-1200",
        proveedor_nombre: "MAXI REPUESTOS SRL",
        factura: "F-001258",
        fecha_vencimiento_factura: "2026-08-30",
        nota_credito_monto: 0,
        abono_monto: 0,
        total: 125000,
        observacion: "Pago completo de repuestos para unidad C164415."
      },
      {
        po_numero: "2026-1201",
        proveedor_nombre: "Q.C. CASA DEL CAMION S.A.",
        factura: "FAC-8841",
        fecha_vencimiento_factura: "2026-09-05",
        nota_credito_monto: 7500,
        abono_monto: 15000,
        total: 98500,
        observacion: "Aplica nota de credito y abono previo registrado."
      },
      {
        po_numero: "-",
        proveedor_nombre: "SERVIREPUESTOS NAVARRO",
        factura: "A-00452",
        fecha_vencimiento_factura: "2026-08-22",
        nota_credito_monto: 0,
        abono_monto: 0,
        total: 46250,
        observacion: "Factura independiente recibida en proveeduria."
      }
    ];
    const totalPagado = facturas.reduce((sum, f) => sum + Number(f.total || 0), 0);
    const logoPath = path.join(__dirname, "../../public/img/logo_tomza.jpg");
    const logoDataUri = fs.existsSync(logoPath)
      ? `data:image/jpeg;base64,${fs.readFileSync(logoPath).toString("base64")}`
      : "";

    res.render("compras/recibo_pago", {
      facturas,
      fechaPago,
      totalPagado,
      logoDataUri,
      reciboNumero: `RP-VISTA-${fechaPago.replace(/-/g, "")}`,
      generadoPor: req.session.user?.usuario || "Sistema"
    });
  } catch (error) {
    console.error("Error generando vista previa del recibo:", error);
    res.status(500).send("Error generando vista previa del recibo");
  }
});

router.post("/facturas/pagar-multiple", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    await ensureFacturasSchema();
    const { facturas_ids } = req.body;
    const seleccionadas = toArray(facturas_ids).map(parseFacturaRef).filter(Boolean);
    const fechaPago = String(req.body.fecha_pago || "").trim();
    const periodoCierre = normalizarPeriodoCierre(req.body.periodo_cierre, fechaPago);

    if (!seleccionadas.length) {
      req.session.error = "No seleccionó ninguna factura.";
      return res.redirect("/compras/facturas");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaPago)) {
      req.session.error = "Debe indicar una fecha de pago válida.";
      return res.redirect("/compras/facturas");
    }

    const ordenIds = seleccionadas.filter(f => f.tipo === 'orden').map(f => f.id);
    const independientesIds = seleccionadas.filter(f => f.tipo === 'independiente').map(f => f.id);
    const facturas = [];

    if (ordenIds.length) {
      const placeholders = ordenIds.map(() => '?').join(',');
      const [ordenes] = await pool.query(`
        SELECT
          o.id,
          o.po_numero,
          GREATEST(o.total - COALESCE(o.nota_credito_monto, 0) - COALESCE(o.abono_monto, 0), 0) as total,
          o.factura,
          o.fecha_vencimiento_factura,
          COALESCE(o.nota_credito_monto, 0) as nota_credito_monto,
          COALESCE(o.abono_monto, 0) as abono_monto,
          o.nota_credito_numero,
          o.factura_observacion,
          o.abono_observacion,
          o.nota_credito_motivo,
          COALESCE(
            NULLIF(o.factura_observacion, ''),
            NULLIF(o.abono_observacion, ''),
            NULLIF(o.nota_credito_motivo, ''),
            NULLIF(o.observaciones, '')
          ) as observacion,
          p.nombre as proveedor_nombre,
          'orden' as tipo
        FROM ordenes_compra o
        JOIN proveedores p ON p.id = o.proveedor_id
        WHERE o.id IN (${placeholders})
          AND o.facturada = 1
          AND COALESCE(o.pagada, 0) = 0
          AND GREATEST(o.total - COALESCE(o.nota_credito_monto, 0) - COALESCE(o.abono_monto, 0), 0) > 0
      `, ordenIds);
      facturas.push(...ordenes);
    }

    if (independientesIds.length) {
      const placeholders = independientesIds.map(() => '?').join(',');
      const [independientes] = await pool.query(`
        SELECT
          f.id,
          NULL as po_numero,
          GREATEST(f.monto - COALESCE(f.nota_credito_monto, 0) - COALESCE(f.abono_monto, 0), 0) as total,
          f.numero_factura as factura,
          NULL as fecha_vencimiento_factura,
          COALESCE(f.nota_credito_monto, 0) as nota_credito_monto,
          COALESCE(f.abono_monto, 0) as abono_monto,
          f.nota_credito_numero,
          f.factura_observacion,
          f.abono_observacion,
          f.nota_credito_motivo,
          COALESCE(
            NULLIF(f.factura_observacion, ''),
            NULLIF(f.abono_observacion, ''),
            NULLIF(f.nota_credito_motivo, '')
          ) as observacion,
          f.proveedor_nombre,
          'independiente' as tipo
        FROM facturas f
        WHERE f.id IN (${placeholders})
          AND COALESCE(f.pagada, 0) = 0
          AND GREATEST(f.monto - COALESCE(f.nota_credito_monto, 0) - COALESCE(f.abono_monto, 0), 0) > 0
      `, independientesIds);
      facturas.push(...independientes);
    }

    if (facturas.length === 0) {
      req.session.error = "Las facturas seleccionadas ya estaban pagadas o no existen.";
      return res.redirect("/compras/facturas");
    }

    if (ordenIds.length) {
      const placeholders = ordenIds.map(() => '?').join(',');
      await pool.query(
        `UPDATE ordenes_compra
         SET pagada = 1,
             fecha_pago = ?,
             periodo_cierre = ?,
             abono_monto = GREATEST(total - COALESCE(nota_credito_monto, 0), COALESCE(abono_monto, 0)),
             abono_fecha = ?
         WHERE id IN (${placeholders})
           AND facturada = 1
           AND COALESCE(pagada, 0) = 0
           AND GREATEST(total - COALESCE(nota_credito_monto, 0) - COALESCE(abono_monto, 0), 0) > 0`,
        [fechaPago, periodoCierre || fechaPago.slice(0, 7), fechaPago, ...ordenIds]
      );
    }

    if (independientesIds.length) {
      const placeholders = independientesIds.map(() => '?').join(',');
      await pool.query(
        `UPDATE facturas
         SET pagada = 1,
             fecha_pago = ?,
             periodo_cierre = ?,
             abono_monto = GREATEST(monto - COALESCE(nota_credito_monto, 0), COALESCE(abono_monto, 0)),
             abono_fecha = ?
         WHERE id IN (${placeholders})
           AND COALESCE(pagada, 0) = 0
           AND GREATEST(monto - COALESCE(nota_credito_monto, 0) - COALESCE(abono_monto, 0), 0) > 0`,
        [fechaPago, periodoCierre || fechaPago.slice(0, 7), fechaPago, ...independientesIds]
      );
    }

    const totalPagado = facturas.reduce((sum, f) => sum + parseFloat(f.total), 0);
    const logoPath = path.join(__dirname, "../../public/img/logo_tomza.jpg");
    const logoDataUri = fs.existsSync(logoPath)
      ? `data:image/jpeg;base64,${fs.readFileSync(logoPath).toString("base64")}`
      : "";
    const reciboNumero = `RP-${fechaPago.replace(/-/g, "")}-${String(Date.now()).slice(-6)}`;
    const { generarPDFReciboPago } = require("../utils/pdfReciboPago");
    const buffer = await generarPDFReciboPago({
      facturas,
      fechaPago,
      totalPagado,
      logoDataUri,
      reciboNumero,
      generadoPor: req.session.user?.usuario || "Sistema"
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=recibo_pago_${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.pdf`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch (error) {
    console.error("Error al procesar pago múltiple:", error);
    res.status(500).send("Error al procesar el pago múltiple");
  }
});

// ===================== DASHBOARD DE ANÁLISIS =====================
router.get("/dashboard", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    await ensureOrdenPlacaColumn();
    await ensureOrdenDetalleCodigoProductoColumn();

    const { proveedor_id, fecha_desde, fecha_hasta, estado } = req.query;
    const condiciones = [];
    const params = [];
    if (proveedor_id && proveedor_id !== '') {
      condiciones.push("o.proveedor_id = ?");
      params.push(proveedor_id);
    }
    if (fecha_desde && fecha_desde !== '') {
      condiciones.push("o.fecha >= ?");
      params.push(fecha_desde);
    }
    if (fecha_hasta && fecha_hasta !== '') {
      condiciones.push("o.fecha <= ?");
      params.push(fecha_hasta);
    }
    if (estado && estado !== '') {
      condiciones.push("o.estado = ?");
      params.push(estado);
    }
    let whereClause = "";
    let joinConditions = "";
    if (condiciones.length) {
      whereClause = "WHERE " + condiciones.join(" AND ");
      joinConditions = "AND " + condiciones.join(" AND ");
    }
    const [[totalGasto]] = await pool.query(`
      SELECT COALESCE(SUM(o.total), 0) as total
      FROM ordenes_compra o
      ${whereClause}
    `, params);
    const [topProveedores] = await pool.query(`
      SELECT p.nombre, SUM(o.total) as total_gastado
      FROM ordenes_compra o
      JOIN proveedores p ON p.id = o.proveedor_id
      ${whereClause}
      GROUP BY o.proveedor_id
      ORDER BY total_gastado DESC
      LIMIT 5
    `, params);
    let mensualWhere = "";
    if (condiciones.length) {
      mensualWhere = "WHERE " + condiciones.join(" AND ") + " AND o.fecha >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)";
    } else {
      mensualWhere = "WHERE o.fecha >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)";
    }
    const [gastoMensual] = await pool.query(`
      SELECT 
        DATE_FORMAT(o.fecha, '%Y-%m') as mes,
        SUM(o.total) as total
      FROM ordenes_compra o
      ${mensualWhere}
      GROUP BY mes
      ORDER BY mes ASC
    `, params);
    let productosWhere = "";
    if (condiciones.length) {
      productosWhere = "WHERE " + condiciones.join(" AND ");
    }
    const [topProductos] = await pool.query(`
      SELECT 
        d.descripcion,
        SUM(d.cantidad) as total_cantidad,
        SUM(d.subtotal) as total_monto
      FROM ordenes_compra_detalle d
      JOIN ordenes_compra o ON o.id = d.orden_compra_id
      ${productosWhere}
      GROUP BY d.descripcion
      ORDER BY total_cantidad DESC
      LIMIT 5
    `, params);
    let estadosWhere = "";
    if (condiciones.length) {
      estadosWhere = "WHERE " + condiciones.join(" AND ");
    }
    const [ordenesPorEstado] = await pool.query(`
      SELECT estado, COUNT(*) as cantidad
      FROM ordenes_compra o
      ${estadosWhere}
      GROUP BY estado
    `, params);
    let gastoProvWhere = "";
    if (condiciones.length) {
      gastoProvWhere = "WHERE " + condiciones.join(" AND ");
    }
    const [gastoPorProveedor] = await pool.query(`
      SELECT p.nombre, SUM(o.total) as total_gastado
      FROM ordenes_compra o
      JOIN proveedores p ON p.id = o.proveedor_id
      ${gastoProvWhere}
      GROUP BY o.proveedor_id
      ORDER BY total_gastado DESC
      LIMIT 10
    `, params);
    // SOLO PROVEEDORES CON GASTO > 0
    const [todosProveedoresGasto] = await pool.query(`
      SELECT p.id, p.nombre, COALESCE(SUM(o.total), 0) as total_gastado
      FROM proveedores p
      LEFT JOIN ordenes_compra o ON o.proveedor_id = p.id ${joinConditions}
      GROUP BY p.id
      HAVING total_gastado > 0
      ORDER BY total_gastado DESC
    `, params);
    const [gastosPorPlaca] = await pool.query(`
      SELECT
        compras.placa,
        CASE
          WHEN compras.placa = 'ACEITES' THEN 'Aceites'
          WHEN compras.placa = 'GENERALES GASTOS' THEN 'Generales de gastos'
          WHEN compras.placa = 'GENERALES TALLER' THEN 'General taller'
          ELSE COALESCE(MAX(u.sede), 'Por revisar')
        END AS sede,
        COUNT(DISTINCT compras.id) AS ordenes,
        COALESCE(SUM(compras.monto_linea), 0) AS total_gastado,
        MAX(compras.ultima_fecha) AS ultima_fecha
      FROM (
        SELECT
          o.id,
          UPPER(TRIM(COALESCE(
            CASE
              WHEN UPPER(TRIM(COALESCE(d.codigo, ''))) IN ('ACEITE', 'ACEITES') THEN 'ACEITES'
            END,
            CASE
              WHEN UPPER(CONCAT_WS(' ', d.descripcion, d.codigo, p.nombre)) REGEXP 'ACEITE|ACEITES|MOBIL|MOVIL|PICO|LIASA' THEN 'ACEITES'
            END,
            REPLACE(REGEXP_SUBSTR(UPPER(COALESCE(d.codigo, '')), 'CL[[:space:]]*[0-9]{5,6}|C[[:space:]]*[0-9]{5,6}|S[[:space:]]*[0-9]{5,6}'), ' ', ''),
            CASE
              WHEN UPPER(TRIM(COALESCE(d.codigo, ''))) IN ('GENERAL GASTOS', 'GENERALES GASTOS', 'GASTOS GENERAL', 'GASTOS GENERALES', 'GENERALES DE GASTOS') THEN 'GENERALES GASTOS'
            END,
            CASE
              WHEN UPPER(TRIM(COALESCE(d.codigo, ''))) IN ('GENERAL', 'GENERALES', 'GENERAL TALLER', 'GENERALES TALLER') THEN 'GENERALES TALLER'
            END,
            CASE
              WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 AND (
                UPPER(TRIM(COALESCE(o.placa_unidad, ''))) IN ('ACEITE', 'ACEITES')
                OR COALESCE(aceites_detalle.tiene_aceites, 0) > 0
                OR UPPER(CONCAT_WS(' ', o.observaciones, p.nombre)) REGEXP 'ACEITE|ACEITES|MOBIL|MOVIL|PICO|LIASA'
              ) THEN 'ACEITES'
            END,
            CASE
              WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 AND UPPER(TRIM(COALESCE(o.placa_unidad, ''))) IN ('GENERAL GASTOS', 'GENERALES GASTOS', 'GASTOS GENERAL', 'GASTOS GENERALES', 'GENERALES DE GASTOS') THEN 'GENERALES GASTOS'
            END,
            CASE
              WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 AND UPPER(TRIM(COALESCE(o.placa_unidad, ''))) IN ('GENERAL', 'GENERALES', 'GENERAL TALLER', 'GENERALES TALLER') THEN 'GENERALES TALLER'
            END,
            CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 THEN NULLIF(REPLACE(UPPER(TRIM(o.placa_unidad)), ' ', ''), '') END,
            CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 THEN REPLACE(REGEXP_SUBSTR(UPPER(COALESCE(o.observaciones, '')), 'CL[[:space:]]*[0-9]{5,6}|C[[:space:]]*[0-9]{5,6}|S[[:space:]]*[0-9]{5,6}'), ' ', '') END,
            'SIN PLACA'
          ))) AS placa,
          CASE
            WHEN d.id IS NULL THEN COALESCE(o.total, 0)
            ELSE COALESCE(d.subtotal, d.cantidad * d.precio_unitario, 0)
          END AS monto_linea,
          o.fecha AS ultima_fecha
        FROM ordenes_compra o
        LEFT JOIN (
          SELECT orden_compra_id, COUNT(*) AS tiene_placas
          FROM ordenes_compra_detalle
          WHERE REGEXP_SUBSTR(UPPER(COALESCE(codigo, '')), 'CL[[:space:]]*[0-9]{5,6}|C[[:space:]]*[0-9]{5,6}|S[[:space:]]*[0-9]{5,6}') IS NOT NULL
          GROUP BY orden_compra_id
        ) placas_detalle ON placas_detalle.orden_compra_id = o.id
        LEFT JOIN (
          SELECT orden_compra_id, COUNT(*) AS tiene_aceites
          FROM ordenes_compra_detalle
          WHERE UPPER(CONCAT_WS(' ', codigo, descripcion)) REGEXP 'ACEITE|ACEITES|MOBIL|MOVIL|PICO|LIASA'
          GROUP BY orden_compra_id
        ) aceites_detalle ON aceites_detalle.orden_compra_id = o.id
        LEFT JOIN proveedores p ON p.id = o.proveedor_id
        LEFT JOIN ordenes_compra_detalle d ON d.orden_compra_id = o.id AND COALESCE(placas_detalle.tiene_placas, 0) > 0
        ${whereClause}
      ) compras
      LEFT JOIN unidades u ON REPLACE(UPPER(TRIM(u.placa)), ' ', '') = compras.placa
      WHERE compras.placa <> 'SIN PLACA'
      GROUP BY compras.placa
      ORDER BY total_gastado DESC
    `, params);

    const gastosPorPlacaAgrupados = agruparGastosPorPlaca(gastosPorPlaca || []);
    const comprasPorPlaca = {};
    const placasDashboard = (gastosPorPlaca || []).map(item => item.placa).filter(Boolean);
    if (placasDashboard.length) {
      const [detalleComprasPorPlaca] = await pool.query(`
        SELECT
          base.placa,
          o.id,
          o.po_numero,
          o.fecha,
          o.estado,
          o.total AS total_orden,
          o.observaciones,
          p.nombre AS proveedor,
          d.id AS detalle_id,
          d.codigo,
          d.codigo_producto,
          d.descripcion,
          d.cantidad,
          d.precio_unitario,
          d.subtotal,
          base.monto_linea
        FROM (
          SELECT
            o.id,
            d.id AS detalle_id,
            UPPER(TRIM(COALESCE(
              CASE
                WHEN UPPER(TRIM(COALESCE(d.codigo, ''))) IN ('ACEITE', 'ACEITES') THEN 'ACEITES'
              END,
              CASE
                WHEN UPPER(CONCAT_WS(' ', d.descripcion, d.codigo, p.nombre)) REGEXP 'ACEITE|ACEITES|MOBIL|MOVIL|PICO|LIASA' THEN 'ACEITES'
              END,
              REPLACE(REGEXP_SUBSTR(UPPER(COALESCE(d.codigo, '')), 'CL[[:space:]]*[0-9]{5,6}|C[[:space:]]*[0-9]{5,6}|S[[:space:]]*[0-9]{5,6}'), ' ', ''),
              CASE
                WHEN UPPER(TRIM(COALESCE(d.codigo, ''))) IN ('GENERAL GASTOS', 'GENERALES GASTOS', 'GASTOS GENERAL', 'GASTOS GENERALES', 'GENERALES DE GASTOS') THEN 'GENERALES GASTOS'
              END,
              CASE
                WHEN UPPER(TRIM(COALESCE(d.codigo, ''))) IN ('GENERAL', 'GENERALES', 'GENERAL TALLER', 'GENERALES TALLER') THEN 'GENERALES TALLER'
              END,
              CASE
                WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 AND (
                  UPPER(TRIM(COALESCE(o.placa_unidad, ''))) IN ('ACEITE', 'ACEITES')
                  OR COALESCE(aceites_detalle.tiene_aceites, 0) > 0
                  OR UPPER(CONCAT_WS(' ', o.observaciones, p.nombre)) REGEXP 'ACEITE|ACEITES|MOBIL|MOVIL|PICO|LIASA'
                ) THEN 'ACEITES'
              END,
              CASE
                WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 AND UPPER(TRIM(COALESCE(o.placa_unidad, ''))) IN ('GENERAL GASTOS', 'GENERALES GASTOS', 'GASTOS GENERAL', 'GASTOS GENERALES', 'GENERALES DE GASTOS') THEN 'GENERALES GASTOS'
              END,
              CASE
                WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 AND UPPER(TRIM(COALESCE(o.placa_unidad, ''))) IN ('GENERAL', 'GENERALES', 'GENERAL TALLER', 'GENERALES TALLER') THEN 'GENERALES TALLER'
              END,
              CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 THEN NULLIF(REPLACE(UPPER(TRIM(o.placa_unidad)), ' ', ''), '') END,
              CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 THEN REPLACE(REGEXP_SUBSTR(UPPER(COALESCE(o.observaciones, '')), 'CL[[:space:]]*[0-9]{5,6}|C[[:space:]]*[0-9]{5,6}|S[[:space:]]*[0-9]{5,6}'), ' ', '') END,
              'SIN PLACA'
            ))) AS placa,
            CASE
              WHEN d.id IS NULL THEN COALESCE(o.total, 0)
              ELSE COALESCE(d.subtotal, d.cantidad * d.precio_unitario, 0)
            END AS monto_linea
          FROM ordenes_compra o
          LEFT JOIN (
            SELECT orden_compra_id, COUNT(*) AS tiene_placas
            FROM ordenes_compra_detalle
            WHERE REGEXP_SUBSTR(UPPER(COALESCE(codigo, '')), 'CL[[:space:]]*[0-9]{5,6}|C[[:space:]]*[0-9]{5,6}|S[[:space:]]*[0-9]{5,6}') IS NOT NULL
            GROUP BY orden_compra_id
          ) placas_detalle ON placas_detalle.orden_compra_id = o.id
          LEFT JOIN (
            SELECT orden_compra_id, COUNT(*) AS tiene_aceites
            FROM ordenes_compra_detalle
            WHERE UPPER(CONCAT_WS(' ', codigo, descripcion)) REGEXP 'ACEITE|ACEITES|MOBIL|MOVIL|PICO|LIASA'
            GROUP BY orden_compra_id
          ) aceites_detalle ON aceites_detalle.orden_compra_id = o.id
          LEFT JOIN proveedores p ON p.id = o.proveedor_id
          LEFT JOIN ordenes_compra_detalle d ON d.orden_compra_id = o.id AND COALESCE(placas_detalle.tiene_placas, 0) > 0
          ${whereClause}
        ) base
        JOIN ordenes_compra o ON o.id = base.id
        LEFT JOIN proveedores p ON p.id = o.proveedor_id
        LEFT JOIN ordenes_compra_detalle d ON d.id = base.detalle_id
        WHERE base.placa IN (?)
        ORDER BY base.placa ASC, o.fecha DESC, o.id DESC, d.id ASC
      `, [...params, placasDashboard]);

      detalleComprasPorPlaca.forEach(row => {
        if (!comprasPorPlaca[row.placa]) comprasPorPlaca[row.placa] = [];
        let orden = comprasPorPlaca[row.placa].find(item => item.id === row.id);
        if (!orden) {
          orden = {
            id: row.id,
            po_numero: row.po_numero,
            fecha: row.fecha,
            estado: row.estado,
            total: 0,
            total_orden: row.total_orden,
            observaciones: row.observaciones,
            proveedor: row.proveedor,
            lineas: []
          };
          comprasPorPlaca[row.placa].push(orden);
        }

        orden.total += Number(row.monto_linea || 0);

        if (row.detalle_id) {
          orden.lineas.push({
            codigo: row.codigo,
            codigo_producto: row.codigo_producto,
            descripcion: row.descripcion,
            cantidad: row.cantidad,
            precio_unitario: row.precio_unitario,
            subtotal: row.monto_linea || row.subtotal
          });
        }
      });
    }

    const [proveedores] = await pool.query("SELECT id, nombre FROM proveedores ORDER BY nombre");
    const estadosList = ['BORRADOR', 'ENVIADA', 'RECIBIDA_PARCIAL', 'RECIBIDA_TOTAL'];
    res.render("compras/dashboard_compras", {
      user: req.session.user,
      totalGasto: totalGasto.total || 0,
      topProveedores: topProveedores || [],
      gastoMensual: gastoMensual || [],
      topProductos: topProductos || [],
      ordenesPorEstado: ordenesPorEstado || [],
      gastoPorProveedor: gastoPorProveedor || [],
      todosProveedoresGasto: todosProveedoresGasto || [],
      gastosPorPlaca: gastosPorPlaca || [],
      gastosPorPlacaAgrupados,
      comprasPorPlaca,
      proveedores: proveedores,
      estados: estadosList,
      filtros: { proveedor_id, fecha_desde, fecha_hasta, estado }
    });
  } catch (error) {
    console.error("Error en dashboard de compras:", error);
    res.status(500).send("Error cargando estadísticas");
  }
});

// ===================== PDF: REPORTE DE GASTO POR PROVEEDOR (SOLO GASTO >0, FUERZA DESCARGA) =====================
router.get("/dashboard/proveedores/pdf", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    const { proveedor_id, fecha_desde, fecha_hasta, estado } = req.query;
    const condiciones = [];
    const params = [];
    if (proveedor_id && proveedor_id !== '') {
      condiciones.push("o.proveedor_id = ?");
      params.push(proveedor_id);
    }
    if (fecha_desde && fecha_desde !== '') {
      condiciones.push("o.fecha >= ?");
      params.push(fecha_desde);
    }
    if (fecha_hasta && fecha_hasta !== '') {
      condiciones.push("o.fecha <= ?");
      params.push(fecha_hasta);
    }
    if (estado && estado !== '') {
      condiciones.push("o.estado = ?");
      params.push(estado);
    }
    let joinConditions = "";
    if (condiciones.length) {
      joinConditions = "AND " + condiciones.join(" AND ");
    }
    const [todosProveedoresGasto] = await pool.query(`
      SELECT p.id, p.nombre, COALESCE(SUM(o.total), 0) as total_gastado
      FROM proveedores p
      LEFT JOIN ordenes_compra o ON o.proveedor_id = p.id ${joinConditions}
      GROUP BY p.id
      HAVING total_gastado > 0
      ORDER BY total_gastado DESC
    `, params);
    let proveedorNombreFiltro = null;
    if (proveedor_id && proveedor_id !== '') {
      const [[prov]] = await pool.query("SELECT nombre FROM proveedores WHERE id = ?", [proveedor_id]);
      if (prov) proveedorNombreFiltro = prov.nombre;
    }
    let totalGeneral = 0;
    todosProveedoresGasto.forEach(p => totalGeneral += parseFloat(p.total_gastado) || 0);
    const ejs = require('ejs');
    const path = require('path');
    const pdf = require('html-pdf');
    const templatePath = path.join(__dirname, '../views/compras/proveedores_gasto_pdf.ejs');
    const html = await ejs.renderFile(templatePath, {
      proveedores: todosProveedoresGasto,
      totalGeneral: totalGeneral,
      filtros: { proveedor_id, proveedor_nombre: proveedorNombreFiltro, fecha_desde, fecha_hasta, estado },
      fechaGeneracion: new Date().toLocaleString('es-CR')
    });
    const options = { format: 'Letter', orientation: 'portrait' };
    pdf.create(html, options).toBuffer((err, buffer) => {
      if (err) {
        console.error("Error generando PDF de proveedores:", err);
        return res.status(500).send("Error al generar el PDF");
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=reporte_gasto_proveedores_${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.pdf`);
      res.setHeader('Content-Length', buffer.length);
      res.end(buffer);
    });
  } catch (error) {
    console.error("Error en PDF de proveedores:", error);
    res.status(500).send("Error generando el reporte");
  }
});

console.log("✅ Rutas de compras cargadas correctamente");
module.exports = router;
