const express = require("express");
const router = express.Router();
const pool = require("../db");
const { ensureGastosOperativosTables, registrarAuditoriaSistema, registrarGastoOperativo } = require("../utils/gastosOperativos");
const { enviarNotificacionAdmins } = require("../utils/notificacionesPush");
const { defaultPeriod, reportPeriod, consumption, consumptionOrderLines, inventoryXlsx, consignmentXlsx, ownInventoryPdf } = require("../utils/bodegaReportes");
const { TODAS_SEDES } = require("../utils/sedes");

const ROLES_BODEGA = ["ADMIN", "TALLER", "PROVEEDURIA_TALLER", "BODEGA", "BODEGUERO"];
const ROLES_AJUSTE = ["ADMIN", "TALLER", "BODEGUERO"];
const ROLES_CATALOGO = ["ADMIN", "TALLER", "PROVEEDURIA_TALLER", "BODEGUERO"];
const TIPOS_ARTICULO = ["REPUESTO", "CONSUMIBLE", "HERRAMIENTA", "OTRO"];
const ORIGENES_INVENTARIO = ["PROPIO", "CONSIGNACION"];
const PROVEEDOR_CONSIGNACION_DEFAULT = "MAXI REPUESTOS";

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireBodega(req, res, next) {
  if (!ROLES_BODEGA.includes(req.session.user.rol)) return res.status(403).send("No autorizado");
  next();
}

function puedeAjustar(user) {
  return user && ROLES_AJUSTE.includes(user.rol);
}

