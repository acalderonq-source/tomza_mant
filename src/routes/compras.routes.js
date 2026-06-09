const express = require("express");
const router = express.Router();
const pool = require("../db");
const { generarPDFOrden } = require('../utils/pdfOrdenCompra');

// Middleware de autenticación
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

// Permitir solo los roles especificados
function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (roles.includes(req.session.user.rol)) return next();
    return res.status(403).send("No autorizado");
  };
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

// ===================== PROVEEDORES (solo ADMIN) =====================
router.get("/proveedores", requireAuth, allowRoles("ADMIN"), async (req, res) => {
  try {
    const [proveedores] = await pool.query("SELECT * FROM proveedores ORDER BY nombre");
    res.render("compras/proveedores", { proveedores, user: req.session.user });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error cargando proveedores");
  }
});

router.get("/proveedores/nuevo", requireAuth, allowRoles("ADMIN"), (req, res) => {
  res.render("compras/proveedor_form", { proveedor: null, user: req.session.user });
});

router.post("/proveedores", requireAuth, allowRoles("ADMIN"), async (req, res) => {
  try {
    const { id, nombre, direccion, telefono, email, contacto } = req.body;
    if (id) {
      await pool.query(
        "UPDATE proveedores SET nombre=?, direccion=?, telefono=?, email=?, contacto=? WHERE id=?",
        [nombre, direccion, telefono, email, contacto, id]
      );
    } else {
      await pool.query(
        "INSERT INTO proveedores (nombre, direccion, telefono, email, contacto) VALUES (?,?,?,?,?)",
        [nombre, direccion, telefono, email, contacto]
      );
    }
    res.redirect("/compras/proveedores");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error guardando proveedor");
  }
});

