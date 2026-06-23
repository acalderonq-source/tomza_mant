const express = require("express");
const router = express.Router();
const pool = require("../db");
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
    .map(linea => ({
      codigo: linea.codigo || null,
      descripcion: String(linea.descripcion || "").trim(),
      cantidad: linea.cantidad || 0,
      precio_unitario: linea.precio_unitario || 0,
      subtotal: linea.subtotal || 0
    }))
    .filter(linea => linea.descripcion);
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

// ===================== PROVEEDORES =====================
router.get("/proveedores", requireAuth, allowRoles("ADMIN", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
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
router.get("/ordenes/nueva", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
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

router.get("/ordenes/:id/editar", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
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

router.post("/ordenes", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const po_numero = await generarNumeroPO();
    const fecha = new Date().toISOString().slice(0, 10);

    const { proveedor_id, forma_pago, moneda, lineas, subtotal, descuento, transporte, iva, total, observaciones, empresa_destino } = req.body;
    const lineasOrden = normalizarLineas(lineas);

    if (!lineasOrden.length) {
      await connection.rollback();
      return res.status(400).send("Debe agregar al menos una línea a la orden");
    }

    const [result] = await connection.query(
      `INSERT INTO ordenes_compra 
       (po_numero, fecha, proveedor_id, forma_pago, moneda, subtotal, descuento, transporte, iva, total, observaciones, creado_por, estado, empresa_destino) 
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'BORRADOR', ?)`,
      [po_numero, fecha, proveedor_id, forma_pago, moneda, subtotal, descuento, transporte, iva, total, observaciones || null, req.session.user.id, empresa_destino || 'GAS TOMZA']
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

router.post("/ordenes/:id/editar", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const id = req.params.id;
    const { proveedor_id, forma_pago, moneda, lineas, subtotal, descuento, transporte, iva, total, observaciones, empresa_destino } = req.body;
    const lineasOrden = normalizarLineas(lineas);

    if (!lineasOrden.length) {
      await connection.rollback();
      return res.status(400).send("Debe agregar al menos una línea a la orden");
    }

    const [[orden]] = await connection.query("SELECT id FROM ordenes_compra WHERE id = ?", [id]);
    if (!orden) {
      await connection.rollback();
      return res.status(404).send("Orden no encontrada");
    }

    await connection.query(
      `UPDATE ordenes_compra
       SET proveedor_id = ?,
           forma_pago = ?,
           moneda = ?,
           subtotal = ?,
           descuento = ?,
           transporte = ?,
           iva = ?,
           total = ?,
           observaciones = ?,
           empresa_destino = ?
       WHERE id = ?`,
      [proveedor_id, forma_pago, moneda, subtotal, descuento, transporte, iva, total, observaciones || null, empresa_destino || 'GAS TOMZA', id]
    );

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

router.get("/ordenes", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    const { proveedor_id, fecha_desde, fecha_hasta, po_numero, estado, facturada } = req.query;

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
    if (estado && estado !== '') {
      sql += ` AND o.estado = ?`;
      params.push(estado);
    }
    if (facturada !== undefined && facturada !== '') {
      sql += ` AND o.facturada = ?`;
      params.push(facturada === '1' ? 1 : 0);
    }

    sql += ` ORDER BY o.fecha DESC, o.id DESC`;

    const [ordenes] = await pool.query(sql, params);
    const [proveedores] = await pool.query("SELECT id, nombre FROM proveedores ORDER BY nombre");
    const estados = ['BORRADOR', 'ENVIADA', 'RECIBIDA_PARCIAL', 'RECIBIDA_TOTAL'];

    let totalFiltrado = 0;
    ordenes.forEach(o => totalFiltrado += parseFloat(o.total) || 0);

    res.render("compras/ordenes", {
      ordenes,
      user: req.session.user,
      proveedores,
      estados,
      filtros: { proveedor_id, fecha_desde, fecha_hasta, po_numero, estado, facturada },
      totalFiltrado
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error");
  }
});

router.get("/ordenes/:id/detalle", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
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

router.post("/ordenes/:id/recibir", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    const id = req.params.id;
    const { proveedor_id, fecha_desde, fecha_hasta, po_numero, estado, facturada } = req.body;
    await pool.query("UPDATE ordenes_compra SET estado = 'RECIBIDA_TOTAL' WHERE id = ?", [id]);
    const queryParams = [];
    if (proveedor_id) queryParams.push(`proveedor_id=${encodeURIComponent(proveedor_id)}`);
    if (fecha_desde) queryParams.push(`fecha_desde=${encodeURIComponent(fecha_desde)}`);
    if (fecha_hasta) queryParams.push(`fecha_hasta=${encodeURIComponent(fecha_hasta)}`);
    if (po_numero) queryParams.push(`po_numero=${encodeURIComponent(po_numero)}`);
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
    const { proveedor_id, fecha_desde, fecha_hasta, po_numero, estado, facturada } = req.body;
    const [[orden]] = await pool.query("SELECT * FROM ordenes_compra WHERE id = ?", [id]);
    if (!orden) return res.status(404).send("Orden no encontrada");
    await pool.query("DELETE FROM ordenes_compra_detalle WHERE orden_compra_id = ?", [id]);
    await pool.query("DELETE FROM ordenes_compra WHERE id = ?", [id]);
    const queryParams = [];
    if (proveedor_id) queryParams.push(`proveedor_id=${encodeURIComponent(proveedor_id)}`);
    if (fecha_desde) queryParams.push(`fecha_desde=${encodeURIComponent(fecha_desde)}`);
    if (fecha_hasta) queryParams.push(`fecha_hasta=${encodeURIComponent(fecha_hasta)}`);
    if (po_numero) queryParams.push(`po_numero=${encodeURIComponent(po_numero)}`);
    if (estado) queryParams.push(`estado=${encodeURIComponent(estado)}`);
    if (facturada !== undefined && facturada !== '') queryParams.push(`facturada=${encodeURIComponent(facturada)}`);
    const redirectUrl = "/compras/ordenes" + (queryParams.length ? "?" + queryParams.join("&") : "");
    res.redirect(redirectUrl);
  } catch (error) {
    console.error("❌ Error al eliminar orden:", error);
    res.status(500).send("Error al eliminar la orden");
  }
});

router.post("/ordenes/:id/factura", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    const id = req.params.id;
    const { factura, proveedor_id, fecha_desde, fecha_hasta, po_numero, estado, facturada } = req.body;
    const [[orden]] = await pool.query("SELECT fecha FROM ordenes_compra WHERE id = ?", [id]);
    if (!orden) return res.status(404).send("Orden no encontrada");
    const fechaVencimiento = new Date(orden.fecha);
    fechaVencimiento.setDate(fechaVencimiento.getDate() + 30);
    const fechaVencimientoStr = fechaVencimiento.toISOString().slice(0, 10);
    await pool.query(
      "UPDATE ordenes_compra SET factura = ?, facturada = 1, fecha_vencimiento_factura = ?, pagada = 0 WHERE id = ?",
      [factura || null, fechaVencimientoStr, id]
    );
    const queryParams = [];
    if (proveedor_id) queryParams.push(`proveedor_id=${encodeURIComponent(proveedor_id)}`);
    if (fecha_desde) queryParams.push(`fecha_desde=${encodeURIComponent(fecha_desde)}`);
    if (fecha_hasta) queryParams.push(`fecha_hasta=${encodeURIComponent(fecha_hasta)}`);
    if (po_numero) queryParams.push(`po_numero=${encodeURIComponent(po_numero)}`);
    if (estado) queryParams.push(`estado=${encodeURIComponent(estado)}`);
    if (facturada !== undefined && facturada !== '') queryParams.push(`facturada=${encodeURIComponent(facturada)}`);
    const redirectUrl = "/compras/ordenes" + (queryParams.length ? "?" + queryParams.join("&") : "");
    res.redirect(redirectUrl);
  } catch (error) {
    console.error("❌ Error al registrar factura:", error);
    res.status(500).send("Error al registrar factura");
  }
});

router.post("/facturas/agregar", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    const { po_numero, factura, fecha_factura, monto, proveedor_id } = req.body;
    if (!factura || !fecha_factura) {
      req.session.error = "Debe completar número de factura y fecha.";
      return res.redirect("/compras/facturas");
    }
    if (po_numero && po_numero.trim() !== '') {
      const [[orden]] = await pool.query(
        "SELECT id, fecha, facturada FROM ordenes_compra WHERE po_numero = ?",
        [po_numero]
      );
      if (orden && !orden.facturada) {
        const fechaVencimiento = new Date(orden.fecha);
        fechaVencimiento.setDate(fechaVencimiento.getDate() + 30);
        const fechaVencimientoStr = fechaVencimiento.toISOString().slice(0, 10);
        await pool.query(
          `UPDATE ordenes_compra 
           SET factura = ?, facturada = 1, fecha_vencimiento_factura = ?, pagada = 0 
           WHERE id = ?`,
          [factura, fechaVencimientoStr, orden.id]
        );
        req.session.success = `Factura ${factura} asociada a la orden ${po_numero}.`;
        return res.redirect("/compras/facturas");
      } else if (orden && orden.facturada) {
        req.session.error = `La orden ${po_numero} ya está facturada.`;
        return res.redirect("/compras/facturas");
      }
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
    await pool.query(
      `INSERT INTO facturas (numero_factura, fecha, monto, proveedor_id, proveedor_nombre, pagada, creado_por)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [factura, fecha_factura, monto || 0, proveedor_id, proveedor.nombre, req.session.user.id]
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
    const { proveedor_id, fecha_desde, fecha_hasta, pagada, vencida } = req.query;
    const orden = req.query.orden === 'asc' ? 'asc' : 'desc';

    let sqlOrdenes = `
      SELECT 
        o.id, 
        o.po_numero, 
        o.fecha, 
        o.total as monto, 
        o.factura as numero_factura, 
        o.fecha_vencimiento_factura, 
        o.pagada, 
        o.fecha_pago,
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
        f.proveedor_nombre,
        'independiente' as tipo
      FROM facturas f
      WHERE 1=1
    `;
    const paramsOrdenes = [];
    const paramsIndependientes = [];

    if (proveedor_id && proveedor_id !== '') {
      sqlOrdenes += ` AND o.proveedor_id = ?`;
      sqlIndependientes += ` AND f.proveedor_id = ?`;
      paramsOrdenes.push(proveedor_id);
      paramsIndependientes.push(proveedor_id);
    }
    if (fecha_desde && fecha_desde !== '') {
      sqlOrdenes += ` AND o.fecha >= ?`;
      sqlIndependientes += ` AND f.fecha >= ?`;
      paramsOrdenes.push(fecha_desde);
      paramsIndependientes.push(fecha_desde);
    }
    if (fecha_hasta && fecha_hasta !== '') {
      sqlOrdenes += ` AND o.fecha <= ?`;
      sqlIndependientes += ` AND f.fecha <= ?`;
      paramsOrdenes.push(fecha_hasta);
      paramsIndependientes.push(fecha_hasta);
    }
    if (pagada !== undefined && pagada !== '') {
      const pagadaVal = pagada === '1' ? 1 : 0;
      sqlOrdenes += ` AND COALESCE(o.pagada, 0) = ?`;
      sqlIndependientes += ` AND COALESCE(f.pagada, 0) = ?`;
      paramsOrdenes.push(pagadaVal);
      paramsIndependientes.push(pagadaVal);
    }

    const orderDirection = orden === 'asc' ? 'ASC' : 'DESC';
    const finalSql = `(${sqlOrdenes}) UNION ALL (${sqlIndependientes}) ORDER BY fecha ${orderDirection}, id ${orderDirection}`;
    const params = [...paramsOrdenes, ...paramsIndependientes];
    const [facturasUnidas] = await pool.query(finalSql, params);

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const facturasConEstado = facturasUnidas.map(f => ({
      ...f,
      vencida: (f.tipo === 'orden' && !f.pagada && f.fecha_vencimiento_factura && new Date(f.fecha_vencimiento_factura) < hoy)
    }));

    let facturasFiltradas = facturasConEstado;
    if (vencida === '1') {
      facturasFiltradas = facturasConEstado.filter(f => f.vencida);
    }

    const [proveedores] = await pool.query("SELECT id, nombre FROM proveedores ORDER BY nombre");
    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("compras/facturas", {
      facturas: facturasFiltradas,
      user: req.session.user,
      proveedores,
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

router.post("/facturas/:id/pagar", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
    const id = req.params.id;
    const { tipo } = req.body;
    const fechaPago = new Date().toISOString().slice(0, 10);

    if (tipo === 'orden') {
      const [result] = await pool.query(
        "UPDATE ordenes_compra SET pagada = 1, fecha_pago = ? WHERE id = ? AND facturada = 1 AND COALESCE(pagada, 0) = 0",
        [fechaPago, id]
      );
      if (!result.affectedRows) {
        req.session.error = "La factura de orden no existe o ya estaba pagada.";
        return res.redirect("/compras/facturas");
      }
    } else if (tipo === 'independiente') {
      const [result] = await pool.query(
        "UPDATE facturas SET pagada = 1, fecha_pago = ? WHERE id = ? AND COALESCE(pagada, 0) = 0",
        [fechaPago, id]
      );
      if (!result.affectedRows) {
        req.session.error = "La factura independiente no existe o ya estaba pagada.";
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

router.post("/facturas/pagar-multiple", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
  try {
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
          o.total,
          o.factura,
          o.fecha_vencimiento_factura,
          p.nombre as proveedor_nombre,
          'orden' as tipo
        FROM ordenes_compra o
        JOIN proveedores p ON p.id = o.proveedor_id
        WHERE o.id IN (${placeholders}) AND o.facturada = 1 AND COALESCE(o.pagada, 0) = 0
      `, ordenIds);
      facturas.push(...ordenes);
    }

    if (independientesIds.length) {
      const placeholders = independientesIds.map(() => '?').join(',');
      const [independientes] = await pool.query(`
        SELECT
          f.id,
          NULL as po_numero,
          f.monto as total,
          f.numero_factura as factura,
          NULL as fecha_vencimiento_factura,
          f.proveedor_nombre,
          'independiente' as tipo
        FROM facturas f
        WHERE f.id IN (${placeholders}) AND COALESCE(f.pagada, 0) = 0
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
        `UPDATE ordenes_compra SET pagada = 1, fecha_pago = ? WHERE id IN (${placeholders}) AND facturada = 1 AND COALESCE(pagada, 0) = 0`,
        [fechaPago, ...ordenIds]
      );
    }

    if (independientesIds.length) {
      const placeholders = independientesIds.map(() => '?').join(',');
      await pool.query(
        `UPDATE facturas SET pagada = 1, fecha_pago = ? WHERE id IN (${placeholders}) AND COALESCE(pagada, 0) = 0`,
        [fechaPago, ...independientesIds]
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
router.get("/dashboard", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
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
router.get("/dashboard/proveedores/pdf", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"), async (req, res) => {
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
