const express = require("express");
const router = express.Router();
const pool = require("../db");
const fs = require("fs");
const path = require("path");
const { generarPDFOrden } = require("../utils/pdfOrdenCompra");
const { agregarFiltroPlacaSql, normalizarPlaca } = require("../utils/placas");
const { normalizarTipoMantenimiento } = require("../utils/tipoMantenimiento");

const ROLES_MOTOR = ["ADMIN", "TALLER", "PROVEEDURIA_TALLER"];

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireMotor(req, res, next) {
  if (!ROLES_MOTOR.includes(req.session.user.rol)) {
    return res.status(403).send("No autorizado");
  }
  next();
}

async function columnExists(tableName, columnName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return Number(row.count) > 0;
}

async function ensureOrdenesMotorTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ordenes_motor (
      id INT AUTO_INCREMENT PRIMARY KEY,
      numero VARCHAR(30) NOT NULL UNIQUE,
      fecha DATE NOT NULL,
      proveedor_id INT NULL,
      placa_unidad VARCHAR(50) NULL,
      tipo_mantenimiento VARCHAR(20) NOT NULL DEFAULT 'CORRECTIVO',
      motor VARCHAR(100) NULL,
      forma_pago VARCHAR(100) NULL,
      moneda VARCHAR(10) NOT NULL DEFAULT 'CRC',
      subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
      descuento DECIMAL(10,2) NOT NULL DEFAULT 0,
      transporte DECIMAL(14,2) NOT NULL DEFAULT 0,
      iva DECIMAL(14,2) NOT NULL DEFAULT 0,
      total DECIMAL(14,2) NOT NULL DEFAULT 0,
      observaciones TEXT NULL,
      cotizacion_archivo VARCHAR(255) NULL,
      cotizacion_nombre VARCHAR(255) NULL,
      cotizacion_tipo VARCHAR(100) NULL,
      empresa_destino VARCHAR(80) NOT NULL DEFAULT 'GAS TOMZA',
      estado VARCHAR(40) NOT NULL DEFAULT 'BORRADOR',
      creado_por INT NULL,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_motor_fecha (fecha),
      INDEX idx_motor_estado (estado),
      INDEX idx_motor_placa (placa_unidad)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ordenes_motor_detalle (
      id INT AUTO_INCREMENT PRIMARY KEY,
      orden_motor_id INT NOT NULL,
      codigo VARCHAR(80) NULL,
      descripcion VARCHAR(255) NOT NULL,
      cantidad DECIMAL(12,2) NOT NULL DEFAULT 1,
      precio_unitario DECIMAL(14,2) NOT NULL DEFAULT 0,
      subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
      INDEX idx_motor_detalle_orden (orden_motor_id),
      CONSTRAINT fk_ordenes_motor_detalle
        FOREIGN KEY (orden_motor_id) REFERENCES ordenes_motor(id)
        ON DELETE CASCADE
    )
  `);

  const optionalColumns = [
    ["motor", "VARCHAR(100) NULL"],
    ["placa_unidad", "VARCHAR(50) NULL"],
    ["tipo_mantenimiento", "VARCHAR(20) NOT NULL DEFAULT 'CORRECTIVO'"],
    ["forma_pago", "VARCHAR(100) NULL"],
    ["descuento", "DECIMAL(10,2) NOT NULL DEFAULT 0"],
    ["transporte", "DECIMAL(14,2) NOT NULL DEFAULT 0"],
    ["cotizacion_archivo", "VARCHAR(255) NULL"],
    ["cotizacion_nombre", "VARCHAR(255) NULL"],
    ["cotizacion_tipo", "VARCHAR(100) NULL"],
    ["empresa_destino", "VARCHAR(80) NOT NULL DEFAULT 'GAS TOMZA'"],
    ["pagada", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["fecha_pago", "DATE NULL"],
    ["periodo_cierre", "CHAR(7) NULL"],
    ["monto_pagado_cierre", "DECIMAL(14,4) NULL"]
  ];

  for (const [column, definition] of optionalColumns) {
    if (!(await columnExists("ordenes_motor", column))) {
      await pool.query(`ALTER TABLE ordenes_motor ADD COLUMN ${column} ${definition}`);
    }
  }

  if (!(await columnExists("ordenes_motor_detalle", "codigo"))) {
    await pool.query("ALTER TABLE ordenes_motor_detalle ADD COLUMN codigo VARCHAR(80) NULL");
  }
}

async function generarNumeroMotor() {
  const year = new Date().getFullYear();
  const [rows] = await pool.query(
    "SELECT numero FROM ordenes_motor WHERE numero LIKE ? ORDER BY id DESC LIMIT 1",
    [`M-${year}-%`]
  );
  const ultimo = rows[0]?.numero || "";
  const consecutivo = Number(ultimo.split("-")[2] || 0) + 1;
  return `M-${year}-${String(consecutivo).padStart(3, "0")}`;
}

function normalizarLineas(lineas = []) {
  const raw = Array.isArray(lineas) ? lineas : Object.values(lineas || {});
  return raw
    .map(linea => {
      const cantidad = Number(linea.cantidad || 0);
      const precio = Number(linea.precio_unitario || 0);
      const subtotal = Number(linea.subtotal || (cantidad * precio) || 0);
      return {
        codigo: normalizarPlaca(linea.codigo) || null,
        descripcion: String(linea.descripcion || "").trim(),
        cantidad: Number.isFinite(cantidad) && cantidad > 0 ? cantidad : 1,
        precio_unitario: Number.isFinite(precio) ? precio : 0,
        subtotal: Number.isFinite(subtotal) ? subtotal : 0
      };
    })
    .filter(linea => linea.descripcion);
}

function calcularTotalesOrden(lineasOrden, valores = {}) {
  const subtotal = lineasOrden.reduce((sum, linea) => sum + Number(linea.subtotal || 0), 0);
  const descuento = Math.max(Number(valores.descuento || 0), 0);
  const transporte = Number(valores.transporte || 0);
  const iva = valores.iva === null || valores.iva === undefined || valores.iva === ""
    ? 13
    : Number(valores.iva || 0);
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

function obtenerPlacaOrden(lineasOrden, placaUnidad = null) {
  const placa = normalizarPlaca(placaUnidad);
  if (placa) return placa;
  return (lineasOrden.find(linea => linea.codigo) || {}).codigo || null;
}

function guardarCotizacionMotor(dataUrl, originalName, mimeType, usuarioId) {
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
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error("La cotización supera 5 MB.");
  }

  const uploadDir = path.join(__dirname, "..", "..", "public", "uploads", "cotizaciones");
  fs.mkdirSync(uploadDir, { recursive: true });

  const fileName = `cotizacion_motor_${Date.now()}_${usuarioId || "user"}_${Math.round(Math.random() * 1e6)}.${extension}`;
  fs.writeFileSync(path.join(uploadDir, fileName), buffer);

  return {
    archivo: `/uploads/cotizaciones/${fileName}`,
    nombre: String(originalName || `cotizacion.${extension}`).trim().slice(0, 255),
    tipo: String(mimeType || tipo).trim().slice(0, 100)
  };
}

router.get("/", requireAuth, requireMotor, async (req, res) => {
  try {
    await ensureOrdenesMotorTables();

    const { proveedor_id, fecha_desde, fecha_hasta, placa_unidad, estado } = req.query;
    const condiciones = ["1=1"];
    const params = [];

    if (proveedor_id) {
      condiciones.push("om.proveedor_id = ?");
      params.push(proveedor_id);
    }
    if (fecha_desde) {
      condiciones.push("om.fecha >= ?");
      params.push(fecha_desde);
    }
    if (fecha_hasta) {
      condiciones.push("om.fecha <= ?");
      params.push(fecha_hasta);
    }
    if (placa_unidad) {
      agregarFiltroPlacaSql(condiciones, params, "om.placa_unidad", placa_unidad);
    }
    if (estado) {
      condiciones.push("om.estado = ?");
      params.push(estado);
    }

    const [ordenes] = await pool.query(
      `SELECT om.*, p.nombre AS proveedor_nombre
       FROM ordenes_motor om
       LEFT JOIN proveedores p ON p.id = om.proveedor_id
       WHERE ${condiciones.join(" AND ")}
       ORDER BY om.fecha DESC, om.id DESC`,
      params
    );
    const [proveedores] = await pool.query("SELECT id, nombre FROM proveedores ORDER BY nombre");
    const totalFiltrado = ordenes.reduce((sum, orden) => sum + Number(orden.total || 0), 0);

    res.render("ordenes_motor", {
      user: req.session.user,
      ordenes,
      proveedores,
      estados: ["BORRADOR", "ENVIADA", "RECIBIDA_TOTAL", "ANULADA"],
      filtros: { proveedor_id, fecha_desde, fecha_hasta, placa_unidad, estado },
      totalFiltrado
    });
  } catch (error) {
    console.error("Error cargando órdenes motor:", error);
    res.status(500).send("Error cargando órdenes motor");
  }
});

router.get("/nueva", requireAuth, requireMotor, async (req, res) => {
  try {
    await ensureOrdenesMotorTables();
    const [proveedores] = await pool.query("SELECT id, nombre FROM proveedores ORDER BY nombre");
    res.render("compras/orden_form", {
      user: req.session.user,
      proveedores,
      orden: null,
      lineas: [],
      siguientePO: await generarNumeroMotor(),
      fechaActual: new Date().toISOString().slice(0, 10),
      tituloOrden: "Nueva orden motor",
      subtituloOrden: "Mismo formato de orden de compra, pero separado del gasto normal.",
      volverUrl: "/ordenes-motor",
      cancelarUrl: "/ordenes-motor",
      formAction: "/ordenes-motor",
      textoGuardar: "Guardar orden motor"
    });
  } catch (error) {
    console.error("Error cargando formulario motor:", error);
    res.status(500).send("Error cargando formulario");
  }
});

router.get("/:id/editar", requireAuth, requireMotor, async (req, res) => {
  try {
    await ensureOrdenesMotorTables();
    const [[orden]] = await pool.query("SELECT * FROM ordenes_motor WHERE id = ?", [req.params.id]);
    if (!orden) return res.status(404).send("Orden motor no encontrada");

    const [proveedores] = await pool.query("SELECT id, nombre FROM proveedores ORDER BY nombre");
    const [lineas] = await pool.query("SELECT * FROM ordenes_motor_detalle WHERE orden_motor_id = ? ORDER BY id", [req.params.id]);
    orden.po_numero = orden.numero;

    res.render("compras/orden_form", {
      user: req.session.user,
      proveedores,
      orden,
      lineas,
      siguientePO: orden.numero,
      fechaActual: orden.fecha,
      tituloOrden: "Editar orden motor",
      subtituloOrden: "Mismo formato de orden de compra, pero separado del gasto normal.",
      volverUrl: "/ordenes-motor",
      cancelarUrl: "/ordenes-motor",
      formAction: `/ordenes-motor/${orden.id}/editar`,
      textoGuardar: "Actualizar orden motor"
    });
  } catch (error) {
    console.error("Error cargando edición motor:", error);
    res.status(500).send("Error cargando orden");
  }
});

router.post("/", requireAuth, requireMotor, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await ensureOrdenesMotorTables();
    await connection.beginTransaction();

    const lineas = normalizarLineas(req.body.lineas);
    if (!lineas.length) {
      await connection.rollback();
      return res.status(400).send("Debe agregar al menos una línea");
    }

    const totalesOrden = calcularTotalesOrden(lineas, req.body);
    const numero = await generarNumeroMotor();
    const placaOrden = obtenerPlacaOrden(lineas, req.body.placa_unidad);
    const tipoMantenimiento = normalizarTipoMantenimiento(req.body.tipo_mantenimiento);
    const cotizacion = guardarCotizacionMotor(req.body.cotizacion_data, req.body.cotizacion_nombre, req.body.cotizacion_tipo, req.session.user.id);

    const [result] = await connection.query(
      `INSERT INTO ordenes_motor
       (numero, fecha, proveedor_id, placa_unidad, tipo_mantenimiento, motor, forma_pago, moneda, subtotal, descuento, transporte, iva, total, observaciones,
        cotizacion_archivo, cotizacion_nombre, cotizacion_tipo, empresa_destino, estado, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'BORRADOR', ?)`,
      [
        numero,
        new Date().toISOString().slice(0, 10),
        req.body.proveedor_id || null,
        placaOrden,
        tipoMantenimiento,
        String(req.body.motor || "").trim() || null,
        req.body.forma_pago || null,
        req.body.moneda || "CRC",
        totalesOrden.subtotal,
        totalesOrden.descuento,
        totalesOrden.transporte,
        totalesOrden.iva,
        totalesOrden.total,
        req.body.observaciones || null,
        cotizacion ? cotizacion.archivo : null,
        cotizacion ? cotizacion.nombre : null,
        cotizacion ? cotizacion.tipo : null,
        req.body.empresa_destino || "GAS TOMZA",
        req.session.user.id || null
      ]
    );

    for (const linea of lineas) {
      await connection.query(
        `INSERT INTO ordenes_motor_detalle
         (orden_motor_id, codigo, descripcion, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [result.insertId, linea.codigo, linea.descripcion, linea.cantidad, linea.precio_unitario, linea.subtotal]
      );
    }

    await connection.commit();
    res.redirect("/ordenes-motor");
  } catch (error) {
    await connection.rollback();
    console.error("Error guardando orden motor:", error);
    res.status(500).send("Error guardando orden motor");
  } finally {
    connection.release();
  }
});