router.get("/proveedores/eliminar/:id", requireAuth, allowRoles("ADMIN"), async (req, res) => {
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
    const [proveedores] = await pool.query("SELECT id, nombre FROM proveedores ORDER BY nombre");
    const siguientePO = await generarNumeroPO();
    res.render("compras/orden_form", { 
      orden: null, 
      proveedores, 
      user: req.session.user,
      siguientePO,
      fechaActual: new Date().toISOString().slice(0,10)
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error cargando formulario");
  }
});

router.post("/ordenes", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const po_numero = await generarNumeroPO();
    const fecha = new Date().toISOString().slice(0, 10);

    const { proveedor_id, forma_pago, moneda, lineas, subtotal, descuento, transporte, iva, total, observaciones, empresa_destino } = req.body;
console.log("📌 [POST] empresa_destino recibida:", empresa_destino);
    const [result] = await connection.query(
      `INSERT INTO ordenes_compra 
       (po_numero, fecha, proveedor_id, forma_pago, moneda, subtotal, descuento, transporte, iva, total, observaciones, creado_por, estado, empresa_destino) 
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'BORRADOR', ?)`,
      [po_numero, fecha, proveedor_id, forma_pago, moneda, subtotal, descuento, transporte, iva, total, observaciones || null, req.session.user.id, empresa_destino || 'GAS TOMZA']
    );
    const ordenId = result.insertId;

    for (let key in lineas) {
      if (lineas.hasOwnProperty(key)) {
        const linea = lineas[key];
        await connection.query(
          `INSERT INTO ordenes_compra_detalle 
           (orden_compra_id, codigo, descripcion, cantidad, precio_unitario, subtotal) 
           VALUES (?,?,?,?,?,?)`,
          [ordenId, linea.codigo || null, linea.descripcion, linea.cantidad, linea.precio_unitario, linea.subtotal]
        );
      }
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

// ===================== LISTADO DE ÓRDENES CON FILTROS =====================
router.get("/ordenes", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    const { proveedor_id, fecha_desde, fecha_hasta, po_numero, estado } = req.query;

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

    sql += ` ORDER BY o.fecha DESC, o.id DESC`;

    const [ordenes] = await pool.query(sql, params);
    const [proveedores] = await pool.query("SELECT id, nombre FROM proveedores ORDER BY nombre");
    const estados = ['BORRADOR', 'ENVIADA', 'RECIBIDA_PARCIAL', 'RECIBIDA_TOTAL'];

    // Calcular total filtrado
    let totalFiltrado = 0;
    ordenes.forEach(o => totalFiltrado += parseFloat(o.total) || 0);

    res.render("compras/ordenes", { 
      ordenes, 
      user: req.session.user,
      proveedores,
      estados,
      filtros: { proveedor_id, fecha_desde, fecha_hasta, po_numero, estado },
      totalFiltrado
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error");
  }
});

// Detalle de la orden
router.get("/ordenes/:id/detalle", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
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

// ===================== PDF – Descargar orden =====================
router.get("/ordenes/:id/pdf", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
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

// ===================== RECIBIR ORDEN =====================
router.post("/ordenes/:id/recibir", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    const id = req.params.id;
    await pool.query("UPDATE ordenes_compra SET estado = 'RECIBIDA_TOTAL' WHERE id = ?", [id]);
    res.redirect("/compras/ordenes");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error al marcar orden como recibida");
  }
});

// ===================== ELIMINAR ORDEN =====================
router.post("/ordenes/:id/eliminar", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    const id = req.params.id;
    const [[orden]] = await pool.query("SELECT * FROM ordenes_compra WHERE id = ?", [id]);
    if (!orden) return res.status(404).send("Orden no encontrada");
    await pool.query("DELETE FROM ordenes_compra_detalle WHERE orden_compra_id = ?", [id]);
    await pool.query("DELETE FROM ordenes_compra WHERE id = ?", [id]);
    res.redirect("/compras/ordenes");
  } catch (error) {
    console.error("❌ Error al eliminar orden:", error);
    res.status(500).send("Error al eliminar la orden");
  }
});

// ===================== DASHBOARD DE ANÁLISIS =====================
router.get("/dashboard", requireAuth, allowRoles("ADMIN", "TALLER", "PROVEEDURIA_TALLER"), async (req, res) => {
  try {
    const [[totalGasto]] = await pool.query("SELECT SUM(total) as total FROM ordenes_compra");
    const [topProveedores] = await pool.query(`
      SELECT p.nombre, SUM(o.total) as total_gastado
      FROM ordenes_compra o
      JOIN proveedores p ON p.id = o.proveedor_id
      GROUP BY o.proveedor_id
      ORDER BY total_gastado DESC LIMIT 5
    `);
    const [gastoMensual] = await pool.query(`
      SELECT DATE_FORMAT(o.fecha, '%Y-%m') as mes, SUM(o.total) as total
      FROM ordenes_compra o
      WHERE o.fecha >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY mes ORDER BY mes ASC
    `);
    const [topProductos] = await pool.query(`
      SELECT d.descripcion, SUM(d.cantidad) as total_cantidad, SUM(d.subtotal) as total_monto
      FROM ordenes_compra_detalle d
      GROUP BY d.descripcion ORDER BY total_cantidad DESC LIMIT 5
    `);
    const [ordenesPorEstado] = await pool.query(`
      SELECT estado, COUNT(*) as cantidad FROM ordenes_compra GROUP BY estado
    `);
    const [gastoPorProveedor] = await pool.query(`
      SELECT p.nombre, SUM(o.total) as total_gastado
      FROM ordenes_compra o
      JOIN proveedores p ON p.id = o.proveedor_id
      GROUP BY o.proveedor_id ORDER BY total_gastado DESC LIMIT 10
    `);
    res.render("compras/dashboard_compras", {
      user: req.session.user,
      totalGasto: totalGasto.total || 0,
      topProveedores: topProveedores || [],
      gastoMensual: gastoMensual || [],
      topProductos: topProductos || [],
      ordenesPorEstado: ordenesPorEstado || [],
      gastoPorProveedor: gastoPorProveedor || []
    });
  } catch (error) {
    console.error("Error en dashboard de compras:", error);
    res.status(500).send("Error cargando estadísticas");
  }
});

console.log("✅ Rutas de compras cargadas correctamente");
module.exports = router;