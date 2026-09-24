const { test } = require("node:test");
const assert = require("node:assert/strict");
const { reabrirCorteCajaChica } = require("../src/utils/cajaChicaReapertura");

function crearPool({ estado = "GENERADO", total = "30.00", documentos = [
  { id: 1, corte_id: 1, monto: "10.00", numero_factura: "A" },
  { id: 2, corte_id: 1, monto: "20.00", numero_factura: "B" }
] } = {}) {
  const consultas = [];
  let commit = false;
  let rollback = false;
  const connection = {
    beginTransaction: async () => {},
    query: async (sql, params) => {
      consultas.push({ sql, params });
      if (/SELECT id, estado, reintegro_id/.test(sql)) return [[{ id: 1, estado, reintegro_id: 7, total_documentos: total }]];
      if (/SELECT \* FROM caja_chica_documentos/.test(sql)) return [documentos];
      if (/SELECT id FROM caja_chica_reintegros/.test(sql)) return [[{ id: 7 }]];
      if (/UPDATE caja_chica_cortes/.test(sql)) return [{ affectedRows: 1 }];
      if (/UPDATE caja_chica_documentos/.test(sql)) return [{ affectedRows: documentos.length }];
      throw new Error(`Consulta inesperada: ${sql}`);
    },
    commit: async () => { commit = true; },
    rollback: async () => { rollback = true; },
    release: () => {}
  };
  const pool = {
    query: async sql => {
      if (/INFORMATION_SCHEMA/.test(sql)) return [[{ total: 1 }]];
      throw new Error(`DDL inesperado: ${sql}`);
    },
    getConnection: async () => connection
  };
  return { pool, consultas, get commit() { return commit; }, get rollback() { return rollback; } };
}

test("reapertura transaccional devuelve facturas y conserva snapshot histórico", async () => {
  const db = crearPool();
  const result = await reabrirCorteCajaChica(db.pool, { corteId: 1, usuarioId: 3, documentosEsperados: 2 });
  assert.deepEqual(result, { corteId: 1, documentos: 2, monto: 30 });
  assert.equal(db.commit, true);
  assert.equal(db.rollback, false);
  const corte = db.consultas.find(item => /UPDATE caja_chica_cortes/.test(item.sql));
  assert.equal(corte.params[0], 3);
  assert.deepEqual(JSON.parse(corte.params[1]).map(item => item.numero_factura), ["A", "B"]);
  assert.match(db.consultas.find(item => /UPDATE caja_chica_documentos/.test(item.sql)).sql, /corte_id = NULL, estado = 'CONFIRMADA'/);
  assert.equal(db.consultas.some(item => /DELETE FROM caja_chica_reintegros/.test(item.sql)), false);
});

test("reapertura no altera un corte con total o cantidad inesperada", async () => {
  for (const options of [{ total: "31.00" }, { estado: "REABIERTO" }, { documentos: [] }]) {
    const db = crearPool(options);
    await assert.rejects(reabrirCorteCajaChica(db.pool, { corteId: 1, documentosEsperados: 2 }));
    assert.equal(db.commit, false);
    assert.equal(db.rollback, true);
    assert.equal(db.consultas.some(item => /UPDATE /.test(item.sql)), false);
  }
});
