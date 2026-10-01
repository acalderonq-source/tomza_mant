const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

let query;
let committed;
let rolledBack;
const statements = [];
const connection = {
  beginTransaction: async () => {},
  query: async (sql, params = []) => { statements.push({ sql, params }); return query(sql, params); },
  commit: async () => { committed = true; },
  rollback: async () => { rolledBack = true; },
  release: () => {}
};
const dbPath = require.resolve("../src/db");
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  getConnection: async () => connection,
  query: async (sql, params = []) => {
    if (/INFORMATION_SCHEMA/i.test(sql)) return [[{ count: 1 }]];
    if (/SELECT po_numero FROM ordenes_compra/.test(sql)) return [[]];
    statements.push({ sql, params });
    return query(sql, params);
  }
} };
const router = require("../src/routes/compras.routes");

async function request(body = {}, role = "ADMIN") {
  const layer = router.stack.find(item => item.route?.path === "/ordenes/consignacion-consumo" && item.route.methods.post);
  assert.ok(layer, "consignment consumption order route exists");
  const req = { body, session: { user: { id: 7, usuario: "admin", rol: role } } };
  const result = { status: 200 };
  const res = {
    redirect: url => { result.redirect = url; },
    status: code => { result.status = code; return res; },
    send: value => { result.body = value; }
  };
  for (const item of layer.route.stack) {
    let next = false;
    await item.handle(req, res, () => { next = true; });
    if (!next) break;
  }
  return { ...result, session: req.session };
}

beforeEach(() => {
  committed = false;
  rolledBack = false;
  statements.length = 0;
  query = async sql => { throw new Error(`Unexpected SQL: ${sql}`); };
});

