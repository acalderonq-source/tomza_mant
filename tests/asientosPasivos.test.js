const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");

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
    if (/CREATE TABLE|ALTER TABLE/.test(sql)) return [{}];
    if (/UPDATE pagos_proveedor\s+SET (pagada = 1|periodo_cierre = DATE_FORMAT)/.test(sql)) return [{ affectedRows: 0 }];
    if (/INFORMATION_SCHEMA/i.test(sql)) return [[{ count: 1, dataType: "decimal", maxLength: 255, numeric_scale: 4, numeric_precision: 14 }]];
    if (/FROM prov_documentos/.test(sql)) return [[]];
    statements.push({ sql, params });
    return query(sql, params);
  }
} };
const router = require("../src/routes/compras.routes");

async function request(method, path, { body = {}, params = {}, queryParams = {}, role = "ADMIN" } = {}) {
  const layer = router.stack.find(item => item.route && item.route.path === path && item.route.methods[method.toLowerCase()]);
  assert.ok(layer, `Route ${method} ${path} exists`);
  const req = { body, params, query: queryParams, session: { user: { id: 1, rol: role, usuario: "admin" } } };
  const result = { status: 200, headers: {} };
  const res = {
    render: (view, locals) => { result.view = view; result.locals = locals; },
    redirect: url => { result.redirect = url; },
    status: code => { result.status = code; return res; },
    send: value => { result.body = value; },
    setHeader: (name, value) => { result.headers[name] = value; }
  };
  for (const item of layer.route.stack) {
    let next = false;
    await item.handle(req, res, () => { next = true; });
    if (!next) break;
  }
  return { ...result, session: req.session };
}

beforeEach(() => {
  statements.length = 0;
  committed = false;
  rolledBack = false;
  query = async sql => { throw new Error(`Unexpected SQL: ${sql}`); };
});

test("asientos require invoice role and valid explicit selection", async () => {
  const denied = await request("POST", "/facturas/asientos", { body: { factura_ref: "independiente:11" }, role: "MECANICO" });
  assert.equal(denied.status, 403);
  assert.equal(statements.length, 0);

  const invalid = await request("POST", "/facturas/asientos", { body: { factura_ref: ["independiente:11", "independiente:11"] } });
  assert.match(invalid.session.error, /repetidas/);
  assert.equal(committed, false);
  assert.equal(statements.length, 0);
});

test("same invoice in an earlier asiento is rejected without saving another file", async () => {
  query = async sql => {
    if (/SELECT id FROM facturas/.test(sql)) return [[{ id: 11 }]];
    if (/FROM asientos_pasivos_facturas/.test(sql)) return [[{ factura_tipo: "independiente", factura_id: 11 }]];
    throw new Error(sql);
  };
  const response = await request("POST", "/facturas/asientos", { body: { factura_ref: "independiente:11" } });
  assert.equal(response.redirect, "/compras/facturas/asientos");
  assert.match(response.session.error, /otro asiento/);
  assert.equal(rolledBack, true);
  assert.equal(committed, false);
  assert.equal(statements.some(item => /INSERT INTO asientos_pasivos_lotes/.test(item.sql)), false);
});

test("a USD invoice cannot be saved as a colones asiento", async () => {
  query = async sql => {
    if (/SELECT id FROM facturas/.test(sql)) return [[{ id: 13 }]];
    if (/SELECT factura_tipo, factura_id FROM asientos_pasivos_facturas/.test(sql)) return [[]];
    if (/UNION ALL/.test(sql)) return [[{
      id: 13, tipo: "independiente", fecha: new Date("2026-09-22T12:00:00Z"),
      monto: 25, moneda: "USD", nota_credito_monto: 0, numero_factura: "F-13"
    }]];
    throw new Error(sql);
  };
  const response = await request("POST", "/facturas/asientos", { body: { factura_ref: "independiente:13" } });
  assert.match(response.session.error, /colones/);
  assert.equal(rolledBack, true);
  assert.equal(committed, false);
  assert.equal(statements.some(item => /INSERT INTO asientos_pasivos_lotes/.test(item.sql)), false);
});

test("selected invoice creates an immutable batch, snapshot, and exact downloadable Excel", async () => {
  let savedFile;
  query = async (sql, params) => {
    if (/SELECT id FROM facturas/.test(sql)) return [[{ id: 11 }]];
    if (/SELECT factura_tipo, factura_id FROM asientos_pasivos_facturas/.test(sql)) return [[]];
    if (/UNION ALL/.test(sql)) return [[{
      id: 11, tipo: "independiente", fecha: new Date("2026-09-22T12:00:00Z"),
      monto: 1250.5, moneda: "CRC", nota_credito_monto: 0, abono_monto: 0, pagada: 0,
      numero_factura: "F-11", proveedor_nombre: "Proveedor Prueba"
    }]];
    if (/INSERT INTO asientos_pasivos_lotes/.test(sql)) {
      savedFile = params[4];
      assert.equal(params[1], 1);
      assert.equal(params[2], 1250.5);
      return [{ insertId: 17 }];
    }
    if (/INSERT INTO asientos_pasivos_facturas/.test(sql)) {
      assert.deepEqual(params[0][0].slice(0, 3), [17, "independiente", 11]);
      assert.equal(params[0][0][5], "F-11");
      assert.equal(params[0][0][8], 1250.5);
      return [{ affectedRows: 1 }];
    }
    if (/SELECT archivo_nombre, archivo_xlsx/.test(sql)) return [[{ archivo_nombre: "asiento_original.xlsx", archivo_xlsx: savedFile }]];
    throw new Error(sql);
  };
  const created = await request("POST", "/facturas/asientos", { body: { factura_ref: "independiente:11" }, role: "CONTABILIDAD" });
  assert.equal(created.redirect, "/compras/facturas/asientos?creado=17");
  assert.equal(committed, true);
  assert.ok(Buffer.isBuffer(savedFile));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(savedFile);
  assert.equal(workbook.getWorksheet("01").getCell("K2").value, "F-11");
  assert.equal(workbook.getWorksheet("01").getCell("D2").value, 1250.5);

  const download = await request("GET", "/facturas/asientos/:id/excel", { params: { id: "17" } });
  assert.equal(download.status, 200);
  assert.deepEqual(download.body, savedFile);
  assert.match(download.headers["Content-Disposition"], /asiento_original.xlsx/);
});

