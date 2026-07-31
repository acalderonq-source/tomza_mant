const express = require("express");
const router = express.Router();
const pool = require("../db");
const fs = require("fs");
const path = require("path");
const { generarPDFOrden } = require('../utils/pdfOrdenCompra');

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
  const placa = String(value || "").trim().toUpperCase();
  return placa || null;
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

async function ensureOrdenPlacaColumn() {
  if (!(await columnExists("ordenes_compra", "placa_unidad"))) {
    await queryWithRetry("ALTER TABLE ordenes_compra ADD COLUMN placa_unidad VARCHAR(50) NULL");
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

async function obtenerFacturasCompras(filtros = {}) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const { proveedor_id, fecha_desde, fecha_hasta, pagada, vencida } = filtros;
  const orden = filtros.orden === "asc" ? "asc" : "desc";

  let sqlOrdenes = `
    SELECT
      o.id,
      o.po_numero,
      COALESCE(o.factura_fecha, o.fecha) as fecha,
      o.total as monto,
      o.factura as numero_factura,
      o.fecha_vencimiento_factura,
      o.pagada,
      o.fecha_pago,
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
    FROM ordenes_compra o
    JOIN proveedores p ON p.id = o.proveedor_id
    WHERE o.facturada = 1
  `;
  let sqlIndependientes = `
    SELECT
      f.id,
      NULL as po_numero,
      f.fecha,
      f.monto,
      f.numero_factura,
      NULL as fecha_vencimiento_factura,
      f.pagada,
      f.fecha_pago,
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
  if (pagada !== undefined && pagada !== "") {
    const pagadaVal = pagada === "1" ? 1 : 0;
    sqlOrdenes += ` AND COALESCE(o.pagada, 0) = ?`;
    sqlIndependientes += ` AND COALESCE(f.pagada, 0) = ?`;
    paramsOrdenes.push(pagadaVal);
    paramsIndependientes.push(pagadaVal);
  }

  const orderDirection = orden === "asc" ? "ASC" : "DESC";
  const finalSql = `(${sqlOrdenes}) UNION ALL (${sqlIndependientes}) ORDER BY fecha ${orderDirection}, id ${orderDirection}`;
  const params = [...paramsOrdenes, ...paramsIndependientes];
  const [facturasUnidas] = await queryWithRetry(finalSql, params);

  const facturasConEstado = facturasUnidas.map(f => {
    const saldos = calcularSaldoFactura(f.monto, f.nota_credito_monto, f.abono_monto, f.pagada);
    return {
      ...f,
      monto_original: saldos.montoOriginal,
      nota_credito_monto: saldos.notaCreditoMonto,
      abono_monto: saldos.abonoMonto,
      saldo: saldos.saldo,
      cubierta_por_nc: saldos.notaCreditoMonto > 0 && saldos.basePagar <= 0,
      tiene_nc: saldos.notaCreditoMonto > 0 || Boolean(f.nota_credito_numero),
      tiene_abono: saldos.abonoMonto > 0,
      vencida: (f.tipo === "orden" && !f.pagada && saldos.saldo > 0 && f.fecha_vencimiento_factura && new Date(f.fecha_vencimiento_factura) < hoy)
    };
  });

  if (vencida === "1") {
    return facturasConEstado.filter(f => f.vencida);
  }

  return facturasConEstado;
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
    sql += ` AND o.placa_unidad LIKE ?`;
    params.push(`%${placaFiltro}%`);
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
    await ensureOrdenCotizacionColumns();
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
    await ensureOrdenCotizacionColumns();
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
    await ensureOrdenCotizacionColumns();
    await connection.beginTransaction();

    const po_numero = await generarNumeroPO();
    const fecha = new Date().toISOString().slice(0, 10);

    const { proveedor_id, forma_pago, moneda, placa_unidad, lineas, observaciones, empresa_destino, cotizacion_data, cotizacion_nombre, cotizacion_tipo } = req.body;
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
       (po_numero, fecha, proveedor_id, forma_pago, moneda, placa_unidad, subtotal, descuento, transporte, iva, total, observaciones, cotizacion_archivo, cotizacion_nombre, cotizacion_tipo, creado_por, estado, empresa_destino)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'BORRADOR', ?)`,
      [
        po_numero,
        fecha,
        proveedor_id,
        forma_pago,
        moneda,
        placaOrden,
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
         (orden_compra_id, codigo, descripcion, cantidad, precio_unitario, subtotal)
         VALUES (?,?,?,?,?,?)`,
        [ordenId, linea.codigo, linea.descripcion, linea.cantidad, linea.precio_unitario, linea.subtotal]
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
    await ensureOrdenCotizacionColumns();
    await connection.beginTransaction();

    const id = req.params.id;
    const { proveedor_id, forma_pago, moneda, placa_unidad, lineas, observaciones, empresa_destino, cotizacion_data, cotizacion_nombre, cotizacion_tipo } = req.body;
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
         (orden_compra_id, codigo, descripcion, cantidad, precio_unitario, subtotal)
         VALUES (?,?,?,?,?,?)`,
        [id, linea.codigo, linea.descripcion, linea.cantidad, linea.precio_unitario, linea.subtotal]
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
    await ensureOrdenCotizacionColumns();
    const { proveedor_id, fecha_desde, fecha_hasta, po_numero, placa_unidad, estado, facturada } = req.query;
    const filtros = { proveedor_id, fecha_desde, fecha_hasta, po_numero, placa_unidad, estado, facturada };
    const { sql, params } = construirConsultaOrdenes(filtros);
    let [ordenes] = await pool.query(sql, params);

    if (ordenes.length) {
      const ordenIds = ordenes.map(orden => orden.id);
      const placeholders = ordenIds.map(() => "?").join(",");
      const [lineas] = await pool.query(
        `SELECT orden_compra_id, codigo, descripcion, cantidad, precio_unitario, subtotal
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

router.get("/ordenes/:id/detalle", requireAuth, allowRoles(...ROLES_VER_ORDENES), async (req, res) => {
  try {
    await ensureOrdenPlacaColumn();
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
      '    {"codigo": "placa o codigo si aparece", "descripcion": "producto/servicio", "cantidad": numero, "precio_unitario": numero, "subtotal": numero}',
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
    await ensureFacturaRecepcionColumns();
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
    await ensureFacturaRecepcionColumns();
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

// ===================== LISTADO DE FACTURAS (unificado) =====================
router.get("/facturas", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    await ensureFacturaRecepcionColumns();
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    await ensureNotaCreditoColumns();
    await ensureAbonoColumns();
    const { proveedor_id, fecha_desde, fecha_hasta, pagada, vencida } = req.query;
    const orden = req.query.orden === 'asc' ? 'asc' : 'desc';
    const facturasFiltradas = await obtenerFacturasCompras({ proveedor_id, fecha_desde, fecha_hasta, pagada, vencida, orden });

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
      filtros: { proveedor_id, fecha_desde, fecha_hasta, pagada, vencida, orden },
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
    await ensureFacturaRecepcionColumns();
    await ensureNotaCreditoColumns();
    await ensureAbonoColumns();

    const { proveedor_id, fecha_desde, fecha_hasta, pagada, vencida } = req.query;
    const orden = req.query.orden === "asc" ? "asc" : "desc";
    const filtros = { proveedor_id, fecha_desde, fecha_hasta, pagada, vencida, orden };
    const facturas = await obtenerFacturasCompras(filtros);
    const [proveedores] = await queryWithRetry("SELECT id, nombre FROM proveedores ORDER BY nombre");

    const resumen = facturas.reduce((acc, factura) => {
      const montoOriginal = parseMonto(factura.monto_original ?? factura.monto);
      const notaCredito = parseMonto(factura.nota_credito_monto);
      const abono = parseMonto(factura.abono_monto);
      const saldo = factura.pagada || factura.cubierta_por_nc ? 0 : parseMonto(factura.saldo ?? factura.monto);

      acc.totalFacturas += 1;
      acc.montoOriginal += montoOriginal;
      acc.notasCredito += notaCredito;
      acc.abonos += abono;
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
        porEstadoMap.get("Pagadas").monto += montoOriginal;
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

    res.render("compras/dashboard_facturas", {
      user: req.session.user,
      proveedores,
      filtros,
      resumen,
      porProveedor,
      porMes,
      porEstado,
      facturasRecientes
    });
  } catch (error) {
    console.error("Error en dashboard de facturas:", error);
    res.status(500).send("Error cargando dashboard de facturas");
  }
});

router.get("/facturas/reporte/pdf", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    await ensureFacturaRecepcionColumns();
    await ensureNotaCreditoColumns();
    await ensureAbonoColumns();

    const { proveedor_id, fecha_desde, fecha_hasta, vencida } = req.query;
    const orden = req.query.orden === "asc" ? "asc" : "desc";
    const filtros = { proveedor_id, fecha_desde, fecha_hasta, pagada: "0", vencida, orden };
    const facturas = await obtenerFacturasCompras(filtros);

    const [[proveedorFiltro]] = proveedor_id
      ? await queryWithRetry("SELECT nombre FROM proveedores WHERE id = ?", [proveedor_id])
      : [[null]];

    const gruposProveedor = Array.from(facturas.reduce((map, factura) => {
      const proveedorNombre = factura.proveedor_nombre || "Sin proveedor";
      if (!map.has(proveedorNombre)) {
        map.set(proveedorNombre, {
          proveedor: proveedorNombre,
          facturas: [],
          totales: {
            montoOriginal: 0,
            notasCredito: 0,
            abonos: 0,
            saldo: 0
          }
        });
      }

      const grupo = map.get(proveedorNombre);
      grupo.facturas.push(factura);
      grupo.totales.montoOriginal += parseMonto(factura.monto_original ?? factura.monto);
      grupo.totales.notasCredito += parseMonto(factura.nota_credito_monto);
      grupo.totales.abonos += parseMonto(factura.abono_monto);
      grupo.totales.saldo += parseMonto(factura.saldo);

      return map;
    }, new Map()).values()).sort((a, b) => a.proveedor.localeCompare(b.proveedor, "es"));

    gruposProveedor.forEach(grupo => {
      grupo.facturas.sort((a, b) => {
        const fechaA = a.fecha ? new Date(a.fecha).getTime() : 0;
        const fechaB = b.fecha ? new Date(b.fecha).getTime() : 0;
        return fechaA - fechaB;
      });
    });

    const totales = facturas.reduce((acc, f) => {
      acc.montoOriginal += parseMonto(f.monto_original ?? f.monto);
      acc.notasCredito += parseMonto(f.nota_credito_monto);
      acc.abonos += parseMonto(f.abono_monto);
      acc.saldo += parseMonto(f.saldo);
      return acc;
    }, {
      montoOriginal: 0,
      notasCredito: 0,
      abonos: 0,
      saldo: 0
    });

    const ejs = require("ejs");
    const path = require("path");
    const fs = require("fs");
    const pdf = require("html-pdf");
    const tmpDir = path.join(process.cwd(), "tmp");
    fs.mkdirSync(tmpDir, { recursive: true });

    const html = await ejs.renderFile(path.join(__dirname, "../views/compras/facturas_reporte_pdf.ejs"), {
      facturas,
      gruposProveedor,
      filtros: {
        ...filtros,
        proveedor_nombre: proveedorFiltro ? proveedorFiltro.nombre : null
      },
      totales,
      fechaGeneracion: new Date().toLocaleString("es-CR")
    });

    pdf.create(html, { format: "Letter", orientation: "landscape", border: "8mm", directory: tmpDir }).toBuffer((err, buffer) => {
      if (err) {
        console.error("Error generando reporte de facturas pendientes:", err);
        return res.status(500).send("Error al generar reporte");
      }
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=reporte_facturas_pendientes_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.pdf`);
      res.send(buffer);
    });
  } catch (error) {
    console.error("Error descargando reporte de facturas pendientes:", error);
    res.status(500).send("Error descargando reporte");
  }
});