router.post("/:id/editar", requireAuth, requireMotor, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await ensureOrdenesMotorTables();
    await connection.beginTransaction();

    const lineas = normalizarLineas(req.body.lineas);
    if (!lineas.length) {
      await connection.rollback();
      return res.status(400).send("Debe agregar al menos una línea");
    }

    const totalesOrden = calcularTotalesOrden(lineas, req.body);
    const placaOrden = obtenerPlacaOrden(lineas, req.body.placa_unidad);
    const tipoMantenimiento = normalizarTipoMantenimiento(req.body.tipo_mantenimiento);
    const cotizacion = guardarCotizacionMotor(req.body.cotizacion_data, req.body.cotizacion_nombre, req.body.cotizacion_tipo, req.session.user.id);

    let updateSql = `UPDATE ordenes_motor
       SET proveedor_id = ?, placa_unidad = ?, tipo_mantenimiento = ?, motor = ?, forma_pago = ?, moneda = ?,
           subtotal = ?, descuento = ?, transporte = ?, iva = ?, total = ?,
           observaciones = ?, empresa_destino = ?
    `;
    const updateParams = [
      req.body.proveedor_id || null,
      placaOrden,
      tipoMantenimiento,
      String(req.body.motor || "").trim() || null,
      req.body.forma_pago || null,
      req.body.moneda || "CRC",
      totalesOrden.subtotal,
      totalesOrden.descuento,
      totalesOrden.transporte,
      totalesOrden.iva,
      totalesOrden.total,
      req.body.observaciones || null,
      req.body.empresa_destino || "GAS TOMZA"
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
    updateParams.push(req.params.id);
    await connection.query(updateSql, updateParams);

    await connection.query("DELETE FROM ordenes_motor_detalle WHERE orden_motor_id = ?", [req.params.id]);
    for (const linea of lineas) {
      await connection.query(
        `INSERT INTO ordenes_motor_detalle
         (orden_motor_id, codigo, descripcion, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [req.params.id, linea.codigo, linea.descripcion, linea.cantidad, linea.precio_unitario, linea.subtotal]
      );
    }

    await connection.commit();
    res.redirect(`/ordenes-motor/${req.params.id}`);
  } catch (error) {
    await connection.rollback();
    console.error("Error editando orden motor:", error);
    res.status(500).send("Error editando orden motor");
  } finally {
    connection.release();
  }
});

router.post("/:id/estado", requireAuth, requireMotor, async (req, res) => {
  try {
    await ensureOrdenesMotorTables();
    const estado = String(req.body.estado || "").trim().toUpperCase();
    const fechaPago = new Date().toISOString().slice(0, 10);
    const periodoCierre = fechaPago.slice(0, 7);

    if (["RECIBIDA_TOTAL", "PAGADA", "PAGADO", "CERRADA", "CERRADO"].includes(estado)) {
      await pool.query(
        `UPDATE ordenes_motor
         SET estado = ?,
             pagada = 1,
             fecha_pago = COALESCE(fecha_pago, ?),
             periodo_cierre = COALESCE(periodo_cierre, ?),
             monto_pagado_cierre = COALESCE(monto_pagado_cierre, total)
         WHERE id = ?`,
        [estado, fechaPago, periodoCierre, req.params.id]
      );
    } else {
      await pool.query(
        `UPDATE ordenes_motor
         SET estado = ?,
             pagada = 0,
             fecha_pago = NULL,
             periodo_cierre = NULL,
             monto_pagado_cierre = NULL
         WHERE id = ?`,
        [estado, req.params.id]
      );
    }
    res.redirect("/ordenes-motor");
  } catch (error) {
    console.error("Error actualizando estado motor:", error);
    res.status(500).send("Error actualizando estado");
  }
});

router.post("/:id/eliminar", requireAuth, requireMotor, async (req, res) => {
  try {
    await ensureOrdenesMotorTables();
    await pool.query("DELETE FROM ordenes_motor WHERE id = ?", [req.params.id]);
    res.redirect("/ordenes-motor");
  } catch (error) {
    console.error("Error eliminando orden motor:", error);
    res.status(500).send("Error eliminando orden");
  }
});

router.get("/:id/pdf", requireAuth, requireMotor, async (req, res) => {
  try {
    await ensureOrdenesMotorTables();
    const [[orden]] = await pool.query(
      `SELECT om.*, p.nombre AS proveedor_nombre, p.cedula_juridica, p.telefono, p.email
       FROM ordenes_motor om
       LEFT JOIN proveedores p ON p.id = om.proveedor_id
       WHERE om.id = ?`,
      [req.params.id]
    );
    if (!orden) return res.status(404).send("Orden motor no encontrada");

    orden.po_numero = orden.numero;
    const proveedor = {
      nombre: orden.proveedor_nombre || "Sin proveedor",
      cedula: orden.cedula_juridica,
      telefono: orden.telefono,
      email: orden.email
    };
    const [lineas] = await pool.query("SELECT * FROM ordenes_motor_detalle WHERE orden_motor_id = ? ORDER BY id", [req.params.id]);
    const pdfBuffer = await generarPDFOrden(orden, proveedor, lineas);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=orden_motor_${orden.numero}.pdf`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Error generando PDF de orden motor:", error);
    res.status(500).send("Error generando PDF de orden motor");
  }
});

router.get("/:id", requireAuth, requireMotor, async (req, res) => {
  try {
    await ensureOrdenesMotorTables();
    const [[orden]] = await pool.query(
      `SELECT om.*, p.nombre AS proveedor_nombre
       FROM ordenes_motor om
       LEFT JOIN proveedores p ON p.id = om.proveedor_id
       WHERE om.id = ?`,
      [req.params.id]
    );
    if (!orden) return res.status(404).send("Orden motor no encontrada");

    orden.po_numero = orden.numero;
    const proveedor = { nombre: orden.proveedor_nombre || "—" };
    const [lineas] = await pool.query("SELECT * FROM ordenes_motor_detalle WHERE orden_motor_id = ? ORDER BY id", [req.params.id]);
    res.render("compras/orden_detalle", {
      user: req.session.user,
      orden,
      proveedor,
      lineas,
      tituloDetalle: "Detalle de Orden Motor",
      volverUrl: "/ordenes-motor",
      editarUrl: `/ordenes-motor/${orden.id}/editar`,
      permitePdf: true,
      pdfUrl: `/ordenes-motor/${orden.id}/pdf`
    });
  } catch (error) {
    console.error("Error cargando detalle motor:", error);
    res.status(500).send("Error cargando detalle");
  }
});

module.exports = router;