test("batch creation rolls back on concurrent duplicate and history marks its invoices", async () => {
  query = async (sql, params) => {
    if (/SELECT id FROM facturas/.test(sql)) return [[{ id: 12 }]];
    if (/SELECT factura_tipo, factura_id FROM asientos_pasivos_facturas/.test(sql)) return [[]];
    if (/UNION ALL/.test(sql)) return [[{ id: 12, tipo: "independiente", fecha: new Date("2026-09-22T12:00:00Z"), monto: 10, moneda: "CRC", nota_credito_monto: 0, abono_monto: 0, pagada: 0, numero_factura: "F-12", proveedor_nombre: "Proveedor" }]];
    if (/INSERT INTO asientos_pasivos_lotes/.test(sql)) return [{ insertId: 20 }];
    if (/INSERT INTO asientos_pasivos_facturas/.test(sql)) throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
    throw new Error(sql);
  };
  const duplicate = await request("POST", "/facturas/asientos", { body: { factura_ref: "independiente:12" } });
  assert.equal(rolledBack, true);
  assert.equal(committed, false);
  assert.match(duplicate.session.error, /ya fue incluida/);

  query = async sql => {
    if (/SELECT id, nombre FROM proveedores/.test(sql)) return [[{ id: 1, nombre: "Proveedor" }]];
    if (/UNION ALL/.test(sql)) return [[{ id: 12, tipo: "independiente", fecha: new Date("2026-09-22T12:00:00Z"), monto: 10, numero_factura: "F-12", proveedor_id: 1, proveedor_nombre: "Proveedor", nota_credito_monto: 0, abono_monto: 0, pagada: 0 }]];
    if (/SELECT factura_tipo, factura_id, lote_id, clave_electronica/.test(sql)) return [[{ factura_tipo: "orden", factura_id: 99, lote_id: 5, identidad_documento: "ID1:F12" }]];
    if (/COUNT\(\*\) AS total FROM asientos_pasivos_lotes/.test(sql)) return [[{ total: 1 }]];
    if (/SELECT l.id, l.creado_en/.test(sql)) return [[{ id: 5, cantidad_facturas: 1, monto_total: 10, creado_en: new Date(), archivo_nombre: "a.xlsx" }]];
    throw new Error(sql);
  };
  const list = await request("GET", "/facturas/asientos", { queryParams: { estado: "incluida" } });
  assert.equal(list.view, "compras/asientos_pasivos");
  assert.equal(list.locals.facturas.length, 1);
  assert.equal(list.locals.facturas[0].lote_asiento_id, 5);
  assert.equal(list.locals.historial.length, 1);
});
test('factura aprobada del portal se lista y genera el asiento con su identidad y auditoría',async()=>{
  const portal=require('../src/utils/portalAsientos'),original=portal.obtener;
  const factura={id:71,tipo:'portal',fecha:'2026-10-16',numero_factura:'PORTAL-71',clave_electronica:'506PORTAL71',proveedor_nombre:'Proveedor del portal',moneda:'CRC',monto_original:113,monto:113,nota_credito_monto:0};
  portal.obtener=async(db,f,lock)=>{if(lock){assert.deepEqual(f.ids,[71]);}return [factura];};
  let archivo;
  query=async(sql,params)=>{
    if(/SELECT id, nombre FROM proveedores/.test(sql)||/UNION ALL/.test(sql)||/SELECT factura_tipo/.test(sql)||/SELECT l.id/.test(sql))return [[]];
    if(/COUNT\(\*\) AS total/.test(sql))return [[{total:0}]];
    if(/INSERT INTO asientos_pasivos_lotes/.test(sql)){archivo=params[4];return [{insertId:31}];}
    if(/INSERT INTO asientos_pasivos_facturas/.test(sql)){assert.equal(params[0][0][1],'portal');assert.equal(params[0][0][2],71);return [{}];}
    if(/INSERT INTO prov_auditoria/.test(sql)){assert.equal(params[0],71);assert.match(params[2],/#31/);return [{}];}
    throw Error(sql);
  };
  try{
    const lista=await request('GET','/facturas/asientos',{role:'CONTABILIDAD'});assert.equal(lista.locals.facturas[0].tipo,'portal');
    const r=await request('POST','/facturas/asientos',{role:'CONTABILIDAD',body:{factura_ref:'portal:71'}});assert.equal(r.redirect,'/compras/facturas/asientos?creado=31');assert.equal(committed,true);
    const w=new ExcelJS.Workbook();await w.xlsx.load(archivo);assert.equal(w.getWorksheet('01').getCell('D2').value,113);assert.equal(w.getWorksheet('01').getCell('K2').value,'PORTAL-71');
  }finally{portal.obtener=original;}
});