router.get("/facturas/reporte/excel", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    await ensureFacturaRecepcionColumns();
    await ensureNotaCreditoColumns();
    await ensureAbonoColumns();

    const { proveedor_id, fecha_desde, fecha_hasta, vencida } = req.query;
    const orden = req.query.orden === "asc" ? "asc" : "desc";
    const filtros = { proveedor_id, fecha_desde, fecha_hasta, pagada: "0", vencida, orden };
    const facturas = await obtenerFacturasCompras(filtros);

    const [[proveedorFiltro]] = proveedor_id
      ? await queryWithRetry("SELECT nombre FROM proveedores WHERE id = ?", [proveedor_id])
      : [[null]];

    const gruposProveedor = Array.from(facturas.reduce((map, factura) => {
      const proveedorNombre = factura.proveedor_nombre || "Sin proveedor";
      if (!map.has(proveedorNombre)) {
        map.set(proveedorNombre, {
          proveedor: proveedorNombre,
          facturas: [],
          totales: {
            montoOriginal: 0,
            notasCredito: 0,
            abonos: 0,
            saldo: 0
          }
        });
      }

      const grupo = map.get(proveedorNombre);
      grupo.facturas.push(factura);
      grupo.totales.montoOriginal += parseMonto(factura.monto_original ?? factura.monto);
      grupo.totales.notasCredito += parseMonto(factura.nota_credito_monto);
      grupo.totales.abonos += parseMonto(factura.abono_monto);
      grupo.totales.saldo += parseMonto(factura.saldo);

      return map;
    }, new Map()).values()).sort((a, b) => a.proveedor.localeCompare(b.proveedor, "es"));

    gruposProveedor.forEach(grupo => {
      grupo.facturas.sort((a, b) => {
        const fechaA = a.fecha ? new Date(a.fecha).getTime() : 0;
        const fechaB = b.fecha ? new Date(b.fecha).getTime() : 0;
        return fechaA - fechaB;
      });
    });

    const totales = facturas.reduce((acc, f) => {
      acc.montoOriginal += parseMonto(f.monto_original ?? f.monto);
      acc.notasCredito += parseMonto(f.nota_credito_monto);
      acc.abonos += parseMonto(f.abono_monto);
      acc.saldo += parseMonto(f.saldo);
      return acc;
    }, {
      montoOriginal: 0,
      notasCredito: 0,
      abonos: 0,
      saldo: 0
    });

    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Gas Tomza";
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet("Pendientes", {
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
      { header: "Saldo", key: "saldo", width: 15 },
      { header: "Estado", key: "estado", width: 13 },
      { header: "Observación", key: "observacion", width: 42 }
    ];

    worksheet.mergeCells("A1:K1");
    worksheet.getCell("A1").value = "Facturas pendientes por pagar";
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

    worksheet.getCell("A5").value = "Monto original";
    worksheet.getCell("B5").value = totales.montoOriginal;
    worksheet.getCell("D5").value = "Notas de credito";
    worksheet.getCell("E5").value = totales.notasCredito;
    worksheet.getCell("G5").value = "Abonos";
    worksheet.getCell("H5").value = totales.abonos;
    worksheet.getCell("J5").value = "Total pendiente";
    worksheet.getCell("K5").value = totales.saldo;

    ["A3", "D3", "G3", "A4", "D4", "G4", "A5", "D5", "G5", "J5"].forEach(cell => {
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
      worksheet.mergeCells(providerRow.number, 1, providerRow.number, 11);
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
          parseMonto(f.saldo),
          f.vencida ? "Vencida" : "Pendiente",
          f.factura_observacion || f.abono_observacion || f.nota_credito_motivo || f.observacion || "-"
        ];
        row.getCell(3).numFmt = "yyyy-mm-dd";
        row.getCell(5).numFmt = "yyyy-mm-dd";
        [6, 7, 8, 9].forEach(col => {
          row.getCell(col).numFmt = '"CRC" #,##0.00';
        });
        row.getCell(10).font = { bold: true, color: { argb: f.vencida ? "FF991B1B" : "FF92400E" } };
        row.getCell(11).alignment = { wrapText: true, vertical: "top" };
      });

      const subtotalRow = worksheet.getRow(rowNumber++);
      subtotalRow.values = [
        `Total ${grupo.proveedor}`,
        "", "", "", "",
        grupo.totales.montoOriginal,
        grupo.totales.notasCredito,
        grupo.totales.abonos,
        grupo.totales.saldo,
        "", ""
      ];
      worksheet.mergeCells(subtotalRow.number, 1, subtotalRow.number, 5);
      subtotalRow.font = { bold: true };
      subtotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      [6, 7, 8, 9].forEach(col => {
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
      totales.saldo,
      "", ""
    ];
    worksheet.mergeCells(totalRow.number, 1, totalRow.number, 5);
    totalRow.font = { bold: true, color: { argb: "FF14532D" } };
    totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
    [6, 7, 8, 9].forEach(col => {
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
      to: "K7"
    };

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=reporte_facturas_pendientes_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.xlsx`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Error descargando Excel de facturas pendientes:", error);
    res.status(500).send("Error descargando Excel");
  }
});

router.post("/facturas/:id/numero", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    await ensureFacturaRecepcionColumns();
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
    await ensureFacturaRecepcionColumns();
    await ensureNotaCreditoColumns();
    await ensureAbonoColumns();

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
    await ensureFacturaRecepcionColumns();
    await ensureNotaCreditoColumns();
    await ensureAbonoColumns();

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
    await ensureNotaCreditoColumns();
    await ensureAbonoColumns();
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
           fecha_pago = CASE WHEN ? THEN ? ELSE fecha_pago END
       WHERE id = ?`,
      [
        numero_nc.trim(),
        fecha_nc,
        montoNC,
        motivo_nc || null,
        cubiertaPorNC,
        cubiertaPorNC,
        fecha_nc,
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
    await ensureNotaCreditoColumns();
    await ensureAbonoColumns();

    const id = req.params.id;
    const { tipo, monto_abono, fecha_abono, observacion_abono } = req.body;
    const montoAbono = parseMonto(monto_abono);
    const fechaAbono = fecha_abono || new Date().toISOString().slice(0, 10);

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
           fecha_pago = CASE WHEN ? THEN ? ELSE fecha_pago END
       WHERE id = ?`,
      [
        nuevoAbono,
        fechaAbono,
        observacion_abono || null,
        pagadaCompleta,
        pagadaCompleta,
        fechaAbono,
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
    await ensureNotaCreditoColumns();
    await ensureAbonoColumns();
    const id = req.params.id;
    const { tipo } = req.body;
    const fechaPago = new Date().toISOString().slice(0, 10);

    if (tipo === 'orden') {
      const [result] = await pool.query(
        `UPDATE ordenes_compra
         SET pagada = 1,
             fecha_pago = ?,
             abono_monto = GREATEST(total - COALESCE(nota_credito_monto, 0), COALESCE(abono_monto, 0)),
             abono_fecha = ?
         WHERE id = ?
           AND facturada = 1
           AND COALESCE(pagada, 0) = 0
           AND GREATEST(total - COALESCE(nota_credito_monto, 0) - COALESCE(abono_monto, 0), 0) > 0`,
        [fechaPago, fechaPago, id]
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
             abono_monto = GREATEST(monto - COALESCE(nota_credito_monto, 0), COALESCE(abono_monto, 0)),
             abono_fecha = ?
         WHERE id = ?
           AND COALESCE(pagada, 0) = 0
           AND GREATEST(monto - COALESCE(nota_credito_monto, 0) - COALESCE(abono_monto, 0), 0) > 0`,
        [fechaPago, fechaPago, id]
      );
      if (!result.affectedRows) {
        req.session.error = "La factura independiente no existe, ya estaba pagada o no tiene saldo pendiente.";
        return res.redirect("/compras/facturas");
      }
    } else {
      req.session.error = "Tipo de factura inválido.";
      return res.redirect("/compras/facturas");
    }

    req.session.success = "Factura marcada como pagada.";
    res.redirect("/compras/facturas");
  } catch (error) {
    console.error("Error al pagar factura:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/facturas/pagar-multiple", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    await ensureNotaCreditoColumns();
    await ensureAbonoColumns();
    const { facturas_ids } = req.body;
    const seleccionadas = toArray(facturas_ids).map(parseFacturaRef).filter(Boolean);

    if (!seleccionadas.length) {
      req.session.error = "No seleccionó ninguna factura.";
      return res.redirect("/compras/facturas");
    }

    const fechaPago = new Date().toISOString().slice(0, 10);
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
             abono_monto = GREATEST(total - COALESCE(nota_credito_monto, 0), COALESCE(abono_monto, 0)),
             abono_fecha = ?
         WHERE id IN (${placeholders})
           AND facturada = 1
           AND COALESCE(pagada, 0) = 0
           AND GREATEST(total - COALESCE(nota_credito_monto, 0) - COALESCE(abono_monto, 0), 0) > 0`,
        [fechaPago, fechaPago, ...ordenIds]
      );
    }

    if (independientesIds.length) {
      const placeholders = independientesIds.map(() => '?').join(',');
      await pool.query(
        `UPDATE facturas
         SET pagada = 1,
             fecha_pago = ?,
             abono_monto = GREATEST(monto - COALESCE(nota_credito_monto, 0), COALESCE(abono_monto, 0)),
             abono_fecha = ?
         WHERE id IN (${placeholders})
           AND COALESCE(pagada, 0) = 0
           AND GREATEST(monto - COALESCE(nota_credito_monto, 0) - COALESCE(abono_monto, 0), 0) > 0`,
        [fechaPago, fechaPago, ...independientesIds]
      );
    }

    const totalPagado = facturas.reduce((sum, f) => sum + parseFloat(f.total), 0);
    const ejs = require('ejs');
    const path = require('path');
    const pdf = require('html-pdf');
    const templatePath = path.join(__dirname, '../views/compras/recibo_pago.ejs');
    const html = await ejs.renderFile(templatePath, { facturas, fechaPago, totalPagado });
    pdf.create(html, { format: 'Letter' }).toBuffer((err, buffer) => {
      if (err) {
        console.error("Error generando PDF:", err);
        return res.status(500).send("Error al generar el recibo");
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=recibo_pago_${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.pdf`);
      res.send(buffer);
    });
  } catch (error) {
    console.error("Error al procesar pago múltiple:", error);
    res.status(500).send("Error al procesar el pago múltiple");
  }
});