function requiereRol(roles, req, res) {
  if (req.session.user && roles.includes(req.session.user.rol)) return true;
  res.status(403).send("No tiene permisos para realizar esta acción en Bodega.");
  return false;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function numero(value) {
  const parsed = Number(String(value || "0").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function limpiar(value) {
  return String(value || "").trim();
}

function upper(value) {
  return limpiar(value).toUpperCase();
}

function origenInventario(value, fallback = "PROPIO") {
  const origen = upper(value);
  return ORIGENES_INVENTARIO.includes(origen) ? origen : fallback;
}

function codigoTaller(value) {
  const digits = limpiar(value).replace(/\D/g, "");
  return digits ? digits.slice(-4).padStart(4, "0") : "";
}

function fechaCostaRica(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

async function columnExists(table, column) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(row.total || 0) > 0;
}

async function indexExists(table, indexName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return Number(row.total || 0) > 0;
}

async function indexIsUnique(table, indexName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
       AND NON_UNIQUE = 0`,
    [table, indexName]
  );
  return Number(row.total || 0) > 0;
}

async function uniqueCodigoIndexes(table) {
  const [rows] = await pool.query(
    `SELECT s.INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS s
     JOIN (
       SELECT INDEX_NAME, COUNT(*) AS columnas
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
       GROUP BY INDEX_NAME
     ) x ON x.INDEX_NAME = s.INDEX_NAME
     WHERE s.TABLE_SCHEMA = DATABASE()
       AND s.TABLE_NAME = ?
       AND s.NON_UNIQUE = 0
       AND s.INDEX_NAME <> 'PRIMARY'
       AND s.COLUMN_NAME = 'codigo'
       AND x.columnas = 1`,
    [table, table]
  );
  return rows.map(row => row.INDEX_NAME);
}

async function siguienteCodigoTaller(conn = pool) {
  const [[row]] = await conn.query(`
    SELECT MAX(CAST(codigo_taller AS UNSIGNED)) AS ultimo
    FROM bodega_articulos
    WHERE codigo_taller REGEXP '^[0-9]{4}$'
  `);
  const siguiente = Number(row.ultimo || 0) + 1;
  return String(siguiente).padStart(4, "0");
}

async function asignarCodigosTallerPendientes(conn = pool) {
  const [[row]] = await conn.query(`
    SELECT MAX(CAST(codigo_taller AS UNSIGNED)) AS ultimo
    FROM bodega_articulos
    WHERE codigo_taller REGEXP '^[0-9]{4}$'
  `);
  let siguiente = Number(row.ultimo || 0) + 1;

  const [pendientes] = await conn.query(`
    SELECT id
    FROM bodega_articulos
    WHERE activo = 1
      AND (codigo_taller IS NULL OR TRIM(codigo_taller) = '' OR codigo_taller = '-')
    ORDER BY origen_inventario DESC, nombre ASC, id ASC
  `);

  for (const articulo of pendientes) {
    await conn.query(
      "UPDATE bodega_articulos SET codigo_taller = ? WHERE id = ?",
      [String(siguiente).padStart(4, "0"), articulo.id]
    );
    siguiente += 1;
  }
}

async function createBodegaTablesIfNeeded() {
  if (!(await columnExists("unidades", "motor"))) {
    await pool.query(`
      ALTER TABLE unidades
      ADD COLUMN motor VARCHAR(120) NULL AFTER modelo
    `);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bodega_articulos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(80) NULL UNIQUE,
      nombre VARCHAR(180) NOT NULL,
      tipo_articulo ENUM('REPUESTO','CONSUMIBLE','HERRAMIENTA','OTRO') NOT NULL DEFAULT 'REPUESTO',
      grupo_bodega VARCHAR(30) NOT NULL DEFAULT 'INVENTARIO',
      categoria VARCHAR(100) NULL,
      marca VARCHAR(100) NULL,
      numero_parte VARCHAR(120) NULL,
      tipo_unidad VARCHAR(120) NULL,
      unidad_medida VARCHAR(30) NOT NULL DEFAULT 'UND',
      stock_actual DECIMAL(12,2) NOT NULL DEFAULT 0,
      stock_minimo DECIMAL(12,2) NOT NULL DEFAULT 0,
      stock_maximo DECIMAL(12,2) NOT NULL DEFAULT 0,
      ubicacion VARCHAR(120) NULL,
      precio_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
      proveedor_id INT NULL,
      proveedor_nombre VARCHAR(180) NULL,
      fecha_ultima_compra DATE NULL,
      observacion TEXT NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      creado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  if (!(await columnExists("bodega_articulos", "codigo_taller"))) {
    await pool.query(`
      ALTER TABLE bodega_articulos
      ADD COLUMN codigo_taller VARCHAR(4) NULL AFTER id
    `);
  }

  if (!(await indexExists("bodega_articulos", "idx_bodega_articulos_codigo_taller"))) {
    await pool.query(`
      CREATE UNIQUE INDEX idx_bodega_articulos_codigo_taller
      ON bodega_articulos (codigo_taller)
    `);
  }

  if (!(await columnExists("bodega_articulos", "origen_inventario"))) {
    await pool.query(`
      ALTER TABLE bodega_articulos
      ADD COLUMN origen_inventario ENUM('PROPIO','CONSIGNACION') NOT NULL DEFAULT 'PROPIO' AFTER tipo_articulo
    `);
  }

  if (!(await columnExists("bodega_articulos", "proveedor_consignacion"))) {
    await pool.query(`
      ALTER TABLE bodega_articulos
      ADD COLUMN proveedor_consignacion VARCHAR(180) NULL AFTER proveedor_nombre
    `);
  }

  if (!(await columnExists("bodega_articulos", "grupo_bodega"))) {
    await pool.query(`
      ALTER TABLE bodega_articulos
      ADD COLUMN grupo_bodega VARCHAR(30) NOT NULL DEFAULT 'INVENTARIO' AFTER tipo_articulo
    `);
  }

  if (!(await columnExists("bodega_articulos", "observacion"))) {
    await pool.query(`
      ALTER TABLE bodega_articulos
      ADD COLUMN observacion TEXT NULL AFTER fecha_ultima_compra
    `);
  }

  const codigoIndexes = await uniqueCodigoIndexes("bodega_articulos");
  for (const indexName of codigoIndexes) {
    await pool.query(`ALTER TABLE bodega_articulos DROP INDEX \`${indexName}\``);
  }

  if (
    await indexExists("bodega_articulos", "idx_bodega_articulos_codigo_origen")
    && await indexIsUnique("bodega_articulos", "idx_bodega_articulos_codigo_origen")
  ) {
    await pool.query("ALTER TABLE bodega_articulos DROP INDEX idx_bodega_articulos_codigo_origen");
  }

  if (!(await indexExists("bodega_articulos", "idx_bodega_articulos_codigo_origen"))) {
    await pool.query(`
      CREATE INDEX idx_bodega_articulos_codigo_origen
      ON bodega_articulos (codigo, origen_inventario)
    `);
  }

  await asignarCodigosTallerPendientes();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bodega_entregas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      placa VARCHAR(50) NULL,
      mecanico VARCHAR(120) NULL,
      tipo_trabajo ENUM('MANTENIMIENTO','CORRECTIVO','REPARACION','EMERGENCIA','OTRO') NOT NULL DEFAULT 'MANTENIMIENTO',
      observacion TEXT NULL,
      creado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bodega_prestamos_herramientas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      articulo_id INT NOT NULL,
      mecanico VARCHAR(120) NOT NULL,
      placa VARCHAR(50) NULL,
      cantidad DECIMAL(12,2) NOT NULL DEFAULT 1,
      estado ENUM('PRESTADO','DEVUELTO') NOT NULL DEFAULT 'PRESTADO',
      salida_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      devolucion_en TIMESTAMP NULL,
      recibido_por VARCHAR(120) NULL,
      observacion TEXT NULL,
      creado_por INT NULL,
      actualizado_por INT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bodega_movimientos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      articulo_id INT NOT NULL,
      entrega_id INT NULL,
      prestamo_id INT NULL,
      tipo_movimiento ENUM('ENTRADA','SALIDA','DEVOLUCION','AJUSTE','PRESTAMO','DEVOLUCION_HERRAMIENTA') NOT NULL,
      cantidad DECIMAL(12,2) NOT NULL,
      existencia_anterior DECIMAL(12,2) NOT NULL DEFAULT 0,
      existencia_nueva DECIMAL(12,2) NOT NULL DEFAULT 0,
      placa VARCHAR(50) NULL,
      destino_recepcion ENUM('GENERALES','PLACA') NOT NULL DEFAULT 'GENERALES',
      mecanico VARCHAR(120) NULL,
      tipo_trabajo VARCHAR(50) NULL,
      proveedor_id INT NULL,
      proveedor_nombre VARCHAR(180) NULL,
      numero_factura VARCHAR(120) NULL,
      orden_compra_id INT NULL,
      precio_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
      motivo TEXT NULL,
      creado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  if (!(await columnExists("bodega_movimientos", "origen_inventario"))) {
    await pool.query(`
      ALTER TABLE bodega_movimientos
      ADD COLUMN origen_inventario ENUM('PROPIO','CONSIGNACION') NOT NULL DEFAULT 'PROPIO' AFTER tipo_movimiento
    `);
  }

  if (!(await columnExists("bodega_movimientos", "destino_recepcion"))) {
    await pool.query(`
      ALTER TABLE bodega_movimientos
      ADD COLUMN destino_recepcion ENUM('GENERALES','PLACA') NOT NULL DEFAULT 'GENERALES' AFTER placa
    `);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bodega_configuraciones_unidad (
      id INT AUTO_INCREMENT PRIMARY KEY,
      marca VARCHAR(100) NOT NULL,
      modelo VARCHAR(120) NOT NULL,
      anio INT NULL,
      motor VARCHAR(120) NULL,
      descripcion VARCHAR(220) NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      creado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bodega_config_vehiculo (marca, modelo, anio, activo)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bodega_unidades_configuracion (
      unidad_id INT PRIMARY KEY,
      configuracion_id INT NOT NULL,
      creado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bodega_unidad_config (configuracion_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bodega_compatibilidades (
      id INT AUTO_INCREMENT PRIMARY KEY,
      configuracion_id INT NOT NULL,
      articulo_id INT NOT NULL,
      tipo_servicio VARCHAR(80) NOT NULL DEFAULT 'GENERAL',
      cantidad DECIMAL(12,2) NOT NULL DEFAULT 1,
      observacion VARCHAR(220) NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      creado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_bodega_compatibilidad (configuracion_id, articulo_id, tipo_servicio),
      INDEX idx_bodega_compat_articulo (articulo_id, activo)
    )
  `);

  const columnasCompatibilidad = [
    ["nivel_confianza", "VARCHAR(30) NOT NULL DEFAULT 'MANUAL' AFTER observacion"],
    ["criterio_compatibilidad", "VARCHAR(255) NULL AFTER nivel_confianza"],
    ["fuente_url", "VARCHAR(500) NULL AFTER criterio_compatibilidad"]
  ];
  for (const [columna, definicion] of columnasCompatibilidad) {
    if (!(await columnExists("bodega_compatibilidades", columna))) {
      await pool.query(`ALTER TABLE bodega_compatibilidades ADD COLUMN ${columna} ${definicion}`);
    }
  }
}

let bodegaTablesPromise;
async function ensureBodegaTables() {
  if (!bodegaTablesPromise) {
    bodegaTablesPromise = createBodegaTablesIfNeeded().catch(error => {
      bodegaTablesPromise = null;
      throw error;
    });
  }
  return bodegaTablesPromise;
}

async function obtenerUnidadPorPlaca(conn, placa, bloquear = false) {
  const placaIngresada = upper(placa).replace(/\s+/g, "");
  if (!placaIngresada) return null;
  const [[unidad]] = await conn.query(
    `SELECT id, placa, sede, marca, modelo, anio, motor
     FROM unidades
     WHERE REPLACE(UPPER(TRIM(placa)), ' ', '') = ?
       AND COALESCE(activa, 1) = 1
     LIMIT 1${bloquear ? " FOR UPDATE" : ""}`,
    [placaIngresada]
  );
  return unidad || null;
}

async function obtenerConfiguracionUnidad(conn, unidad) {
  const [[asignada]] = await conn.query(
    `SELECT bc.*
     FROM bodega_unidades_configuracion buc
     JOIN bodega_configuraciones_unidad bc ON bc.id = buc.configuracion_id
     WHERE buc.unidad_id = ? AND bc.activo = 1
     LIMIT 1`,
    [unidad.id]
  );
  if (asignada) return asignada;

  const [candidatas] = await conn.query(
    `SELECT *
     FROM bodega_configuraciones_unidad
     WHERE activo = 1
       AND UPPER(TRIM(marca)) = UPPER(TRIM(?))
       AND UPPER(TRIM(modelo)) = UPPER(TRIM(?))
       AND (anio IS NULL OR anio = ?)
       AND (
         TRIM(?) = ''
         OR motor IS NULL
         OR TRIM(motor) = ''
         OR UPPER(TRIM(motor)) = UPPER(TRIM(?))
       )
     ORDER BY
       CASE WHEN motor IS NOT NULL AND TRIM(motor) <> '' THEN 0 ELSE 1 END,
       CASE WHEN anio IS NOT NULL THEN 0 ELSE 1 END,
       id
     LIMIT 2`,
    [unidad.marca || "", unidad.modelo || "", unidad.anio || null, unidad.motor || "", unidad.motor || ""]
  );
  return candidatas.length === 1 ? candidatas[0] : null;
}

async function obtenerProveedor(proveedorId, proveedorTexto = "") {
  if (proveedorId) {
    const [[proveedor]] = await pool.query("SELECT id, nombre FROM proveedores WHERE id = ? LIMIT 1", [proveedorId]);
    if (proveedor) return { id: proveedor.id, nombre: proveedor.nombre };
  }
  return { id: null, nombre: limpiar(proveedorTexto) || null };
}

async function articuloParaMovimiento(conn, articuloId) {
  const [[articulo]] = await conn.query(
    "SELECT * FROM bodega_articulos WHERE id = ? AND activo = 1 FOR UPDATE",
    [articuloId]
  );
  if (!articulo) throw new Error("Artículo no encontrado.");
  return articulo;
}

async function sedesBodega(conn = pool) {
  const [rows] = await conn.query(`
    SELECT DISTINCT TRIM(sede) AS sede
    FROM unidades
    WHERE COALESCE(activa, 1) = 1 AND sede IS NOT NULL AND TRIM(sede) <> ''
    ORDER BY sede
  `);
  const sedesNoOperativas = new Set(["Cabezales", "Cisternas", "Carretas", "Gruas", "Grúas", "Tandem", "Tándem", "Tamden"]);
  const values = [...new Set([
    ...TODAS_SEDES.filter(sede => !sedesNoOperativas.has(sede)),
    ...rows.map(row => limpiar(row.sede)).filter(sede => !sedesNoOperativas.has(sede)),
    "POR_CLASIFICAR"
  ])].filter(Boolean);
  return values;
}

async function validarSedeBodega(conn, value) {
  const sede = limpiar(value);
  const sedes = await sedesBodega(conn);
  if (!sede || !sedes.includes(sede)) throw new Error("Seleccione una sede válida para el movimiento.");
  return sede;
}

async function aplicarCambioExistencia(conn, articulo, sede, ubicacion, delta) {
  const lugar = limpiar(ubicacion);
  await conn.query(`
    INSERT INTO bodega_existencias (articulo_id, sede, ubicacion, cantidad)
    VALUES (?, ?, ?, 0)
    ON DUPLICATE KEY UPDATE articulo_id = VALUES(articulo_id)
  `, [articulo.id, sede, lugar]);
  const [[existencia]] = await conn.query(
    `SELECT id, cantidad FROM bodega_existencias
     WHERE articulo_id = ? AND sede = ? AND ubicacion = ? FOR UPDATE`,
    [articulo.id, sede, lugar]
  );
  const anterior = Number(existencia?.cantidad || 0);
  const nueva = anterior + Number(delta);
  if (nueva < -0.000001) throw new Error(`${articulo.nombre} no tiene suficiente existencia en ${sede}. Disponible: ${anterior}.`);
  await conn.query("UPDATE bodega_existencias SET cantidad = ? WHERE id = ?", [Math.max(0, nueva), existencia.id]);
  const [[total]] = await conn.query(
    "SELECT COALESCE(SUM(cantidad), 0) AS total FROM bodega_existencias WHERE articulo_id = ?",
    [articulo.id]
  );
  await conn.query("UPDATE bodega_articulos SET stock_actual = ? WHERE id = ?", [Number(total.total || 0), articulo.id]);
  return { anterior, nueva: Math.max(0, nueva), total: Number(total.total || 0), ubicacion: lugar };
}

function redirectBodega(req, res) {
  const q = limpiar(req.body.q || req.query.q);
  const sede = limpiar(req.body.sede || req.body.sede_origen || req.query.sede);
  const pagina = limpiar(req.body.redirect_to || req.query.redirect_to);
  const paginas = new Set(["entregas", "compatibilidad", "consignacion", "inventario", "herramientas", "movimientos"]);
  const base = paginas.has(pagina) ? `/bodega/${pagina}` : "/bodega";
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (sede) params.set("sede", sede);
  res.redirect(`${base}${params.size ? `?${params}` : ""}`);
}

router.use(requireAuth, requireBodega);

async function renderBodega(req, res, pagina = "inicio") {
  try {
    await ensureBodegaTables();
    const q = limpiar(req.query.q);
    const paginaInventario = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
    const limiteInventario = 100;
    const paginaMovimientos = Math.max(1, Number.parseInt(req.query.mov_pagina, 10) || 1);
    const limiteMovimientos = 100;
    const sedesDisponibles = await sedesBodega();
    const sedeSolicitada = limpiar(req.query.sede);
    const sedeBodega = sedeSolicitada && sedesDisponibles.includes(sedeSolicitada) ? sedeSolicitada : "";
    const origen = origenInventario(req.query.origen, "");
    const grupo = pagina === "inventario" && ["SUMINISTRO", "INVENTARIO"].includes(upper(req.query.grupo))
      ? upper(req.query.grupo) : "";
    const condiciones = ["activo = 1"];
    const params = [];

    if (origen) {
      condiciones.push("origen_inventario = ?");
      params.push(origen);
    }
    if (grupo) {
      condiciones.push("grupo_bodega = ?");
      params.push(grupo);
    }

    if (q) {
      condiciones.push(`(
        nombre LIKE ? OR codigo LIKE ? OR codigo_taller LIKE ? OR numero_parte LIKE ? OR categoria LIKE ? OR marca LIKE ? OR tipo_unidad LIKE ? OR ubicacion LIKE ? OR proveedor_consignacion LIKE ?
      )`);
      const like = `%${q}%`;
      params.push(like, like, like, like, like, like, like, like, like);
    }

    const articulosSql = sedeBodega
      ? `SELECT ba.*, COALESCE(SUM(be.cantidad), 0) AS stock_actual
         FROM bodega_articulos ba
         LEFT JOIN bodega_existencias be ON be.articulo_id = ba.id AND be.sede = ?
         WHERE ${condiciones.map(item => item.replace(/\b(activo|origen_inventario|grupo_bodega|nombre|codigo|codigo_taller|numero_parte|categoria|marca|tipo_unidad|ubicacion|proveedor_consignacion)\b/g, "ba.$1")).join(" AND ")}
         GROUP BY ba.id
         ORDER BY CASE WHEN stock_actual <= 0 THEN 0 WHEN ba.stock_minimo > 0 AND stock_actual <= ba.stock_minimo THEN 1 ELSE 2 END, ba.nombre
         LIMIT ? OFFSET ?`
      : `SELECT * FROM bodega_articulos WHERE ${condiciones.join(" AND ")}
         ORDER BY CASE WHEN stock_actual <= 0 THEN 0 WHEN stock_minimo > 0 AND stock_actual <= stock_minimo THEN 1 ELSE 2 END, nombre ASC
         LIMIT ? OFFSET ?`;
    const [articulos] = await pool.query(articulosSql,
      [...(sedeBodega ? [sedeBodega] : []), ...params, limiteInventario, (paginaInventario - 1) * limiteInventario]);
    const [[conteoArticulos]] = await pool.query(
      `SELECT COUNT(*) AS total FROM bodega_articulos WHERE ${condiciones.join(" AND ")}`,
      params
    );

    const statsSql = sedeBodega ? `
      SELECT
        COUNT(DISTINCT ba.id) AS articulos,
        COUNT(DISTINCT CASE WHEN ba.grupo_bodega = 'SUMINISTRO' AND ba.origen_inventario = 'PROPIO' AND ba.stock_minimo > 0 AND be.cantidad > 0 AND be.cantidad <= ba.stock_minimo THEN ba.id END) AS stock_bajo,
        COUNT(DISTINCT CASE WHEN ba.grupo_bodega = 'SUMINISTRO' AND ba.origen_inventario = 'PROPIO' AND be.cantidad <= 0 THEN ba.id END) AS agotados,
        COUNT(DISTINCT CASE WHEN ba.origen_inventario = 'PROPIO' AND be.cantidad > 0 THEN ba.id END) AS propios,
        COUNT(DISTINCT CASE WHEN ba.origen_inventario = 'CONSIGNACION' AND be.cantidad > 0 THEN ba.id END) AS consignacion,
        SUM(COALESCE(be.cantidad, 0) * COALESCE(ba.precio_unitario, 0)) AS valor_total,
        SUM(CASE WHEN ba.origen_inventario = 'PROPIO' THEN COALESCE(be.cantidad, 0) * COALESCE(ba.precio_unitario, 0) ELSE 0 END) AS valor_propio,
        SUM(CASE WHEN ba.origen_inventario = 'CONSIGNACION' THEN COALESCE(be.cantidad, 0) * COALESCE(ba.precio_unitario, 0) ELSE 0 END) AS valor_consignacion
      FROM bodega_existencias be
      JOIN bodega_articulos ba ON ba.id = be.articulo_id
      WHERE ba.activo = 1 AND be.sede = ?
    ` : `
      SELECT
        COUNT(*) AS articulos,
        SUM(CASE WHEN activo = 1 AND grupo_bodega = 'SUMINISTRO' AND origen_inventario = 'PROPIO' AND stock_minimo > 0 AND stock_actual > 0 AND stock_actual <= stock_minimo THEN 1 ELSE 0 END) AS stock_bajo,
        SUM(CASE WHEN activo = 1 AND grupo_bodega = 'SUMINISTRO' AND origen_inventario = 'PROPIO' AND stock_actual <= 0 THEN 1 ELSE 0 END) AS agotados,
        SUM(CASE WHEN activo = 1 AND origen_inventario = 'PROPIO' THEN 1 ELSE 0 END) AS propios,
        SUM(CASE WHEN activo = 1 AND origen_inventario = 'CONSIGNACION' THEN 1 ELSE 0 END) AS consignacion,
        SUM(CASE WHEN activo = 1 THEN COALESCE(stock_actual, 0) * COALESCE(precio_unitario, 0) ELSE 0 END) AS valor_total,
        SUM(CASE WHEN activo = 1 AND origen_inventario = 'PROPIO' THEN COALESCE(stock_actual, 0) * COALESCE(precio_unitario, 0) ELSE 0 END) AS valor_propio,
        SUM(CASE WHEN activo = 1 AND origen_inventario = 'CONSIGNACION' THEN COALESCE(stock_actual, 0) * COALESCE(precio_unitario, 0) ELSE 0 END) AS valor_consignacion
      FROM bodega_articulos
    `;
    const [[stats]] = await pool.query(statsSql, sedeBodega ? [sedeBodega] : []);

    const [[movHoy]] = await pool.query(
      "SELECT COUNT(*) AS total FROM bodega_movimientos WHERE DATE(creado_en) = ?",
      [fechaCostaRica()]
    );

    const [[prestadasRow]] = await pool.query(
      "SELECT COUNT(*) AS total FROM bodega_prestamos_herramientas WHERE estado = 'PRESTADO'"
    );

    const [porComprar] = await pool.query(`
      SELECT *,
        GREATEST(stock_maximo - stock_actual, 0) AS cantidad_comprar
      FROM bodega_articulos
      WHERE activo = 1
        AND grupo_bodega = 'SUMINISTRO'
        AND origen_inventario = 'PROPIO'
        AND stock_minimo > 0
        AND stock_actual <= stock_minimo
      ORDER BY stock_actual ASC, nombre ASC
      LIMIT 80
    `);

    let proveedoresConsignacion = [];
    let articulosConsignacion = [];
    let proveedorConsignacionSeleccionado = "";
    if (pagina === "consignacion") {
      const [proveedoresRows] = await pool.query(`
        SELECT COALESCE(NULLIF(TRIM(proveedor_consignacion), ''), NULLIF(TRIM(proveedor_nombre), ''), ?) AS proveedor,
               COUNT(*) AS total_articulos
        FROM bodega_articulos
        WHERE activo = 1 AND origen_inventario = 'CONSIGNACION'
        GROUP BY proveedor
        ORDER BY proveedor
      `, [PROVEEDOR_CONSIGNACION_DEFAULT]);
      proveedoresConsignacion = proveedoresRows;
      const proveedorSolicitado = limpiar(req.query.proveedor);
      proveedorConsignacionSeleccionado = proveedoresRows.find(row => row.proveedor === proveedorSolicitado)?.proveedor || "";

      const condicionesConsignacion = ["activo = 1", "origen_inventario = 'CONSIGNACION'"];
      const paramsConsignacion = [];
      if (proveedorConsignacionSeleccionado) {
        condicionesConsignacion.push("COALESCE(NULLIF(TRIM(proveedor_consignacion), ''), NULLIF(TRIM(proveedor_nombre), ''), ?) = ?");
        paramsConsignacion.push(PROVEEDOR_CONSIGNACION_DEFAULT, proveedorConsignacionSeleccionado);
      }
      if (q) {
        condicionesConsignacion.push("(nombre LIKE ? OR codigo LIKE ? OR codigo_taller LIKE ? OR numero_parte LIKE ? OR categoria LIKE ? OR proveedor_consignacion LIKE ?)");
        paramsConsignacion.push(...Array(6).fill(`%${q}%`));
      }
      [articulosConsignacion] = sedeBodega
        ? await pool.query(
          `SELECT ba.*, COALESCE(SUM(be.cantidad), 0) AS stock_actual
           FROM bodega_articulos ba
           LEFT JOIN bodega_existencias be ON be.articulo_id = ba.id AND be.sede = ?
           WHERE ${condicionesConsignacion.map(item => item.replace(/\b(activo|origen_inventario|nombre|codigo|codigo_taller|numero_parte|categoria|proveedor_consignacion)\b/g, "ba.$1")).join(" AND ")}
           GROUP BY ba.id ORDER BY ba.nombre, ba.codigo_taller`,
          [sedeBodega, ...paramsConsignacion]
        )
        : await pool.query(
          `SELECT * FROM bodega_articulos WHERE ${condicionesConsignacion.join(" AND ")} ORDER BY nombre, codigo_taller`,
          paramsConsignacion
        );
    }

    const [movimientos] = await pool.query(`
      SELECT bm.*,
             COALESCE(bm.descripcion_snapshot, ba.nombre) AS articulo_nombre,
             COALESCE(bm.codigo_proveedor_snapshot, ba.codigo) AS codigo,
             COALESCE(bm.codigo_taller_snapshot, ba.codigo_taller) AS codigo_taller,
             ba.unidad_medida, u.usuario AS usuario_nombre
      FROM bodega_movimientos bm
      JOIN bodega_articulos ba ON ba.id = bm.articulo_id
      LEFT JOIN usuarios u ON u.id = bm.creado_por
      WHERE (? = '' OR bm.sede = ?)
      ORDER BY bm.creado_en DESC, bm.id DESC
      LIMIT ? OFFSET ?
    `, [sedeBodega, sedeBodega, limiteMovimientos, (paginaMovimientos - 1) * limiteMovimientos]);
    const [[conteoMovimientos]] = await pool.query(
      "SELECT COUNT(*) AS total FROM bodega_movimientos WHERE (? = '' OR sede = ?)",
      [sedeBodega, sedeBodega]
    );

    const [prestamos] = await pool.query(`
      SELECT bh.*, ba.nombre AS articulo_nombre, ba.codigo, ba.codigo_taller, ba.ubicacion
      FROM bodega_prestamos_herramientas bh
      JOIN bodega_articulos ba ON ba.id = bh.articulo_id
      WHERE bh.estado = 'PRESTADO'
      ORDER BY bh.salida_en ASC, bh.id ASC
      LIMIT 80
    `);

    const [proveedores] = await pool.query("SELECT id, nombre FROM proveedores ORDER BY nombre ASC LIMIT 500");
    const [articulosCompatibilidad] = await pool.query(`
      SELECT *
      FROM bodega_articulos
      WHERE activo = 1 AND grupo_bodega = 'INVENTARIO'
      ORDER BY nombre
    `);
    const [articulosTransferencia] = await pool.query(`
      SELECT id, codigo_taller, codigo, nombre, unidad_medida, grupo_bodega, origen_inventario, stock_actual
      FROM bodega_articulos WHERE activo = 1
      ORDER BY nombre LIMIT 2000
    `);
    const [articulosRecepcion] = await pool.query(`
      SELECT id, codigo_taller, codigo, nombre, categoria, marca, numero_parte, tipo_unidad, ubicacion, origen_inventario
      FROM bodega_articulos
      WHERE activo = 1
      ORDER BY nombre, codigo_taller
    `);
    const [articulosEntrega] = sedeBodega ? await pool.query(`
      SELECT ba.*, COALESCE(SUM(be.cantidad), 0) AS stock_actual
      FROM bodega_articulos ba
      LEFT JOIN bodega_existencias be ON be.articulo_id = ba.id AND be.sede = ?
      WHERE ba.activo = 1
      GROUP BY ba.id
      HAVING stock_actual > 0
      ORDER BY CASE WHEN ba.grupo_bodega = 'SUMINISTRO' THEN 0 ELSE 1 END, ba.nombre
      LIMIT 1000
    `, [sedeBodega]) : await pool.query(`
      SELECT * FROM bodega_articulos
      WHERE activo = 1
        AND stock_actual > 0
      ORDER BY
        CASE WHEN grupo_bodega = 'SUMINISTRO' THEN 0 ELSE 1 END,
        nombre
      LIMIT 1000
    `);
    const [compatibilidades] = await pool.query(`
      SELECT
        bco.id,
        bco.tipo_servicio,
        bco.cantidad,
        bco.observacion,
        bco.nivel_confianza,
        bco.criterio_compatibilidad,
        bco.fuente_url,
        bc.marca,
        bc.modelo,
        bc.anio,
        bc.motor,
        ba.codigo_taller,
        ba.codigo,
        ba.nombre AS articulo_nombre,
        ba.unidad_medida,
        ba.stock_actual
      FROM bodega_compatibilidades bco
      JOIN bodega_configuraciones_unidad bc ON bc.id = bco.configuracion_id
      JOIN bodega_articulos ba ON ba.id = bco.articulo_id
      WHERE bco.activo = 1 AND bc.activo = 1 AND ba.activo = 1
      ORDER BY bc.marca, bc.modelo, bc.anio, bco.tipo_servicio, ba.nombre
      LIMIT 400
    `);
    const [articulosSinCompatibilidad] = await pool.query(`
      SELECT
        ba.id,
        ba.codigo_taller,
        ba.codigo,
        ba.nombre,
        ba.stock_actual,
        ba.unidad_medida
      FROM bodega_articulos ba
      LEFT JOIN bodega_compatibilidades bco
        ON bco.articulo_id = ba.id
       AND bco.activo = 1
      WHERE ba.activo = 1
        AND ba.origen_inventario = 'CONSIGNACION'
        AND UPPER(TRIM(COALESCE(ba.proveedor_consignacion, ''))) = UPPER(?)
      GROUP BY ba.id, ba.codigo_taller, ba.codigo, ba.nombre, ba.stock_actual, ba.unidad_medida
      HAVING COUNT(bco.id) = 0
      ORDER BY ba.nombre
    `, [PROVEEDOR_CONSIGNACION_DEFAULT]);
    const [[unidadesSinFichaRow]] = await pool.query(`
      SELECT COUNT(*) AS total
      FROM unidades
      WHERE COALESCE(activa, 1) = 1
        AND (
          marca IS NULL OR TRIM(marca) = ''
          OR modelo IS NULL OR TRIM(modelo) = ''
        )
    `);
    const proximoCodigoTaller = await siguienteCodigoTaller();

    res.render("bodega", {
      user: req.session.user,
      q,
      sedeBodega,
      sedesDisponibles,
      paginaInventario,
      paginasInventario: Math.max(1, Math.ceil(Number(conteoArticulos.total || 0) / limiteInventario)),
      paginaMovimientos,
      paginasMovimientos: Math.max(1, Math.ceil(Number(conteoMovimientos.total || 0) / limiteMovimientos)),
      origen,
      grupo,
      periodoReporte: defaultPeriod(fechaCostaRica()),
      articulos,
      proveedores,
      articulosCompatibilidad,
      articulosTransferencia,
      articulosRecepcion,
      articulosEntrega,
      compatibilidades,
      articulosSinCompatibilidad,
      unidadesSinFicha: Number(unidadesSinFichaRow.total || 0),
      porComprar,
      articulosConsignacion,
      proveedoresConsignacion,
      proveedorConsignacionSeleccionado,
      movimientos,
      prestamos,
      stats: {
        articulos: Number(stats.articulos || 0),
        stock_bajo: Number(stats.stock_bajo || 0),
        agotados: Number(stats.agotados || 0),
        propios: Number(stats.propios || 0),
        consignacion: Number(stats.consignacion || 0),
        valor_total: Number(stats.valor_total || 0),
        valor_propio: Number(stats.valor_propio || 0),
        valor_consignacion: Number(stats.valor_consignacion || 0),
        herramientas_prestadas: Number(prestadasRow.total || 0),
        movimientos_hoy: Number(movHoy.total || 0)
      },
      tiposArticulo: TIPOS_ARTICULO,
      origenesInventario: ORIGENES_INVENTARIO,
      proveedorConsignacionDefault: PROVEEDOR_CONSIGNACION_DEFAULT,
      proximoCodigoTaller,
      pagina,
      puedeAjustar: puedeAjustar(req.session.user),
      success: req.session.success || "",
      error: req.session.error || ""
    });

    req.session.success = null;
    req.session.error = null;
  } catch (error) {
    console.error("ERROR bodega:", error);
    res.status(500).send("Error cargando bodega");
  }
}

router.get("/", (req, res) => renderBodega(req, res, "inicio"));
router.get("/entregas", (req, res) => renderBodega(req, res, "entregas"));
router.get("/compatibilidad", (req, res) => renderBodega(req, res, "compatibilidad"));
router.get("/suministros", (_req, res) => res.redirect("/bodega/inventario?grupo=SUMINISTRO"));
router.get("/consignacion", (req, res) => renderBodega(req, res, "consignacion"));
router.get("/inventario", (req, res) => renderBodega(req, res, "inventario"));
router.get("/herramientas", (req, res) => renderBodega(req, res, "herramientas"));
router.get("/movimientos", (req, res) => renderBodega(req, res, "movimientos"));

async function movimientosConsumo(origen, period, proveedor = "", sede = "", soloPendientes = false) {
  const params = [origen, period.desde, period.hasta];
  let proveedorSql = "";
  if (proveedor) {
    proveedorSql = " AND COALESCE(NULLIF(TRIM(bm.proveedor_snapshot), ''), NULLIF(TRIM(bm.proveedor_nombre), ''), NULLIF(TRIM(ba.proveedor_consignacion), ''), NULLIF(TRIM(ba.proveedor_nombre), ''), ?) = ?";
    params.push(PROVEEDOR_CONSIGNACION_DEFAULT, proveedor);
  }
  const sedeSql = sede ? " AND bm.sede = ?" : "";
  if (sede) params.push(sede);
  const [rows] = await pool.query(`
    SELECT bm.id, bm.articulo_id, bm.tipo_movimiento, bm.cantidad, bm.precio_unitario, bm.creado_en,
           bm.placa, bm.mecanico,
           COALESCE(bm.codigo_taller_snapshot, ba.codigo_taller) AS codigo_taller,
           COALESCE(bm.codigo_proveedor_snapshot, ba.codigo) AS codigo,
           COALESCE(bm.descripcion_snapshot, ba.nombre) AS nombre,
           ba.unidad_medida, ba.proveedor_id,
           ba.precio_unitario AS precio_actual,
           COALESCE(NULLIF(TRIM(bm.proveedor_snapshot), ''), NULLIF(TRIM(bm.proveedor_nombre), ''),
                    NULLIF(TRIM(ba.proveedor_consignacion), ''), NULLIF(TRIM(ba.proveedor_nombre), ''), ?) AS proveedor
    FROM bodega_movimientos bm
    JOIN bodega_articulos ba ON ba.id = bm.articulo_id
    ${soloPendientes ? "LEFT JOIN bodega_ordenes_consumo_movimientos bom ON bom.movimiento_id = bm.id" : ""}
    WHERE bm.origen_inventario = ?
      AND bm.tipo_movimiento IN ('SALIDA', 'DEVOLUCION')
      AND DATE(bm.creado_en) BETWEEN ? AND ?${proveedorSql}${sedeSql}${soloPendientes ? " AND bom.movimiento_id IS NULL" : ""}
    ORDER BY bm.creado_en, bm.id
  `, [PROVEEDOR_CONSIGNACION_DEFAULT, ...params]);
  return consumption(rows);
}

router.get("/consignacion/orden/revisar", async (req, res) => {
  try {
    const period = reportPeriod(req.query, fechaCostaRica());
    const proveedor = limpiar(req.query.proveedor);
    const sedes = await sedesBodega();
    const sedeSolicitada = limpiar(req.query.sede);
    const sede = sedeSolicitada && sedes.includes(sedeSolicitada) ? sedeSolicitada : "";
    if (!proveedor) throw new Error("Seleccione el proveedor de consignación.");

    const [proveedores] = await pool.query(`
      SELECT COALESCE(NULLIF(TRIM(proveedor_consignacion), ''), NULLIF(TRIM(proveedor_nombre), ''), ?) AS proveedor
      FROM bodega_articulos
      WHERE activo = 1 AND origen_inventario = 'CONSIGNACION'
      GROUP BY proveedor
      ORDER BY proveedor
    `, [PROVEEDOR_CONSIGNACION_DEFAULT]);
    if (!proveedores.some(item => item.proveedor === proveedor)) {
      throw new Error("El proveedor seleccionado no tiene artículos de consignación activos.");
    }

    const data = await movimientosConsumo("CONSIGNACION", period, proveedor, sede, true);
    const lineas = consumptionOrderLines(data.details);
    const consumosSinPlaca = data.details.filter(item => !limpiar(item.placa));
    if (!lineas.length) throw new Error("No hay consumos pendientes con cantidad neta positiva para ese proveedor y período.");

    res.render("bodega_consignacion_confirmar", {
      user: req.session.user,
      proveedor,
      sede,
      period,
      lineas,
      consumosSinPlaca: consumosSinPlaca.length,
      total: lineas.reduce((sum, item) => sum + Number(item.costo_neto || 0), 0),
      movimientos: data.details.length
    });
  } catch (error) {
    req.session.error = error.message || "No se pudo revisar el consumo de consignación.";
    const params = new URLSearchParams();
    if (req.query.proveedor) params.set("proveedor", limpiar(req.query.proveedor));
    if (req.query.sede) params.set("sede", limpiar(req.query.sede));
    res.redirect(`/bodega/consignacion${params.size ? `?${params}` : ""}`);
  }
});

router.get("/inventario/exportar.xlsx", async (req, res) => {
  try {
    await ensureBodegaTables();
    const q = limpiar(req.query.q);
    const origen = origenInventario(req.query.origen, "");
    const grupo = ["SUMINISTRO", "INVENTARIO"].includes(upper(req.query.grupo)) ? upper(req.query.grupo) : "";
    const sedes = await sedesBodega();
    const sede = sedes.includes(limpiar(req.query.sede)) ? limpiar(req.query.sede) : "";
    const conditions = ["activo = 1"];
    const params = [];
    if (origen) { conditions.push("origen_inventario = ?"); params.push(origen); }
    if (grupo) { conditions.push("grupo_bodega = ?"); params.push(grupo); }
    if (q) {
      conditions.push("(nombre LIKE ? OR codigo LIKE ? OR codigo_taller LIKE ? OR numero_parte LIKE ? OR categoria LIKE ? OR marca LIKE ? OR tipo_unidad LIKE ? OR ubicacion LIKE ? OR proveedor_consignacion LIKE ?)");
      params.push(...Array(9).fill(`%${q}%`));
    }
    const [articles] = sede ? await pool.query(
      `SELECT ba.codigo_taller, ba.codigo, ba.nombre, ba.origen_inventario, ba.grupo_bodega, ba.unidad_medida,
              ba.ubicacion, ba.proveedor_consignacion, ba.proveedor_nombre, COALESCE(SUM(be.cantidad), 0) AS stock_actual,
              ba.stock_minimo, ba.stock_maximo, ba.precio_unitario
       FROM bodega_articulos ba LEFT JOIN bodega_existencias be ON be.articulo_id = ba.id AND be.sede = ?
       WHERE ${conditions.map(item => item.replace(/\b(activo|origen_inventario|grupo_bodega|nombre|codigo|codigo_taller|numero_parte|categoria|marca|tipo_unidad|ubicacion|proveedor_consignacion)\b/g, "ba.$1")).join(" AND ")}
       GROUP BY ba.id ORDER BY ba.origen_inventario, ba.nombre, ba.codigo_taller`, [sede, ...params]
    ) : await pool.query(
      `SELECT codigo_taller, codigo, nombre, origen_inventario, grupo_bodega, unidad_medida,
              ubicacion, proveedor_consignacion, proveedor_nombre, stock_actual, stock_minimo,
              stock_maximo, precio_unitario
       FROM bodega_articulos WHERE ${conditions.join(" AND ")}
       ORDER BY origen_inventario, nombre, codigo_taller`, params
    );
    const buffer = await inventoryXlsx(articles, [sede, origen, grupo, q].filter(Boolean).join(" · "));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="inventario_bodega_${fechaCostaRica()}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error("ERROR exportar inventario bodega:", error);
    res.status(500).send("No se pudo descargar el inventario.");
  }
});

router.get("/consignacion/consumos.xlsx", async (req, res) => {
  let period;
  try { period = reportPeriod(req.query, fechaCostaRica()); }
  catch (error) { return res.status(400).send(error.message); }
  try {
    await ensureBodegaTables();
    const proveedor = limpiar(req.query.proveedor);
    const sedes = await sedesBodega();
    const sede = sedes.includes(limpiar(req.query.sede)) ? limpiar(req.query.sede) : "";
    const data = await movimientosConsumo("CONSIGNACION", period, proveedor, sede);
    const buffer = await consignmentXlsx(data, period, [proveedor, sede].filter(Boolean).join(" · "));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="consumo_consignacion_${period.desde}_${period.hasta}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error("ERROR reporte consumo consignación:", error);
    res.status(500).send("No se pudo descargar el consumo de consignación.");
  }
});

router.get("/inventario/propio.pdf", async (req, res) => {
  let period;
  try { period = reportPeriod(req.query, fechaCostaRica()); }
  catch (error) { return res.status(400).send(error.message); }
  try {
    await ensureBodegaTables();
    const sedes = await sedesBodega();
    const sede = sedes.includes(limpiar(req.query.sede)) ? limpiar(req.query.sede) : "";
    const [articles] = sede ? await pool.query(`
      SELECT ba.id, ba.codigo_taller, ba.codigo, ba.nombre, COALESCE(SUM(be.cantidad), 0) AS stock_actual, ba.precio_unitario
      FROM bodega_articulos ba
      LEFT JOIN bodega_existencias be ON be.articulo_id = ba.id AND be.sede = ?
      WHERE ba.activo = 1 AND ba.origen_inventario = 'PROPIO'
      GROUP BY ba.id ORDER BY ba.nombre, ba.codigo_taller
    `, [sede]) : await pool.query(`
      SELECT id, codigo_taller, codigo, nombre, stock_actual, precio_unitario
      FROM bodega_articulos
      WHERE activo = 1 AND origen_inventario = 'PROPIO'
      ORDER BY nombre, codigo_taller
    `);
    const data = await movimientosConsumo("PROPIO", period, "", sede);
    const buffer = await ownInventoryPdf(articles, data, period);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="inventario_propio_${period.desde}_${period.hasta}.pdf"`);
    res.send(buffer);
  } catch (error) {
    console.error("ERROR reporte inventario propio:", error);
    res.status(500).send("No se pudo descargar el PDF de inventario propio.");
  }
});

router.get("/api/placas", async (req, res) => {
  try {
    const busqueda = upper(req.query.q).replace(/[^A-Z0-9]/g, "").slice(0, 30);
    if (!busqueda) return res.json([]);
    const [unidades] = await pool.query(
      `SELECT id, placa, sede, marca, modelo
       FROM unidades
       WHERE COALESCE(activa, 1) = 1
         AND REPLACE(UPPER(TRIM(placa)), ' ', '') LIKE ?
       ORDER BY CASE WHEN REPLACE(UPPER(TRIM(placa)), ' ', '') LIKE ? THEN 0 ELSE 1 END, placa
       LIMIT 12`,
      [`%${busqueda}%`, `${busqueda}%`]
    );
    res.json(unidades);
  } catch (error) {
    console.error("ERROR buscando placas en bodega:", error);
    res.status(500).json({ error: "No se pudieron consultar las placas." });
  }
});

router.get("/api/salidas-pendientes", async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT bm.id, bm.articulo_id, bm.cantidad, bm.placa, bm.mecanico, bm.sede, bm.ubicacion,
             bm.creado_en, bm.precio_unitario,
             COALESCE(bm.descripcion_snapshot, ba.nombre) AS descripcion,
             COALESCE(bm.codigo_taller_snapshot, ba.codigo_taller) AS codigo_taller,
             bm.cantidad - COALESCE(SUM(br.cantidad), 0) AS pendiente
      FROM bodega_movimientos bm
      JOIN bodega_articulos ba ON ba.id = bm.articulo_id
      LEFT JOIN bodega_movimientos br
        ON br.movimiento_origen_id = bm.id AND br.tipo_movimiento = 'DEVOLUCION'
      WHERE bm.tipo_movimiento = 'SALIDA'
      GROUP BY bm.id
      HAVING pendiente > 0
      ORDER BY bm.creado_en DESC, bm.id DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (error) {
    console.error("ERROR salidas pendientes de devolución:", error);
    res.status(500).json({ error: "No se pudieron consultar las salidas pendientes." });
  }
});

router.get("/api/compatibilidad/:placa", async (req, res) => {
  try {
    await ensureBodegaTables();
    const unidad = await obtenerUnidadPorPlaca(pool, req.params.placa);
    if (!unidad) return res.status(404).json({ error: "No se encontró una unidad activa con esa placa." });
    if (!unidad.marca || !unidad.modelo) {
      return res.status(422).json({
        error: "La unidad no tiene marca y modelo completos. Actualícelos en Unidades antes de configurar repuestos.",
        unidad
      });
    }

    const configuracion = await obtenerConfiguracionUnidad(pool, unidad);
    if (!configuracion) {
      return res.json({ unidad, configuracion: null, servicios: [], productos: [] });
    }

    const [productos] = await pool.query(`
      SELECT
        bco.id AS compatibilidad_id,
        bco.tipo_servicio,
        bco.cantidad AS cantidad_recomendada,
        bco.observacion,
        bco.nivel_confianza,
        bco.criterio_compatibilidad,
        bco.fuente_url,
        ba.id AS articulo_id,
        ba.codigo_taller,
        ba.codigo,
        ba.nombre,
        ba.stock_actual,
        ba.stock_minimo,
        ba.unidad_medida,
        ba.ubicacion,
        ba.origen_inventario,
        ba.precio_unitario
      FROM bodega_compatibilidades bco
      JOIN bodega_articulos ba ON ba.id = bco.articulo_id
      WHERE bco.configuracion_id = ?
        AND bco.activo = 1
        AND ba.activo = 1
      ORDER BY bco.tipo_servicio, ba.nombre
    `, [configuracion.id]);

    const servicios = [...new Set(productos.map(item => item.tipo_servicio))];
    res.json({ unidad, configuracion, servicios, productos });
  } catch (error) {
    console.error("ERROR buscando compatibilidad bodega:", error);
    res.status(500).json({ error: "No se pudieron consultar los repuestos compatibles." });
  }
});

router.post("/compatibilidad", async (req, res) => {
  if (!requiereRol(ROLES_CATALOGO, req, res)) return;
  const conn = await pool.getConnection();
  try {
    await ensureBodegaTables();
    await conn.beginTransaction();
    const unidad = await obtenerUnidadPorPlaca(conn, req.body.placa, true);
    const articuloId = Number(req.body.articulo_id);
    const cantidad = numero(req.body.cantidad);
    const tipoServicio = upper(req.body.tipo_servicio || "GENERAL").replace(/\s+/g, " ").slice(0, 80);
    const motor = limpiar(req.body.motor || unidad?.motor);

    if (!unidad) throw new Error("No se encontró una unidad activa con esa placa.");
    if (!unidad.marca || !unidad.modelo) throw new Error("La unidad debe tener marca y modelo antes de crear compatibilidades.");
    if (!articuloId || cantidad <= 0) throw new Error("Seleccione el artículo y una cantidad válida.");

    const [[articulo]] = await conn.query("SELECT id FROM bodega_articulos WHERE id = ? AND activo = 1 LIMIT 1", [articuloId]);
    if (!articulo) throw new Error("El artículo seleccionado no existe o está inactivo.");

    let configuracion = await obtenerConfiguracionUnidad(conn, unidad);
    if (!configuracion) {
      const [result] = await conn.query(
        `INSERT INTO bodega_configuraciones_unidad
          (marca, modelo, anio, motor, descripcion, creado_por)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          unidad.marca,
          unidad.modelo,
          unidad.anio || null,
          motor || null,
          [unidad.marca, unidad.modelo, unidad.anio, motor].filter(Boolean).join(" "),
          req.session.user.id
        ]
      );
      configuracion = { id: result.insertId };
    } else if (motor && !limpiar(configuracion.motor)) {
      await conn.query("UPDATE bodega_configuraciones_unidad SET motor = ? WHERE id = ?", [motor, configuracion.id]);
    }

    await conn.query(
      `INSERT INTO bodega_unidades_configuracion (unidad_id, configuracion_id, creado_por)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE configuracion_id = VALUES(configuracion_id), actualizado_en = CURRENT_TIMESTAMP`,
      [unidad.id, configuracion.id, req.session.user.id]
    );
    if (motor) await conn.query("UPDATE unidades SET motor = ? WHERE id = ?", [motor, unidad.id]);

    await conn.query(
      `INSERT INTO bodega_compatibilidades
        (configuracion_id, articulo_id, tipo_servicio, cantidad, observacion, nivel_confianza, criterio_compatibilidad, creado_por)
       VALUES (?, ?, ?, ?, ?, 'MANUAL', 'Asignación manual realizada desde Bodega', ?)
       ON DUPLICATE KEY UPDATE cantidad = VALUES(cantidad), observacion = VALUES(observacion), nivel_confianza = 'MANUAL', criterio_compatibilidad = VALUES(criterio_compatibilidad), activo = 1, actualizado_en = CURRENT_TIMESTAMP`,
      [configuracion.id, articuloId, tipoServicio || "GENERAL", cantidad, limpiar(req.body.observacion) || null, req.session.user.id]
    );

    await conn.commit();
    req.session.success = `Compatibilidad guardada para ${unidad.placa}.`;
  } catch (error) {
    await conn.rollback();
    console.error("ERROR guardar compatibilidad bodega:", error);
    req.session.error = error.message || "No se pudo guardar la compatibilidad.";
  } finally {
    conn.release();
  }
  res.redirect("/bodega/compatibilidad");
});

router.post("/compatibilidad/:id/eliminar", async (req, res) => {
  if (!requiereRol(ROLES_CATALOGO, req, res)) return;
  try {
    await ensureBodegaTables();
    await pool.query("UPDATE bodega_compatibilidades SET activo = 0 WHERE id = ?", [Number(req.params.id)]);
    req.session.success = "Compatibilidad eliminada.";
  } catch (error) {
    console.error("ERROR eliminar compatibilidad bodega:", error);
    req.session.error = "No se pudo eliminar la compatibilidad.";
  }
  res.redirect("/bodega/compatibilidad");
});

router.post("/articulos", async (req, res) => {
  if (!requiereRol(ROLES_CATALOGO, req, res)) return;
  try {
    await ensureBodegaTables();
    const proveedor = await obtenerProveedor(req.body.proveedor_id, req.body.proveedor_nombre);
    const tipo = TIPOS_ARTICULO.includes(upper(req.body.tipo_articulo)) ? upper(req.body.tipo_articulo) : "REPUESTO";
    const origen = origenInventario(req.body.origen_inventario);
    const grupo = upper(req.body.grupo_bodega) === "SUMINISTRO" ? "SUMINISTRO" : "INVENTARIO";
    const codigoInterno = codigoTaller(req.body.codigo_taller) || await siguienteCodigoTaller();
    const codigo = limpiar(req.body.codigo) || null;
    const nombre = limpiar(req.body.nombre);
    if (numero(req.body.stock_actual) !== 0) throw new Error("El artículo se crea sin existencia. Registre el saldo mediante una entrada para conservar trazabilidad.");
    if (!nombre) {
      req.session.error = "Debe escribir el nombre del artículo.";
      return redirectBodega(req, res);
    }

    await pool.query(
      `INSERT INTO bodega_articulos (
        codigo_taller, codigo, nombre, tipo_articulo, grupo_bodega, origen_inventario, categoria, marca, numero_parte, tipo_unidad, unidad_medida,
        stock_actual, stock_minimo, stock_maximo, ubicacion, precio_unitario,
        proveedor_id, proveedor_nombre, proveedor_consignacion, fecha_ultima_compra, observacion, creado_por
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        codigoInterno,
        codigo,
        nombre,
        tipo,
        grupo,
        origen,
        limpiar(req.body.categoria) || null,
        limpiar(req.body.marca) || null,
        limpiar(req.body.numero_parte) || null,
        limpiar(req.body.tipo_unidad) || null,
        limpiar(req.body.unidad_medida) || "UND",
        0,
        numero(req.body.stock_minimo),
        numero(req.body.stock_maximo),
        limpiar(req.body.ubicacion) || null,
        numero(req.body.precio_unitario),
        proveedor.id,
        proveedor.nombre,
        origen === "CONSIGNACION" ? (limpiar(req.body.proveedor_consignacion) || PROVEEDOR_CONSIGNACION_DEFAULT) : null,
        req.body.fecha_ultima_compra || null,
        limpiar(req.body.observacion) || null,
        req.session.user.id
      ]
    );

    req.session.success = "Artículo creado correctamente.";
  } catch (error) {
    console.error("ERROR crear artículo bodega:", error);
    req.session.error = error.code === "ER_DUP_ENTRY" ? "Ya existe un artículo con ese código." : (error.message || "No se pudo crear el artículo.");
  }
  redirectBodega(req, res);
});

router.post("/suministros", async (req, res) => {
  if (!requiereRol(ROLES_CATALOGO, req, res)) return;
  try {
    await ensureBodegaTables();
    const proveedor = await obtenerProveedor(req.body.proveedor_id, req.body.proveedor_nombre);
    const codigoInterno = codigoTaller(req.body.codigo_taller) || await siguienteCodigoTaller();
    const nombre = limpiar(req.body.nombre);
    if (numero(req.body.stock_actual) !== 0) throw new Error("El suministro se crea sin existencia. Registre el saldo mediante una entrada para conservar trazabilidad.");
    if (!nombre) {
      req.session.error = "Debe escribir el nombre del suministro.";
      return redirectBodega(req, res);
    }

    await pool.query(
      `INSERT INTO bodega_articulos (
        codigo_taller, codigo, nombre, tipo_articulo, grupo_bodega, origen_inventario, categoria, marca, numero_parte, tipo_unidad, unidad_medida,
        stock_actual, stock_minimo, stock_maximo, ubicacion, precio_unitario,
        proveedor_id, proveedor_nombre, proveedor_consignacion, fecha_ultima_compra, observacion, creado_por
      ) VALUES (?, ?, ?, 'CONSUMIBLE', 'SUMINISTRO', 'PROPIO', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        codigoInterno,
        limpiar(req.body.codigo) || null,
        nombre,
        limpiar(req.body.categoria) || "Suministros",
        limpiar(req.body.marca) || null,
        limpiar(req.body.numero_parte) || null,
        limpiar(req.body.tipo_unidad) || null,
        limpiar(req.body.unidad_medida) || "UND",
        0,
        numero(req.body.stock_minimo),
        numero(req.body.stock_maximo),
        limpiar(req.body.ubicacion) || null,
        numero(req.body.precio_unitario),
        proveedor.id,
        proveedor.nombre,
        req.body.fecha_ultima_compra || fechaCostaRica(),
        limpiar(req.body.observacion) || null,
        req.session.user.id
      ]
    );

    req.session.success = "Suministro agregado correctamente.";
  } catch (error) {
    console.error("ERROR crear suministro bodega:", error);
    req.session.error = error.code === "ER_DUP_ENTRY" ? "Ya existe un artículo con ese código." : (error.message || "No se pudo agregar el suministro.");
  }
  res.redirect("/bodega/inventario?grupo=SUMINISTRO");
});

router.post("/entregar", async (req, res) => {
  const conn = await pool.getConnection();
  let notificacionRetiro = null;
  try {
    await ensureBodegaTables();
    await ensureGastosOperativosTables();
    const sinPlaca = String(req.body.sin_placa || "") === "1";
    const placaSolicitada = sinPlaca ? "" : limpiar(req.body.placa);
    const mecanico = limpiar(req.body.mecanico);
    const sede = await validarSedeBodega(conn, req.body.sede);
    const tipoTrabajo = "OTRO";
    const observacion = limpiar(req.body.observacion) || null;
    const articuloIds = toArray(req.body.articulo_id);
    const cantidades = toArray(req.body.cantidad);
    const origenes = toArray(req.body.origen_salida);
    const lineas = articuloIds
      .map((id, index) => ({
        id: Number(id),
        cantidad: numero(cantidades[index]),
        origen_salida: origenInventario(origenes[index], "")
      }))
      .filter(linea => linea.id && linea.cantidad > 0);

    if ((!sinPlaca && !placaSolicitada) || !mecanico || !lineas.length) {
      req.session.error = "Indique una placa o marque Sin placa; también debe indicar mecánico y al menos un artículo.";
      return redirectBodega(req, res);
    }

    await conn.beginTransaction();
    const unidadEntrega = placaSolicitada ? await obtenerUnidadPorPlaca(conn, placaSolicitada, true) : null;
    if (placaSolicitada && !unidadEntrega) throw new Error("Seleccione una placa activa de la lista de unidades.");
    const placa = unidadEntrega?.placa || null;
    const [entregaResult] = await conn.query(
      "INSERT INTO bodega_entregas (placa, mecanico, tipo_trabajo, observacion, creado_por) VALUES (?, ?, ?, ?, ?)",
      [placa, mecanico, tipoTrabajo, observacion, req.session.user.id]
    );
    const entregaId = entregaResult.insertId;
    const articulosNotificacion = [];

    for (const linea of lineas) {
      const articulo = await articuloParaMovimiento(conn, linea.id);
      const origenSalida = articulo.origen_inventario || "PROPIO";
      if (linea.origen_salida && linea.origen_salida !== origenSalida) {
        throw new Error(`La procedencia seleccionada para ${articulo.nombre} no coincide con su inventario.`);
      }
      const saldo = await aplicarCambioExistencia(conn, articulo, sede, articulo.ubicacion || "", -linea.cantidad);
      const anterior = saldo.anterior;
      const nueva = saldo.nueva;

      let prestamoId = null;
      const tipoMovimiento = articulo.tipo_articulo === "HERRAMIENTA" ? "PRESTAMO" : "SALIDA";
      if (articulo.tipo_articulo === "HERRAMIENTA") {
        const [prestamoResult] = await conn.query(
          `INSERT INTO bodega_prestamos_herramientas
            (articulo_id, mecanico, placa, sede, ubicacion, cantidad, observacion, creado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [articulo.id, mecanico, placa, sede, articulo.ubicacion || "", linea.cantidad, observacion, req.session.user.id]
        );
        prestamoId = prestamoResult.insertId;
      }

      const [movimientoResult] = await conn.query(
        `INSERT INTO bodega_movimientos (
          articulo_id, entrega_id, prestamo_id, tipo_movimiento, origen_inventario, sede, ubicacion,
          cantidad, existencia_anterior, existencia_nueva, placa, mecanico, tipo_trabajo,
          precio_unitario, motivo, creado_por, codigo_taller_snapshot, codigo_proveedor_snapshot,
          descripcion_snapshot, proveedor_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          articulo.id,
          entregaId,
          prestamoId,
          tipoMovimiento,
          origenSalida,
          sede,
          articulo.ubicacion || "",
          linea.cantidad,
          anterior,
          nueva,
          placa,
          mecanico,
          tipoTrabajo,
          Number(articulo.precio_unitario || 0),
          observacion,
          req.session.user.id,
          articulo.codigo_taller || null,
          articulo.codigo || null,
          articulo.nombre,
          articulo.proveedor_consignacion || articulo.proveedor_nombre || null
        ]
      );
      const movimientoId = movimientoResult.insertId;

      await registrarGastoOperativo({
        fuente: "BODEGA",
        fuente_id: movimientoId,
        detalle_id: articulo.id,
        fecha: new Date(),
        placa,
        sede,
        rubro: "",
        categoria: articulo.categoria || "",
        tipo_trabajo: tipoTrabajo,
        proveedor: articulo.proveedor_nombre || articulo.proveedor_consignacion || "",
        descripcion: articulo.nombre,
        cantidad: linea.cantidad,
        precio_unitario: Number(articulo.precio_unitario || 0),
        monto: Number(linea.cantidad || 0) * Number(articulo.precio_unitario || 0),
        creado_por: req.session.user.id,
        metadata: {
          entrega_id: entregaId,
          articulo_id: articulo.id,
          codigo_taller: articulo.codigo_taller || "",
          codigo_proveedor: articulo.codigo || "",
          origen_inventario: origenSalida,
          tipo_movimiento: tipoMovimiento,
          mecanico,
          sede
        }
      }, conn, { ensure: false });

      articulosNotificacion.push({
        codigo_taller: articulo.codigo_taller || "",
        nombre: articulo.nombre,
        cantidad: linea.cantidad,
        unidad_medida: articulo.unidad_medida || "",
        origen: origenSalida,
        tipo_movimiento: tipoMovimiento
      });
    }

    await registrarAuditoriaSistema({
      modulo: "Bodega",
      tabla: "bodega_entregas",
      registro_id: entregaId,
      accion: "CREAR",
      resumen: `Retiro de ${articulosNotificacion.length} articulo(s) para ${placa || "sin placa"}`,
      despues: {
        placa,
        mecanico,
        tipo_trabajo: tipoTrabajo,
        observacion,
        sede,
        articulos: articulosNotificacion
      },
      usuario_id: req.session.user.id,
      usuario_nombre: req.session.user.usuario
    }, conn, { ensure: false });

    await conn.commit();
    const resumenArticulos = articulosNotificacion
      .slice(0, 3)
      .map(item => `${item.codigo_taller ? `${item.codigo_taller} · ` : ""}${item.nombre} (${Number(item.cantidad).toLocaleString("es-CR")} ${item.unidad_medida || ""})`)
      .join("; ");
    const extras = articulosNotificacion.length > 3 ? ` +${articulosNotificacion.length - 3} más` : "";
    notificacionRetiro = {
      title: "Retiro de material en bodega",
      body: `${placa || "Sin placa"} · ${mecanico} · ${resumenArticulos}${extras}`,
      icon: "/img/app-icon.svg",
      badge: "/img/app-icon.svg",
      url: "/bodega/movimientos",
      tag: `bodega-retiro-${entregaId}`,
      data: {
        url: "/bodega/movimientos",
        entregaId,
        placa,
        mecanico,
        tipoTrabajo,
        creadoPor: req.session.user.usuario || req.session.user.id || null
      }
    };
    req.session.success = "Entrega registrada y stock actualizado.";
  } catch (error) {
    await conn.rollback();
    console.error("ERROR entregar bodega:", error);
    req.session.error = error.message || "No se pudo registrar la entrega.";
  } finally {
    conn.release();
  }
  if (notificacionRetiro) {
    enviarNotificacionAdmins(notificacionRetiro).catch(error => {
      console.warn("No se pudo enviar notificación de retiro de bodega:", error.code || error.message);
    });
  }
  redirectBodega(req, res);
});

router.post("/recibir", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureBodegaTables();
    const articuloId = Number(req.body.articulo_id);
    const cantidad = numero(req.body.cantidad);
    if (!articuloId || cantidad <= 0) {
      req.session.error = "Debe seleccionar un artículo y una cantidad recibida.";
      return redirectBodega(req, res);
    }

    const proveedor = await obtenerProveedor(req.body.proveedor_id, req.body.proveedor_nombre);
    const origen = origenInventario(req.body.origen_inventario);
    await conn.beginTransaction();
    const sede = await validarSedeBodega(conn, req.body.sede);
    const destinoRecepcion = upper(req.body.destino_recepcion || "GENERALES");
    if (!["GENERALES", "PLACA"].includes(destinoRecepcion)) throw new Error("Seleccione Generales o Por placa.");
    const placaSolicitada = destinoRecepcion === "PLACA" ? limpiar(req.body.placa) : "";
    const unidad = placaSolicitada ? await obtenerUnidadPorPlaca(conn, placaSolicitada, true) : null;
    if (destinoRecepcion === "PLACA" && !unidad) throw new Error("Seleccione una placa activa de la lista de unidades.");
    const articulo = await articuloParaMovimiento(conn, articuloId);
    if (origen !== articulo.origen_inventario) {
      throw new Error("El origen seleccionado no coincide con el artículo. Cree un código de inventario separado si la procedencia es diferente.");
    }
    const saldo = await aplicarCambioExistencia(conn, articulo, sede, articulo.ubicacion || "", cantidad);
    const anterior = saldo.anterior;
    const nueva = saldo.nueva;
    const precioIngresado = limpiar(req.body.precio_unitario);
    const precio = precioIngresado ? numero(precioIngresado) : Number(articulo.precio_unitario || 0);

    await conn.query(
      `UPDATE bodega_articulos
       SET precio_unitario = ?, proveedor_id = ?, proveedor_nombre = ?, proveedor_consignacion = ?, fecha_ultima_compra = ?
       WHERE id = ?`,
      [
        precio,
        proveedor.id,
        proveedor.nombre,
        origen === "CONSIGNACION" ? (proveedor.nombre || articulo.proveedor_consignacion || PROVEEDOR_CONSIGNACION_DEFAULT) : articulo.proveedor_consignacion,
        req.body.fecha || fechaCostaRica(),
        articulo.id
      ]
    );

    await conn.query(
      `INSERT INTO bodega_movimientos (
        articulo_id, tipo_movimiento, origen_inventario, sede, ubicacion, cantidad, existencia_anterior, existencia_nueva,
        placa, destino_recepcion, proveedor_id, proveedor_nombre, numero_factura, orden_compra_id, precio_unitario, motivo, creado_por,
        codigo_taller_snapshot, codigo_proveedor_snapshot, descripcion_snapshot, proveedor_snapshot
      ) VALUES (?, 'ENTRADA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        articulo.id,
        origen,
        sede,
        articulo.ubicacion || "",
        cantidad,
        anterior,
        nueva,
        unidad?.placa || null,
        destinoRecepcion,
        proveedor.id,
        proveedor.nombre,
        limpiar(req.body.numero_factura) || null,
        Number(req.body.orden_compra_id) || null,
        precio,
        limpiar(req.body.motivo) || "Entrada de mercadería",
        req.session.user.id,
        articulo.codigo_taller || null,
        articulo.codigo || null,
        articulo.nombre,
        proveedor.nombre || (origen === "CONSIGNACION" ? articulo.proveedor_consignacion : null) || null
      ]
    );

    await conn.commit();
    req.session.success = "Entrada registrada correctamente.";
  } catch (error) {
    await conn.rollback();
    console.error("ERROR recibir bodega:", error);
    req.session.error = error.message || "No se pudo registrar la entrada.";
  } finally {
    conn.release();
  }
  redirectBodega(req, res);
});

router.post("/devolver", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureBodegaTables();
    const movimientoOrigenId = Number(req.body.movimiento_origen_id);
    const cantidad = numero(req.body.cantidad);
    if (!movimientoOrigenId || cantidad <= 0) {
      req.session.error = "Seleccione la salida original y una cantidad válida para devolver.";
      return redirectBodega(req, res);
    }

    await conn.beginTransaction();
    const [[salida]] = await conn.query(
      "SELECT * FROM bodega_movimientos WHERE id = ? AND tipo_movimiento = 'SALIDA' FOR UPDATE",
      [movimientoOrigenId]
    );
    if (!salida) throw new Error("La salida original no existe o no permite devoluciones.");
    const [[devuelto]] = await conn.query(
      "SELECT COALESCE(SUM(cantidad), 0) AS total FROM bodega_movimientos WHERE movimiento_origen_id = ? AND tipo_movimiento = 'DEVOLUCION'",
      [salida.id]
    );
    const pendiente = Number(salida.cantidad || 0) - Number(devuelto.total || 0);
    if (cantidad > pendiente) throw new Error(`La salida solo tiene ${pendiente} pendiente(s) de devolución.`);
    const articulo = await articuloParaMovimiento(conn, salida.articulo_id);
    const sede = salida.sede || "POR_CLASIFICAR";
    const ubicacion = salida.ubicacion ?? articulo.ubicacion ?? "";
    const saldo = await aplicarCambioExistencia(conn, articulo, sede, ubicacion, cantidad);
    await conn.query(
      `INSERT INTO bodega_movimientos (
        articulo_id, tipo_movimiento, origen_inventario, sede, ubicacion, movimiento_origen_id,
        cantidad, existencia_anterior, existencia_nueva, placa, mecanico, precio_unitario, motivo, creado_por,
        codigo_taller_snapshot, codigo_proveedor_snapshot, descripcion_snapshot, proveedor_snapshot
      ) VALUES (?, 'DEVOLUCION', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        articulo.id,
        salida.origen_inventario || articulo.origen_inventario || "PROPIO",
        sede,
        ubicacion,
        salida.id,
        cantidad,
        saldo.anterior,
        saldo.nueva,
        salida.placa || null,
        salida.mecanico || null,
        Number(salida.precio_unitario || 0),
        limpiar(req.body.motivo) || "Devolución",
        req.session.user.id,
        salida.codigo_taller_snapshot || articulo.codigo_taller || null,
        salida.codigo_proveedor_snapshot || articulo.codigo || null,
        salida.descripcion_snapshot || articulo.nombre,
        salida.proveedor_snapshot || articulo.proveedor_consignacion || articulo.proveedor_nombre || null
      ]
    );
    await conn.commit();
    req.session.success = "Devolución registrada.";
  } catch (error) {
    await conn.rollback();
    console.error("ERROR devolución bodega:", error);
    req.session.error = error.message || "No se pudo registrar la devolución.";
  } finally {
    conn.release();
  }
  redirectBodega(req, res);
});

router.post("/prestamos/:id/devolver", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureBodegaTables();
    await conn.beginTransaction();
    const [[prestamo]] = await conn.query(
      "SELECT * FROM bodega_prestamos_herramientas WHERE id = ? AND estado = 'PRESTADO' FOR UPDATE",
      [req.params.id]
    );
    if (!prestamo) throw new Error("Préstamo no encontrado.");
    const articulo = await articuloParaMovimiento(conn, prestamo.articulo_id);
    const cantidadDevueltaAntes = Number(prestamo.cantidad_devuelta || 0);
    const cantidadPrestamo = Number(prestamo.cantidad || 0);
    const cantidadDevuelta = numero(req.body.cantidad) || (cantidadPrestamo - cantidadDevueltaAntes);
    if (cantidadDevuelta <= 0 || cantidadDevuelta > cantidadPrestamo - cantidadDevueltaAntes) {
      throw new Error("La cantidad devuelta debe ser positiva y no puede superar el saldo prestado.");
    }
    const saldo = await aplicarCambioExistencia(conn, articulo, prestamo.sede || "POR_CLASIFICAR", prestamo.ubicacion || articulo.ubicacion || "", cantidadDevuelta);
    const anterior = saldo.anterior;
    const nueva = saldo.nueva;
    const totalDevuelto = cantidadDevueltaAntes + cantidadDevuelta;
    const estadoDevolucion = totalDevuelto >= cantidadPrestamo ? "DEVUELTO" : "PRESTADO";

    await conn.query(
      `UPDATE bodega_prestamos_herramientas
       SET cantidad_devuelta = ?, estado = ?, devolucion_en = CASE WHEN ? = 'DEVUELTO' THEN CURRENT_TIMESTAMP ELSE NULL END,
           recibido_por = ?, actualizado_por = ?
       WHERE id = ?`,
      [totalDevuelto, estadoDevolucion, estadoDevolucion, limpiar(req.body.recibido_por) || req.session.user.usuario, req.session.user.id, prestamo.id]
    );
    await conn.query(
      `INSERT INTO bodega_movimientos (
        articulo_id, prestamo_id, tipo_movimiento, origen_inventario, sede, ubicacion, cantidad, existencia_anterior, existencia_nueva,
        placa, mecanico, motivo, creado_por, codigo_taller_snapshot, codigo_proveedor_snapshot, descripcion_snapshot, proveedor_snapshot
      ) VALUES (?, ?, 'DEVOLUCION_HERRAMIENTA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        articulo.id,
        prestamo.id,
        articulo.origen_inventario || "PROPIO",
        prestamo.sede || "POR_CLASIFICAR",
        prestamo.ubicacion || articulo.ubicacion || "",
        cantidadDevuelta,
        anterior,
        nueva,
        prestamo.placa,
        prestamo.mecanico,
        limpiar(req.body.motivo) || "Herramienta devuelta",
        req.session.user.id,
        articulo.codigo_taller || null,
        articulo.codigo || null,
        articulo.nombre,
        articulo.proveedor_consignacion || articulo.proveedor_nombre || null
      ]
    );
    await conn.commit();
    req.session.success = "Herramienta devuelta.";
  } catch (error) {
    await conn.rollback();
    console.error("ERROR devolver herramienta:", error);
    req.session.error = error.message || "No se pudo devolver la herramienta.";
  } finally {
    conn.release();
  }
  redirectBodega(req, res);
});