test("consumption creates a regular draft PO with net per-plate lines and locks movements against reuse", async () => {
  query = async (sql, params = []) => {
    if (/SELECT id, nombre FROM proveedores/.test(sql)) return [[{ id: 5, nombre: "MAXI REPUESTOS SRL" }]];
    if (/SELECT DISTINCT COALESCE\(NULLIF\(TRIM\(proveedor_consignacion/.test(sql)) return [[{ proveedor: "MAXI REPUESTOS" }, { proveedor: "Maxi Repuestos SRL" }]];
    if (/SELECT orden_compra_id FROM bodega_ordenes_consumo/.test(sql)) return [[]];
    if (/SELECT bm\.id, bm\.articulo_id/.test(sql)) {
      assert.deepEqual(params, ["2026-09-21", "2026-09-27", "MAXI REPUESTOS", "MAXI REPUESTOS SRL", "MAXI REPUESTOS", "Maxi Repuestos SRL", "Cartago", "Cartago"]);
      return [[
        { id: 101, articulo_id: 9, tipo_movimiento: "SALIDA", cantidad: 2, placa: "C164528", precio_unitario: 100, codigo_taller: "0009", codigo: "LF1", nombre: "Filtro", unidad_medida: "UND", precio_actual: 120, articulo_proveedor_id: 5 },
        { id: 102, articulo_id: 9, tipo_movimiento: "DEVOLUCION", cantidad: 1, placa: "C164528", precio_unitario: 100, codigo_taller: "0009", codigo: "LF1", nombre: "Filtro", unidad_medida: "UND", precio_actual: 120, articulo_proveedor_id: 5 }
      ]];
    }
    if (/INSERT INTO ordenes_compra\s/.test(sql)) return [{ insertId: 30 }];
    return [{ affectedRows: 1 }];
  };

  const response = await request({
    proveedor: "MAXI REPUESTOS", fecha_desde: "2026-09-21", fecha_hasta: "2026-09-27", sede: "Cartago",
    proveedor_confirmado: "1", contacto_confirmacion: "María Proveedor", referencia_confirmacion: "WhatsApp 123"
  });
  assert.equal(committed, true);
  assert.equal(rolledBack, false);
  assert.equal(response.redirect, "/compras/ordenes/30/pdf");
  assert.match(response.session.success, /2026-001/);
  const order = statements.find(item => /INSERT INTO ordenes_compra\s/.test(item.sql));
  assert.equal(order.params[3], "GENERALES TALLER");
  assert.equal(order.params[4], 100);
  assert.equal(order.params[5], 13);
  assert.equal(order.params[6], 113);
  const line = statements.find(item => /INSERT INTO ordenes_compra_detalle/.test(item.sql));
  assert.deepEqual(line.params, [30, "C164528", "LF1", "Filtro", 1, 100, 100]);
  const confirmed = statements.find(item => /INSERT INTO bodega_ordenes_consumo\s/.test(item.sql));
  assert.deepEqual(confirmed.params, [30, 5, "2026-09-21", "2026-09-27", "Cartago", "María Proveedor", "WhatsApp 123", 7, 7]);
  assert.deepEqual(statements.filter(item => /INSERT INTO bodega_ordenes_consumo_movimientos/.test(item.sql)).map(item => item.params[0]), [101, 102]);
});

test("consumption without a plate cannot be converted into a purchase order", async () => {
  query = async sql => {
    if (/SELECT id, nombre FROM proveedores/.test(sql)) return [[{ id: 5, nombre: "MAXI REPUESTOS SRL" }]];
    if (/SELECT DISTINCT COALESCE\(NULLIF\(TRIM\(proveedor_consignacion/.test(sql)) return [[{ proveedor: "MAXI REPUESTOS" }, { proveedor: "Maxi Repuestos SRL" }]];
    if (/SELECT orden_compra_id FROM bodega_ordenes_consumo/.test(sql)) return [[]];
    if (/SELECT bm\.id, bm\.articulo_id/.test(sql)) return [[
      { id: 101, articulo_id: 9, tipo_movimiento: "SALIDA", cantidad: 2, placa: null, precio_unitario: 100, codigo_taller: "0009", codigo: "LF1", nombre: "Filtro", unidad_medida: "UND", precio_actual: 120, articulo_proveedor_id: 5 }
    ]];
    throw new Error(sql);
  };
  const response = await request({
    proveedor: "MAXI REPUESTOS", fecha_desde: "2026-09-21", fecha_hasta: "2026-09-27",
    proveedor_confirmado: "1", contacto_confirmacion: "María Proveedor"
  });
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  assert.equal(statements.some(item => /INSERT INTO ordenes_compra\s/.test(item.sql)), false);
  assert.match(response.session.error, /sin placa/);
});

test("repeating the same provider, site and period does not create a duplicate order", async () => {
  query = async sql => {
    if (/SELECT id, nombre FROM proveedores/.test(sql)) return [[{ id: 5, nombre: "MAXI REPUESTOS SRL" }]];
    if (/SELECT DISTINCT COALESCE\(NULLIF\(TRIM\(proveedor_consignacion/.test(sql)) return [[{ proveedor: "MAXI REPUESTOS" }, { proveedor: "Maxi Repuestos SRL" }]];
    if (/SELECT orden_compra_id FROM bodega_ordenes_consumo/.test(sql)) return [[{ orden_compra_id: 30 }]];
    throw new Error(sql);
  };
  const response = await request({ proveedor: "MAXI REPUESTOS", fecha_desde: "2026-09-21", fecha_hasta: "2026-09-27", sede: "Cartago", proveedor_confirmado: "1", contacto_confirmacion: "María" });
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  assert.equal(response.redirect, "/compras/ordenes/30/pdf");
  assert.match(response.session.success, /Ya existe una orden/);
  assert.equal(statements.some(item => /INSERT INTO ordenes_compra\s/.test(item.sql)), false);
});

test("only purchasing roles can turn consignment consumption into a purchase order", async () => {
  const response = await request({ proveedor: "MAXI REPUESTOS" }, "BODEGUERO");
  assert.equal(response.status, 403);
  assert.equal(statements.length, 0);
});