// ===================== DASHBOARD DE ANÁLISIS =====================
router.get("/dashboard", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    await ensureOrdenPlacaColumn();

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
          WHEN compras.placa = 'GENERALES TALLER' THEN 'General'
          ELSE COALESCE(MAX(u.sede), 'Sin sede')
        END AS sede,
        COUNT(DISTINCT compras.id) AS ordenes,
        COALESCE(SUM(compras.monto_linea), 0) AS total_gastado,
        MAX(compras.ultima_fecha) AS ultima_fecha
      FROM (
        SELECT
          o.id,
          UPPER(TRIM(COALESCE(
            REGEXP_SUBSTR(UPPER(COALESCE(d.codigo, '')), 'CL{0,1}[0-9]{5,6}'),
            CASE
              WHEN UPPER(TRIM(COALESCE(d.codigo, ''))) IN ('GENERAL', 'GENERALES', 'GENERAL TALLER', 'GENERALES TALLER') THEN 'GENERALES TALLER'
            END,
            CASE
              WHEN UPPER(TRIM(COALESCE(o.placa_unidad, ''))) IN ('GENERAL', 'GENERALES', 'GENERAL TALLER', 'GENERALES TALLER') THEN 'GENERALES TALLER'
            END,
            CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 THEN NULLIF(UPPER(TRIM(o.placa_unidad)), '') END,
            CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 THEN REGEXP_SUBSTR(UPPER(COALESCE(o.observaciones, '')), 'CL{0,1}[0-9]{5,6}') END,
            'SIN PLACA'
          ))) AS placa,
          CASE
            WHEN d.id IS NULL THEN COALESCE(o.total, 0)
            ELSE COALESCE(d.subtotal, d.cantidad * d.precio_unitario, 0)
          END AS monto_linea,
          o.fecha AS ultima_fecha
        FROM ordenes_compra o
        LEFT JOIN ordenes_compra_detalle d ON d.orden_compra_id = o.id
        LEFT JOIN (
          SELECT orden_compra_id, COUNT(*) AS tiene_placas
          FROM ordenes_compra_detalle
          WHERE REGEXP_SUBSTR(UPPER(COALESCE(codigo, '')), 'CL{0,1}[0-9]{5,6}') IS NOT NULL
          GROUP BY orden_compra_id
        ) placas_detalle ON placas_detalle.orden_compra_id = o.id
        ${whereClause}
      ) compras
      LEFT JOIN unidades u ON UPPER(TRIM(u.placa)) = compras.placa
      WHERE compras.placa <> 'SIN PLACA'
      GROUP BY compras.placa
      ORDER BY total_gastado DESC
      LIMIT 15
    `, params);

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
              REGEXP_SUBSTR(UPPER(COALESCE(d.codigo, '')), 'CL{0,1}[0-9]{5,6}'),
              CASE
                WHEN UPPER(TRIM(COALESCE(d.codigo, ''))) IN ('GENERAL', 'GENERALES', 'GENERAL TALLER', 'GENERALES TALLER') THEN 'GENERALES TALLER'
              END,
              CASE
                WHEN UPPER(TRIM(COALESCE(o.placa_unidad, ''))) IN ('GENERAL', 'GENERALES', 'GENERAL TALLER', 'GENERALES TALLER') THEN 'GENERALES TALLER'
              END,
              CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 THEN NULLIF(UPPER(TRIM(o.placa_unidad)), '') END,
              CASE WHEN COALESCE(placas_detalle.tiene_placas, 0) = 0 THEN REGEXP_SUBSTR(UPPER(COALESCE(o.observaciones, '')), 'CL{0,1}[0-9]{5,6}') END,
              'SIN PLACA'
            ))) AS placa,
            CASE
              WHEN d.id IS NULL THEN COALESCE(o.total, 0)
              ELSE COALESCE(d.subtotal, d.cantidad * d.precio_unitario, 0)
            END AS monto_linea
          FROM ordenes_compra o
          LEFT JOIN ordenes_compra_detalle d ON d.orden_compra_id = o.id
          LEFT JOIN (
            SELECT orden_compra_id, COUNT(*) AS tiene_placas
            FROM ordenes_compra_detalle
            WHERE REGEXP_SUBSTR(UPPER(COALESCE(codigo, '')), 'CL{0,1}[0-9]{5,6}') IS NOT NULL
            GROUP BY orden_compra_id
          ) placas_detalle ON placas_detalle.orden_compra_id = o.id
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
