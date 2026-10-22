// Precios fijos de Proveeduría: catálogo con proveedor asignado y carrito sin cotización.
const crypto = require('crypto');
const { articulosExcel } = require('./proveeduriaCatalogo');
const { articuloSolicitudDescripcion } = require('./proveeduriaSolicitable');
const { exigir, numero, lineasCompra } = require('./proveeduria');
const { leerCorreosJSON } = require('./proveeduriaProveedores');
const fuente = require('../data/proveeduriaArticulosExcel.json');

const MONEDA_CATALOGO = ['CRC', 'USD'].includes(fuente.moneda) ? fuente.moneda : 'CRC';
const claveArticulo = descripcion => String(descripcion || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().slice(0, 255);
const codigoArticulo = descripcion => articuloSolicitudDescripcion(descripcion)?.codigo || 'ART-' + crypto.createHash('sha256').update(String(descripcion || '')).digest('hex').slice(0, 12);

// Artículos del catálogo que ya traen precio: punto de partida para asignar proveedor.
function catalogoBase() {
  const vistos = new Map();
  for (const a of articulosExcel) {
    const precio = Number(a.precio_unitario);
    if (!(precio > 0)) continue;
    const clave = claveArticulo(a.descripcion);
    if (clave && !vistos.has(clave)) vistos.set(clave, { clave, descripcion: String(a.descripcion).trim(), precio_unitario: precio, iva: Number(a.iva ?? 13), moneda: MONEDA_CATALOGO });
  }
  return vistos;
}

async function leerTabla(db) {
  try {
    const [rows] = await db.query('SELECT clave_articulo, descripcion, proveedor_clave, precio_unitario, iva, moneda, activo FROM prov_precios_fijos');
    return rows;
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') return [];
    throw error;
  }
}

async function proveedores(db) {
  const [rows] = await db.query(`SELECT p.clave, p.nombre, c.correos, c.condicion_pago, c.telefono, c.direccion
    FROM prov_proveedores p LEFT JOIN prov_proveedor_contactos c ON c.clave = p.clave WHERE p.activo = 1 ORDER BY p.nombre`);
  return rows.map(p => ({ ...p, correos: leerCorreosJSON(p.correos) }));
}

// Lista para administrar: catálogo con precio + lo guardado (lo guardado manda).
async function listarGestion(db) {
  const base = catalogoBase();
  const lista = new Map([...base].map(([k, v]) => [k, { ...v, proveedor_clave: '', activo: 1, guardado: false }]));
  for (const r of await leerTabla(db)) {
    lista.set(r.clave_articulo, { clave: r.clave_articulo, descripcion: r.descripcion, precio_unitario: Number(r.precio_unitario), iva: Number(r.iva), moneda: r.moneda, proveedor_clave: r.proveedor_clave || '', activo: Number(r.activo), guardado: true });
  }
  const listaProveedores = await proveedores(db);
  const nombres = new Map(listaProveedores.map(p => [p.clave, p.nombre]));
  return {
    articulos: [...lista.values()].map(a => ({ ...a, proveedor: nombres.get(a.proveedor_clave) || '' })).sort((a, b) => a.descripcion.localeCompare(b.descripcion, 'es')),
    proveedores: listaProveedores
  };
}

async function guardar(db, body, usuarioId) {
  const clave = claveArticulo(body.clave || body.descripcion);
  const base = catalogoBase().get(clave);
  const [[existente]] = await db.query('SELECT descripcion FROM prov_precios_fijos WHERE clave_articulo = ?', [clave]).catch(() => [[]]);
  const descripcion = String(existente?.descripcion || base?.descripcion || body.descripcion || '').trim();
  exigir(clave && descripcion && descripcion.length <= 255, 'Artículo inválido');
  exigir(existente || base, 'El artículo no está en el catálogo de Proveeduría');
  const proveedorClave = String(body.proveedor_clave || '').trim();
  if (proveedorClave) {
    const [[p]] = await db.query('SELECT clave FROM prov_proveedores WHERE clave = ? AND activo = 1', [proveedorClave]);
    exigir(p, 'Seleccione un proveedor activo');
  }
  const precio = numero(body.precio_unitario, 'Precio', 0.0001);
  const iva = numero(body.iva ?? 13, 'IVA');
  exigir(iva <= 100, 'IVA inválido');
  const moneda = String(body.moneda || 'CRC');
  exigir(['CRC', 'USD'].includes(moneda), 'Moneda inválida');
  const activo = body.activo === false || body.activo === '0' ? 0 : 1;
  await db.query(`INSERT INTO prov_precios_fijos (clave_articulo, descripcion, proveedor_clave, precio_unitario, iva, moneda, activo, actualizado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE proveedor_clave = VALUES(proveedor_clave), precio_unitario = VALUES(precio_unitario), iva = VALUES(iva),
      moneda = VALUES(moneda), activo = VALUES(activo), actualizado_por = VALUES(actualizado_por)`,
  [clave, descripcion, proveedorClave || null, precio, iva, moneda, activo, usuarioId || null]);
  return { clave, descripcion, proveedor_clave: proveedorClave, precio_unitario: precio, iva, moneda, activo };
}

// Lo que se puede comprar desde el carrito: activo y con proveedor asignado, agrupado por proveedor.
async function carrito(db) {
  const tabla = (await leerTabla(db)).filter(r => Number(r.activo) && r.proveedor_clave);
  const lista = await proveedores(db);
  const porClave = new Map(lista.map(p => [p.clave, p]));
  const grupos = new Map();
  for (const r of tabla) {
    const p = porClave.get(r.proveedor_clave);
    if (!p) continue;
    const g = grupos.get(p.clave) || { proveedor: p, articulos: [] };
    g.articulos.push({ clave: r.clave_articulo, descripcion: r.descripcion, precio_unitario: Number(r.precio_unitario), iva: Number(r.iva), moneda: r.moneda });
    grupos.set(p.clave, g);
  }
  return [...grupos.values()].map(g => ({ ...g, articulos: g.articulos.sort((a, b) => a.descripcion.localeCompare(b.descripcion, 'es')) }))
    .sort((a, b) => a.proveedor.nombre.localeCompare(b.proveedor.nombre, 'es'));
}

// Arma las líneas de la OC con el precio fijo del servidor; el navegador solo envía cantidades.
async function lineasPrecioFijo(db, proveedorClave, items) {
  exigir(Array.isArray(items) && items.length > 0 && items.length <= 200, 'Agregue entre 1 y 200 artículos al carrito');
  const claves = items.map(i => String(i?.clave || ''));
  exigir(new Set(claves).size === claves.length, 'No repita artículos');
  const [rows] = await db.query(`SELECT clave_articulo, descripcion, precio_unitario, iva, moneda FROM prov_precios_fijos
    WHERE proveedor_clave = ? AND activo = 1 AND clave_articulo IN (${claves.map(() => '?').join(',')})`, [proveedorClave, ...claves]);
  const fijos = new Map(rows.map(r => [r.clave_articulo, r]));
  const monedas = new Set();
  const lineas = lineasCompra(items.map(i => {
    const f = fijos.get(String(i.clave));
    exigir(f, 'Un artículo del carrito ya no tiene precio fijo con este proveedor. Actualice la página.');
    monedas.add(f.moneda);
    return { codigo: codigoArticulo(f.descripcion), descripcion: f.descripcion, cantidad: i.cantidad, precio_unitario: Number(f.precio_unitario), iva: Number(f.iva) };
  }), true);
  exigir(monedas.size === 1, 'Los artículos de una misma orden deben tener la misma moneda');
  return { lineas, moneda: [...monedas][0] };
}

module.exports = { claveArticulo, codigoArticulo, catalogoBase, listarGestion, guardar, carrito, lineasPrecioFijo, proveedores };