router.post("/trasladar", async (req, res) => {
  if (!requiereRol(ROLES_AJUSTE, req, res)) return;
  const conn = await pool.getConnection();
  try {
    await ensureBodegaTables();
    const articuloId = Number(req.body.articulo_id);
    const cantidad = numero(req.body.cantidad);
    await conn.beginTransaction();
    const origen = await validarSedeBodega(conn, req.body.sede_origen);
    const destino = await validarSedeBodega(conn, req.body.sede_destino);
    if (!articuloId || cantidad <= 0 || origen === destino) throw new Error("Indique artículo, cantidad positiva y dos sedes distintas.");
    const articulo = await articuloParaMovimiento(conn, articuloId);
    const salida = await aplicarCambioExistencia(conn, articulo, origen, articulo.ubicacion || "", -cantidad);
    await aplicarCambioExistencia(conn, articulo, destino, articulo.ubicacion || "", cantidad);
    await conn.query(`
      INSERT INTO bodega_movimientos (
        articulo_id, tipo_movimiento, origen_inventario, sede, ubicacion, sede_destino, ubicacion_destino,
        cantidad, existencia_anterior, existencia_nueva, precio_unitario, motivo, creado_por,
        codigo_taller_snapshot, codigo_proveedor_snapshot, descripcion_snapshot, proveedor_snapshot
      ) VALUES (?, 'TRASLADO', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [articulo.id, articulo.origen_inventario || "PROPIO", origen, articulo.ubicacion || "", destino,
      articulo.ubicacion || "", cantidad, salida.anterior, salida.nueva, Number(articulo.precio_unitario || 0),
      limpiar(req.body.motivo) || "Traslado entre sedes", req.session.user.id, articulo.codigo_taller || null,
      articulo.codigo || null, articulo.nombre, articulo.proveedor_consignacion || articulo.proveedor_nombre || null]);
    await registrarAuditoriaSistema({
      modulo: "Bodega", tabla: "bodega_existencias", registro_id: articulo.id, accion: "TRASLADO",
      resumen: `Traslado de ${cantidad} ${articulo.unidad_medida} de ${origen} a ${destino}: ${articulo.nombre}`,
      despues: { articulo_id: articulo.id, cantidad, sede_origen: origen, sede_destino: destino },
      usuario_id: req.session.user.id, usuario_nombre: req.session.user.usuario
    }, conn, { ensure: false });
    await conn.commit();
    req.session.success = "Traslado registrado y trazado en el historial.";
  } catch (error) {
    await conn.rollback();
    console.error("ERROR trasladar inventario bodega:", error);
    req.session.error = error.message || "No se pudo trasladar el inventario.";
  } finally {
    conn.release();
  }
  redirectBodega(req, res);
});

router.post("/ajustar", async (req, res) => {
  if (!puedeAjustar(req.session.user)) return res.status(403).send("No autorizado");
  const conn = await pool.getConnection();
  try {
    await ensureBodegaTables();
    const articuloId = Number(req.body.articulo_id);
    const conteo = numero(req.body.conteo_fisico);
    const motivo = limpiar(req.body.motivo);
    if (!articuloId || conteo < 0 || !motivo) {
      req.session.error = "Debe indicar artículo, conteo físico y motivo del ajuste.";
      return redirectBodega(req, res);
    }

    await conn.beginTransaction();
    const articulo = await articuloParaMovimiento(conn, articuloId);
    const sede = await validarSedeBodega(conn, req.body.sede);
    const existenciaActual = await aplicarCambioExistencia(conn, articulo, sede, articulo.ubicacion || "", 0);
    const anterior = existenciaActual.anterior;
    const saldo = await aplicarCambioExistencia(conn, articulo, sede, articulo.ubicacion || "", conteo - anterior);
    await conn.query(
      `INSERT INTO bodega_movimientos (
        articulo_id, tipo_movimiento, origen_inventario, sede, ubicacion, cantidad, existencia_anterior, existencia_nueva,
        motivo, creado_por, codigo_taller_snapshot, codigo_proveedor_snapshot, descripcion_snapshot, proveedor_snapshot
      ) VALUES (?, 'AJUSTE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [articulo.id, articulo.origen_inventario || "PROPIO", sede, articulo.ubicacion || "", conteo - anterior,
        anterior, saldo.nueva, motivo, req.session.user.id, articulo.codigo_taller || null, articulo.codigo || null,
        articulo.nombre, articulo.proveedor_consignacion || articulo.proveedor_nombre || null]
    );
    await conn.commit();
    req.session.success = "Ajuste de inventario guardado.";
  } catch (error) {
    await conn.rollback();
    console.error("ERROR ajustar bodega:", error);
    req.session.error = error.message || "No se pudo ajustar inventario.";
  } finally {
    conn.release();
  }
  redirectBodega(req, res);
});

module.exports = router;
