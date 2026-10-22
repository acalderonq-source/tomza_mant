const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const ejs = require('ejs');
const pool = require('../src/db');
const router = require('../src/routes/proveeduria.routes');
const precios = require('../src/utils/proveeduriaPreciosFijos');

const CLAVE = precios.claveArticulo('Cloro');
const usuario = { id: 1, usuario: 'compras', rol: 'PROVEEDURIA', sede: 'Cartago', departamentoActivo: 'PROVEEDURIA' };

async function servidor(run) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../src/views'));
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: usuario }; next(); });
  app.use('/proveeduria', router);
  const s = app.listen(0, '127.0.0.1');
  await new Promise(r => s.once('listening', r));
  try { await run(`http://127.0.0.1:${s.address().port}/proveeduria`); } finally { await new Promise(r => s.close(r)); }
}

function baseDatos() {
  const insertados = [];
  const query = async (sql, args) => {
    if (sql.includes('FROM prov_proveedores p LEFT JOIN prov_proveedor_contactos')) return [[{ clave: 'PROVEEDORA', nombre: 'Proveedora SA', telefono: '2222-0000', direccion: 'San José' }]];
    if (sql.includes('FROM prov_precios_fijos')) return [args.slice(1).includes(CLAVE) ? [{ clave_articulo: CLAVE, descripcion: 'Cloro', precio_unitario: '1000.0000', iva: '13.00', moneda: 'CRC' }] : []];
    if (sql.startsWith('SELECT codigo FROM prov_inventario_bajas')) return [[]];
    if (sql.startsWith('INSERT INTO prov_documentos')) { insertados.push({ tipo: args ? JSON.parse(args[2]) : null, sql }); return [{ insertId: 40 + insertados.length }]; }
    return [[]];
  };
  return { query, insertados };
}

test('el carrito genera la OC con el precio fijo del catálogo, sin cotización y marcada', async () => {
  const q = pool.query, c = pool.getConnection;
  const db = baseDatos();
  pool.query = async () => [[]];
  pool.getConnection = async () => ({ beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {}, query: db.query });
  try {
    await servidor(async base => {
      const cuerpo = { proveedor_clave: 'PROVEEDORA', sede: 'Cartago', empresa_destino: 'GAS TOMZA', email: 'ventas@proveedora.cr', entrega: '3 días', credito: '30',
        items: [{ clave: CLAVE, cantidad: 2, precio_unitario: 1 }] };
      const r = await fetch(base + '/precio-fijo/ordenes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
      assert.equal(r.status, 200, await r.clone().text());
      const oc = db.insertados.map(i => i.tipo).find(d => d.precio_fijo);
      assert.ok(oc, 'la OC queda marcada como precio fijo');
      assert.equal(oc.lineas[0].precio_unitario, 1000, 'el precio enviado por el navegador se ignora');
      assert.equal(oc.total, 2260);
      assert.equal(oc.cotizacion_archivo, undefined);
      assert.equal(oc.proveedor, 'Proveedora SA');
      assert.equal(oc.credito, 30);

      const otro = await fetch(base + '/precio-fijo/ordenes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...cuerpo, items: [{ clave: 'ARTICULO SIN PRECIO FIJO', cantidad: 1 }] }) });
      assert.equal(otro.status, 400, 'un artículo sin precio fijo con ese proveedor no se puede comprar por el carrito');
    });
  } finally {
    pool.query = q;
    pool.getConnection = c;
  }
});

test('el catálogo de precios fijos parte de los artículos con precio', () => {
  const base = precios.catalogoBase();
  assert.ok(base.size > 100);
  assert.ok([...base.values()].every(a => a.precio_unitario > 0));
});

test('las pantallas muestran el carrito por proveedor y la marca de precio fijo', async () => {
  const carrito = await ejs.renderFile(path.join(__dirname, '../src/views/proveeduria/carrito_precio_fijo.ejs'), {
    user: usuario, sedes: ['Cartago'], empresas: ['GAS TOMZA', 'SUPER GAS'],
    grupos: [{ proveedor: { clave: 'PROVEEDORA', nombre: 'Proveedora SA', correos: ['ventas@proveedora.cr'], condicion_pago: '30' }, articulos: [{ clave: CLAVE, descripcion: 'Cloro', precio_unitario: 1000, iva: 13, moneda: 'CRC' }] }]
  }, { views: [path.join(__dirname, '../src/views')] });
  assert.match(carrito, /Proveedora SA/);
  assert.match(carrito, /Precio fijo · sin cotización/);
  assert.match(carrito, /data-pf-cantidad/);
  assert.doesNotMatch(carrito, /style=/);
});
