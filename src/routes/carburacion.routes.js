const express = require('express');
const pool = require('../db');
const { fechaActualCostaRica } = require('../utils/fechaCostaRica');
const { generarPDFOrden } = require('../utils/pdfOrdenCompra');
const { resolverClientesOrden } = require('../utils/carburacionClientes');
const router = express.Router();

router.use((req, res, next) => {
  const user = req.session?.user;
  if (!user) return res.redirect('/login?departamento=CARBURACION');
  if (user.departamentoActivo !== 'CARBURACION' || !user.departamentos?.includes('CARBURACION')) return res.status(403).send('Sin acceso a Carburación.');
  res.locals.user = user;
  res.locals.carburacionPath = req.originalUrl.split('?')[0];
  next();
});
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const lineasDe = orden => typeof orden.lineas_json === 'string' ? JSON.parse(orden.lineas_json) : orden.lineas_json;
router.use(require('../utils/carburacionPermisos').controlarFinanzas);
router.use('/estaciones',require('./carburacionEstaciones.routes'));
router.use('/clientes',require('./carburacionClientes.routes'));
router.use(require('./carburacionFacturas.routes'));

router.get('/', (_req, res) => res.redirect('/carburacion/dashboard'));
router.get('/dashboard', wrap(async (_req, res) => {
  const hoy = fechaActualCostaRica();
  const inicioMes = `${hoy.slice(0, 7)}-01`;
  const [resumen, proveedores, montos, recientes] = await Promise.all([
    pool.query(`SELECT COUNT(*) total, COALESCE(SUM(fecha BETWEEN ? AND ?),0) mes,
      COALESCE(SUM(estado='BORRADOR'),0) borradores FROM carburacion_ordenes WHERE eliminado_en IS NULL`, [inicioMes,hoy]),
    pool.query('SELECT COUNT(*) total FROM carburacion_proveedores'),
    pool.query(`SELECT moneda, SUM(total) total FROM carburacion_ordenes
      WHERE eliminado_en IS NULL AND fecha BETWEEN ? AND ? GROUP BY moneda ORDER BY moneda`, [inicioMes,hoy]),
    pool.query(`SELECT o.id,o.po_numero,o.fecha,o.moneda,o.total,o.estado,p.nombre proveedor
      FROM carburacion_ordenes o JOIN carburacion_proveedores p ON p.id=o.proveedor_id
      WHERE o.eliminado_en IS NULL ORDER BY o.id DESC LIMIT 8`)
  ]);
  res.render('carburacion/dashboard', {
    resumen: resumen[0][0], cantidadProveedores: proveedores[0][0].total,
    montos: montos[0], recientes: recientes[0], hoy
  });
}));
router.get('/ordenes', wrap(async (_req, res) => {
  const [ordenes] = await pool.query(`SELECT o.*, p.nombre proveedor, f.numero factura_numero, f.id factura_id
    FROM carburacion_ordenes o JOIN carburacion_proveedores p ON p.id=o.proveedor_id
    LEFT JOIN carburacion_facturas f ON f.orden_id=o.id WHERE o.eliminado_en IS NULL ORDER BY o.id DESC LIMIT 300`);
  res.render('carburacion/ordenes', { ordenes });
}));
router.get('/proveedores', wrap(async (_req, res) => {
  const [proveedores] = await pool.query('SELECT * FROM carburacion_proveedores ORDER BY nombre');
  res.render('carburacion/proveedores', { proveedores });
}));
router.get('/proveedores/nuevo', (_req, res) => res.render('compras/proveedor_form', { proveedor: null, baseCompras: '/carburacion', esCarburacion: true }));
router.get('/proveedores/editar/:id', wrap(async (req, res) => {
  const [[proveedor]] = await pool.query('SELECT * FROM carburacion_proveedores WHERE id=?', [req.params.id]);
  if (!proveedor) return res.sendStatus(404);
  res.render('compras/proveedor_form', { proveedor, baseCompras: '/carburacion', esCarburacion: true });
}));
router.post('/proveedores', wrap(async (req, res) => {
  const values = ['nombre', 'direccion', 'telefono', 'email', 'contacto', 'cedula_juridica'].map(k => String(req.body[k] || '').trim());
  if (!values[0] || values.some(v => v.length > 2000) || (values[3] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[3]))) return res.status(400).send('Revise el nombre y los datos del proveedor.');
  if (req.body.id) {
    const [result] = await pool.query('UPDATE carburacion_proveedores SET nombre=?,direccion=?,telefono=?,email=?,contacto=?,cedula_juridica=? WHERE id=?', [...values, req.body.id]);
    if (!result.affectedRows) return res.sendStatus(404);
  } else await pool.query('INSERT INTO carburacion_proveedores (nombre,direccion,telefono,email,contacto,cedula_juridica,creado_por) VALUES (?,?,?,?,?,?,?)', [...values, req.session.user.id]);
  res.redirect('/carburacion/proveedores');
}));
async function formulario(req, res, editar) {
  const [proveedores] = await pool.query('SELECT id,nombre FROM carburacion_proveedores ORDER BY nombre');
  const [clientes] = await pool.query('SELECT id,nombre FROM carburacion_clientes ORDER BY nombre');
  let orden = null;
  if (editar) {
    [[orden]] = await pool.query('SELECT * FROM carburacion_ordenes WHERE id=? AND eliminado_en IS NULL', [req.params.id]);
    if (!orden) return res.sendStatus(404);
    const [[factura]] = await pool.query('SELECT id FROM carburacion_facturas WHERE orden_id=?',[orden.id]);
    if (factura) return res.status(409).send('La orden ya tiene factura registrada y no se puede editar.');
  }
  res.render('compras/orden_form', {
    orden, lineas: orden ? lineasDe(orden).map(l=>({...l,codigo:clientes.find(c=>c.id===l.cliente_id)?.nombre || l.codigo})) : [], proveedores, clientes,
    siguientePO: orden?.po_numero || 'Se asigna al guardar', fechaActual: orden?.fecha || fechaActualCostaRica(),
    tituloOrden: editar ? 'Editar orden de Carburación' : 'Nueva orden de Carburación',
    volverUrl: '/carburacion/ordenes', cancelarUrl: '/carburacion/ordenes',
    formAction: editar ? `/carburacion/ordenes/${orden.id}/editar` : '/carburacion/ordenes', esCarburacion: true
  });
}
router.get('/ordenes/nueva', wrap((req, res) => formulario(req, res, false)));
router.get('/ordenes/:id/editar', wrap((req, res) => formulario(req, res, true)));
function datosOrden(body) {
  const raw = Array.isArray(body.lineas) ? body.lineas : Object.values(body.lineas || {});
  const lineas = raw.map(l => ({ codigo: String(l.codigo || '').trim(), codigo_producto: String(l.codigo_producto || '').trim(), descripcion: String(l.descripcion || '').trim(), cantidad: Number(l.cantidad), precio_unitario: Number(l.precio_unitario) }));
  const descuento = Number(body.descuento || 0), transporte = Number(body.transporte || 0), iva = Number(body.iva ?? 13);
  if (!lineas.length || lineas.length > 200 || lineas.some(l => !l.descripcion || !Number.isFinite(l.cantidad) || l.cantidad <= 0 || !Number.isFinite(l.precio_unitario) || l.precio_unitario < 0) || [descuento,transporte,iva].some(n => !Number.isFinite(n) || n < 0) || iva > 100 || !['CRC','USD'].includes(body.moneda) || !['GAS TOMZA','SUPER GAS','GRANEL'].includes(body.empresa_destino)) throw new Error('DATOS_INVALIDOS');
  const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
  lineas.forEach(l => { l.subtotal = round(l.cantidad * l.precio_unitario); });
  const subtotal = round(lineas.reduce((s,l) => s+l.subtotal,0));
  if (descuento > subtotal) throw new Error('DATOS_INVALIDOS');
  const total = round((subtotal-descuento+transporte)*(1+iva/100));
  if (!Number.isFinite(total) || total >= 1e14) throw new Error('DATOS_INVALIDOS');
  return [body.proveedor_id, String(body.forma_pago || '').slice(0,100), body.moneda, body.empresa_destino, String(body.placa_unidad || '').slice(0,100), subtotal, descuento, transporte, iva, total, String(body.observaciones || ''), JSON.stringify(lineas)];
}
async function guardar(req,res,editar) {
  if(typeof (req.body.numero_cotizacion ?? '')!=='string' || String(req.body.numero_cotizacion || '').trim().length>100)return res.status(400).send('El número de cotización debe tener como máximo 100 caracteres.');
  const cotizacion=String(req.body.numero_cotizacion || '').trim() || null;
  let values;
  try { values = datosOrden(req.body); } catch { return res.status(400).send('Revise las líneas, moneda y totales de la orden.'); }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [clientes] = await connection.query('SELECT id,nombre FROM carburacion_clientes ORDER BY nombre');
    let datosClientes;
    try {
      datosClientes = resolverClientesOrden({...req.body,lineas:JSON.parse(values[11])},clientes);
    } catch(error) {
      await connection.rollback();
      return res.status(400).send(error.message);
    }
    values[4] = datosClientes.placa_unidad;
    values[11] = JSON.stringify(datosClientes.lineas);
    const [[proveedor]] = await connection.query('SELECT id FROM carburacion_proveedores WHERE id=?', [values[0]]);
    if (!proveedor) { await connection.rollback(); return res.status(400).send('Seleccione un proveedor de Carburación.'); }
    if (editar) {
      const [[orden]] = await connection.query('SELECT id FROM carburacion_ordenes WHERE id=? AND eliminado_en IS NULL FOR UPDATE',[req.params.id]);
      if (!orden) { await connection.rollback(); return res.sendStatus(404); }
      const [[factura]] = await connection.query('SELECT id FROM carburacion_facturas WHERE orden_id=?',[orden.id]);
      if (factura) { await connection.rollback(); return res.status(409).send('La orden ya tiene factura registrada y no se puede editar.'); }
      const [result] = await connection.query('UPDATE carburacion_ordenes SET proveedor_id=?,forma_pago=?,moneda=?,empresa_destino=?,placa_unidad=?,subtotal=?,descuento=?,transporte=?,iva=?,total=?,observaciones=?,lineas_json=?,actualizado_por=?,actualizado_en=CURRENT_TIMESTAMP,cliente_id=? WHERE id=?', [...values, req.session.user.id, datosClientes.cliente_id, req.params.id]);
      if (!result.affectedRows) { await connection.rollback(); return res.sendStatus(404); }
      await connection.query('UPDATE carburacion_ordenes SET numero_cotizacion=? WHERE id=?',[cotizacion,req.params.id]);
    } else {
      const [result] = await connection.query('INSERT INTO carburacion_ordenes (proveedor_id,forma_pago,moneda,empresa_destino,placa_unidad,subtotal,descuento,transporte,iva,total,observaciones,lineas_json,fecha,creado_por,cliente_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [...values, fechaActualCostaRica(), req.session.user.id, datosClientes.cliente_id]);
      await connection.query('UPDATE carburacion_ordenes SET po_numero=? WHERE id=?', [`CAR-${String(result.insertId).padStart(6,'0')}`, result.insertId]);
      await connection.query('UPDATE carburacion_ordenes SET numero_cotizacion=? WHERE id=?',[cotizacion,result.insertId]);
    }
    await connection.commit();
    res.redirect('/carburacion/ordenes');
  } catch(e) { await connection.rollback(); throw e; } finally { connection.release(); }
}
router.post('/ordenes', wrap((req,res) => guardar(req,res,false)));
router.post('/ordenes/:id/editar', wrap((req,res) => guardar(req,res,true)));
router.post('/ordenes/:id/eliminar',wrap(async(req,res)=>{
  if(!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)))return res.sendStatus(404);
  const connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    const [[orden]]=await connection.query('SELECT id FROM carburacion_ordenes WHERE id=? AND eliminado_en IS NULL FOR UPDATE',[req.params.id]);
    if(!orden){await connection.rollback();return res.sendStatus(404);}
    const [[factura]]=await connection.query('SELECT id FROM carburacion_facturas WHERE orden_id=?',[orden.id]);
    if(factura){await connection.rollback();return res.status(409).send('La orden tiene una factura asociada y no se puede eliminar.');}
    await connection.query('UPDATE carburacion_ordenes SET eliminado_en=CURRENT_TIMESTAMP,eliminado_por=? WHERE id=?',[req.session.user.id,orden.id]);
    await connection.commit();req.session.success='Orden eliminada.';res.redirect('/carburacion/ordenes');
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}));
router.get('/ordenes/:id/pdf', wrap(async (req,res) => {
  const [[orden]] = await pool.query('SELECT * FROM carburacion_ordenes WHERE id=? AND eliminado_en IS NULL',[req.params.id]);
  if (!orden) return res.sendStatus(404);
  const [[proveedor]] = await pool.query('SELECT * FROM carburacion_proveedores WHERE id=?',[orden.proveedor_id]);
  const pdf = await generarPDFOrden({ ...orden, cotizacion:orden.numero_cotizacion, tipo_mantenimiento: 'CARBURACIÓN', etiqueta_referencia: 'Cliente' }, proveedor, lineasDe(orden));
  res.type('pdf').set('Content-Disposition', `attachment; filename="${orden.po_numero}.pdf"`).send(pdf);
}));
module.exports = router;
