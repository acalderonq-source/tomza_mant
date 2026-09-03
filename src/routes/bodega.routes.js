const express = require("express");
const router = express.Router();
const pool = require("../db");
const { normalizarPlaca } = require("../utils/placas");

const ROLES_BODEGA = ["ADMIN", "TALLER", "PROVEEDURIA_TALLER", "BODEGA", "BODEGUERO"];
const ROLES_AJUSTE = ["ADMIN", "TALLER"];
const TIPOS_ARTICULO = ["REPUESTO", "CONSUMIBLE", "HERRAMIENTA", "OTRO"];
const TIPOS_TRABAJO = ["MANTENIMIENTO", "CORRECTIVO", "REPARACION", "EMERGENCIA", "OTRO"];
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

async function ensureBodegaTables() {
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

function redirectBodega(req, res) {
  const q = limpiar(req.body.q || req.query.q);
  const pagina = limpiar(req.body.redirect_to || req.query.redirect_to);
  const paginas = new Set(["entregas", "suministros", "consignacion", "inventario", "herramientas", "movimientos"]);
  const base = paginas.has(pagina) ? `/bodega/${pagina}` : "/bodega";
  res.redirect(`${base}${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}

router.use(requireAuth, requireBodega);

async function renderBodega(req, res, pagina = "inicio") {
  try {
    await ensureBodegaTables();
    const q = limpiar(req.query.q);
    const origen = origenInventario(req.query.origen, "");
    const condiciones = ["activo = 1"];
    const params = [];

    if (origen) {
      condiciones.push("origen_inventario = ?");
      params.push(origen);
    }

    if (q) {
      condiciones.push(`(
        nombre LIKE ? OR codigo LIKE ? OR codigo_taller LIKE ? OR numero_parte LIKE ? OR categoria LIKE ? OR marca LIKE ? OR tipo_unidad LIKE ? OR ubicacion LIKE ? OR proveedor_consignacion LIKE ?
      )`);
      const like = `%${q}%`;
      params.push(like, like, like, like, like, like, like, like, like);
    }

    const [articulos] = await pool.query(
      `SELECT *
       FROM bodega_articulos
       WHERE ${condiciones.join(" AND ")}
       ORDER BY
        CASE
          WHEN stock_actual <= 0 THEN 0
          WHEN stock_minimo > 0 AND stock_actual <= stock_minimo THEN 1
          ELSE 2
        END,
        nombre ASC
       LIMIT 300`,
      params
    );

    const [[stats]] = await pool.query(`
      SELECT
        COUNT(*) AS articulos,
        SUM(CASE WHEN activo = 1 AND stock_minimo > 0 AND stock_actual > 0 AND stock_actual <= stock_minimo THEN 1 ELSE 0 END) AS stock_bajo,
        SUM(CASE WHEN activo = 1 AND stock_actual <= 0 THEN 1 ELSE 0 END) AS agotados,
        SUM(CASE WHEN activo = 1 AND origen_inventario = 'PROPIO' THEN 1 ELSE 0 END) AS propios,
        SUM(CASE WHEN activo = 1 AND origen_inventario = 'CONSIGNACION' THEN 1 ELSE 0 END) AS consignacion,
        SUM(CASE WHEN activo = 1 AND grupo_bodega = 'SUMINISTRO' THEN 1 ELSE 0 END) AS suministros
      FROM bodega_articulos
    `);

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
        AND stock_minimo > 0
        AND stock_actual <= stock_minimo
      ORDER BY stock_actual ASC, nombre ASC
      LIMIT 80
    `);

    const [suministros] = await pool.query(`
      SELECT *
      FROM bodega_articulos
      WHERE activo = 1
        AND grupo_bodega = 'SUMINISTRO'
      ORDER BY
        CASE
          WHEN stock_actual <= 0 THEN 0
          WHEN stock_minimo > 0 AND stock_actual <= stock_minimo THEN 1
          ELSE 2
        END,
        nombre ASC
      LIMIT 150
    `);

    const [movimientos] = await pool.query(`
      SELECT bm.*, ba.nombre AS articulo_nombre, ba.codigo, ba.codigo_taller, ba.unidad_medida, u.usuario AS usuario_nombre
      FROM bodega_movimientos bm
      JOIN bodega_articulos ba ON ba.id = bm.articulo_id
      LEFT JOIN usuarios u ON u.id = bm.creado_por
      ORDER BY bm.creado_en DESC, bm.id DESC
      LIMIT 80
    `);

    const [prestamos] = await pool.query(`
      SELECT bh.*, ba.nombre AS articulo_nombre, ba.codigo, ba.codigo_taller, ba.ubicacion
      FROM bodega_prestamos_herramientas bh
      JOIN bodega_articulos ba ON ba.id = bh.articulo_id
      WHERE bh.estado = 'PRESTADO'
      ORDER BY bh.salida_en ASC, bh.id ASC
      LIMIT 80
    `);

    const [proveedores] = await pool.query("SELECT id, nombre FROM proveedores ORDER BY nombre ASC LIMIT 500");
    const proximoCodigoTaller = await siguienteCodigoTaller();

    res.render("bodega", {
      user: req.session.user,
      q,
      origen,
      articulos,
      proveedores,
      porComprar,
      suministros,
      movimientos,
      prestamos,
      stats: {
        articulos: Number(stats.articulos || 0),
        stock_bajo: Number(stats.stock_bajo || 0),
        agotados: Number(stats.agotados || 0),
        propios: Number(stats.propios || 0),
        consignacion: Number(stats.consignacion || 0),
        suministros: Number(stats.suministros || 0),
        herramientas_prestadas: Number(prestadasRow.total || 0),
        movimientos_hoy: Number(movHoy.total || 0)
      },
      tiposArticulo: TIPOS_ARTICULO,
      tiposTrabajo: TIPOS_TRABAJO,
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
router.get("/suministros", (req, res) => renderBodega(req, res, "suministros"));
router.get("/consignacion", (req, res) => renderBodega(req, res, "consignacion"));
router.get("/inventario", (req, res) => renderBodega(req, res, "inventario"));
router.get("/herramientas", (req, res) => renderBodega(req, res, "herramientas"));
router.get("/movimientos", (req, res) => renderBodega(req, res, "movimientos"));

router.post("/articulos", async (req, res) => {
  try {
    await ensureBodegaTables();
    const proveedor = await obtenerProveedor(req.body.proveedor_id, req.body.proveedor_nombre);
    const tipo = TIPOS_ARTICULO.includes(upper(req.body.tipo_articulo)) ? upper(req.body.tipo_articulo) : "REPUESTO";
    const origen = origenInventario(req.body.origen_inventario);
    const grupo = upper(req.body.grupo_bodega) === "SUMINISTRO" ? "SUMINISTRO" : "INVENTARIO";
    const codigoInterno = codigoTaller(req.body.codigo_taller) || await siguienteCodigoTaller();
    const codigo = limpiar(req.body.codigo) || null;
    const nombre = limpiar(req.body.nombre);
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
        numero(req.body.stock_actual),
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
    req.session.error = error.code === "ER_DUP_ENTRY" ? "Ya existe un artículo con ese código." : "No se pudo crear el artículo.";
  }
  redirectBodega(req, res);
});

router.post("/suministros", async (req, res) => {
  try {
    await ensureBodegaTables();
    const proveedor = await obtenerProveedor(req.body.proveedor_id, req.body.proveedor_nombre);
    const codigoInterno = codigoTaller(req.body.codigo_taller) || await siguienteCodigoTaller();
    const nombre = limpiar(req.body.nombre);
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
        numero(req.body.stock_actual),
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
    req.session.error = error.code === "ER_DUP_ENTRY" ? "Ya existe un artículo con ese código." : "No se pudo agregar el suministro.";
  }
  res.redirect("/bodega/suministros");
});

router.post("/entregar", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureBodegaTables();
    const placa = normalizarPlaca(req.body.placa) || upper(req.body.placa);
    const mecanico = limpiar(req.body.mecanico);
    const tipoTrabajo = TIPOS_TRABAJO.includes(upper(req.body.tipo_trabajo)) ? upper(req.body.tipo_trabajo) : "MANTENIMIENTO";
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

    if (!placa || !mecanico || !lineas.length) {
      req.session.error = "Debe indicar placa, mecánico y al menos un artículo.";
      return redirectBodega(req, res);
    }

    await conn.beginTransaction();
    const [entregaResult] = await conn.query(
      "INSERT INTO bodega_entregas (placa, mecanico, tipo_trabajo, observacion, creado_por) VALUES (?, ?, ?, ?, ?)",
      [placa, mecanico, tipoTrabajo, limpiar(req.body.observacion) || null, req.session.user.id]
    );
    const entregaId = entregaResult.insertId;

    for (const linea of lineas) {
      const articulo = await articuloParaMovimiento(conn, linea.id);
      const anterior = Number(articulo.stock_actual || 0);
      if (anterior < linea.cantidad) {
        throw new Error(`${articulo.nombre} no tiene suficiente existencia.`);
      }
      const nueva = anterior - linea.cantidad;
      await conn.query("UPDATE bodega_articulos SET stock_actual = ? WHERE id = ?", [nueva, articulo.id]);
      const origenSalida = linea.origen_salida || articulo.origen_inventario || "PROPIO";

      let prestamoId = null;
      const tipoMovimiento = articulo.tipo_articulo === "HERRAMIENTA" ? "PRESTAMO" : "SALIDA";
      if (articulo.tipo_articulo === "HERRAMIENTA") {
        const [prestamoResult] = await conn.query(
          `INSERT INTO bodega_prestamos_herramientas
            (articulo_id, mecanico, placa, cantidad, observacion, creado_por)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [articulo.id, mecanico, placa, linea.cantidad, limpiar(req.body.observacion) || null, req.session.user.id]
        );
        prestamoId = prestamoResult.insertId;
      }

      await conn.query(
        `INSERT INTO bodega_movimientos (
          articulo_id, entrega_id, prestamo_id, tipo_movimiento, origen_inventario, cantidad, existencia_anterior, existencia_nueva,
          placa, mecanico, tipo_trabajo, precio_unitario, motivo, creado_por
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          articulo.id,
          entregaId,
          prestamoId,
          tipoMovimiento,
          origenSalida,
          linea.cantidad,
          anterior,
          nueva,
          placa,
          mecanico,
          tipoTrabajo,
          Number(articulo.precio_unitario || 0),
          limpiar(req.body.observacion) || null,
          req.session.user.id
        ]
      );
    }

    await conn.commit();
    req.session.success = "Entrega registrada y stock actualizado.";
  } catch (error) {
    await conn.rollback();
    console.error("ERROR entregar bodega:", error);
    req.session.error = error.message || "No se pudo registrar la entrega.";
  } finally {
    conn.release();
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
    const articulo = await articuloParaMovimiento(conn, articuloId);
    const anterior = Number(articulo.stock_actual || 0);
    const nueva = anterior + cantidad;
    const precio = numero(req.body.precio_unitario) || Number(articulo.precio_unitario || 0);

    await conn.query(
      `UPDATE bodega_articulos
       SET stock_actual = ?, precio_unitario = ?, proveedor_id = ?, proveedor_nombre = ?, proveedor_consignacion = ?, origen_inventario = ?, fecha_ultima_compra = ?
       WHERE id = ?`,
      [
        nueva,
        precio,
        proveedor.id,
        proveedor.nombre,
        origen === "CONSIGNACION" ? (proveedor.nombre || articulo.proveedor_consignacion || PROVEEDOR_CONSIGNACION_DEFAULT) : articulo.proveedor_consignacion,
        origen,
        req.body.fecha || fechaCostaRica(),
        articulo.id
      ]
    );

    await conn.query(
      `INSERT INTO bodega_movimientos (
        articulo_id, tipo_movimiento, origen_inventario, cantidad, existencia_anterior, existencia_nueva,
        proveedor_id, proveedor_nombre, numero_factura, orden_compra_id, precio_unitario, motivo, creado_por
      ) VALUES (?, 'ENTRADA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        articulo.id,
        origen,
        cantidad,
        anterior,
        nueva,
        proveedor.id,
        proveedor.nombre,
        limpiar(req.body.numero_factura) || null,
        Number(req.body.orden_compra_id) || null,
        precio,
        limpiar(req.body.motivo) || "Entrada de mercadería",
        req.session.user.id
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
    const articuloId = Number(req.body.articulo_id);
    const cantidad = numero(req.body.cantidad);
    if (!articuloId || cantidad <= 0) {
      req.session.error = "Debe seleccionar un artículo y la cantidad a devolver.";
      return redirectBodega(req, res);
    }

    await conn.beginTransaction();
    const articulo = await articuloParaMovimiento(conn, articuloId);
    const anterior = Number(articulo.stock_actual || 0);
    const nueva = anterior + cantidad;
    await conn.query("UPDATE bodega_articulos SET stock_actual = ? WHERE id = ?", [nueva, articulo.id]);
    await conn.query(
      `INSERT INTO bodega_movimientos (
        articulo_id, tipo_movimiento, origen_inventario, cantidad, existencia_anterior, existencia_nueva,
        placa, mecanico, motivo, creado_por
      ) VALUES (?, 'DEVOLUCION', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        articulo.id,
        articulo.origen_inventario || "PROPIO",
        cantidad,
        anterior,
        nueva,
        normalizarPlaca(req.body.placa) || upper(req.body.placa) || null,
        limpiar(req.body.mecanico) || null,
        limpiar(req.body.motivo) || "Devolución",
        req.session.user.id
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
    const anterior = Number(articulo.stock_actual || 0);
    const nueva = anterior + Number(prestamo.cantidad || 0);

    await conn.query("UPDATE bodega_articulos SET stock_actual = ? WHERE id = ?", [nueva, articulo.id]);
    await conn.query(
      `UPDATE bodega_prestamos_herramientas
       SET estado = 'DEVUELTO', devolucion_en = CURRENT_TIMESTAMP, recibido_por = ?, actualizado_por = ?
       WHERE id = ?`,
      [limpiar(req.body.recibido_por) || req.session.user.usuario, req.session.user.id, prestamo.id]
    );
    await conn.query(
      `INSERT INTO bodega_movimientos (
        articulo_id, prestamo_id, tipo_movimiento, origen_inventario, cantidad, existencia_anterior, existencia_nueva,
        placa, mecanico, motivo, creado_por
      ) VALUES (?, ?, 'DEVOLUCION_HERRAMIENTA', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        articulo.id,
        prestamo.id,
        articulo.origen_inventario || "PROPIO",
        Number(prestamo.cantidad || 0),
        anterior,
        nueva,
        prestamo.placa,
        prestamo.mecanico,
        limpiar(req.body.motivo) || "Herramienta devuelta",
        req.session.user.id
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
    const anterior = Number(articulo.stock_actual || 0);
    await conn.query("UPDATE bodega_articulos SET stock_actual = ? WHERE id = ?", [conteo, articulo.id]);
    await conn.query(
      `INSERT INTO bodega_movimientos (
        articulo_id, tipo_movimiento, origen_inventario, cantidad, existencia_anterior, existencia_nueva, motivo, creado_por
      ) VALUES (?, 'AJUSTE', ?, ?, ?, ?, ?, ?)`,
      [articulo.id, articulo.origen_inventario || "PROPIO", conteo - anterior, anterior, conteo, motivo, req.session.user.id]
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
