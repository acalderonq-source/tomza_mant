const { test } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../src/db");
const router = require("../src/routes/lavadoUnidades.routes");

const postHandler = router.stack.find(layer => layer.route?.path === "/" && layer.route.methods.post).route.stack.at(-1).handle;
const user = { id: 5, usuario: "taller", rol: "TALLER", sede: "Cartago" };

function requestBody() {
  const fotos_base64 = {};
  const fotos_nombre = {};
  const fotos_tipo = {};
  for (const [index, clave] of ["adelante", "medio_izquierdo", "medio_derecho", "atras", "cabina"].entries()) {
    fotos_base64[clave] = `data:image/jpeg;base64,${Buffer.from(`foto-${index}`).toString("base64")}`;
    fotos_nombre[clave] = `${clave}.jpg`;
    fotos_tipo[clave] = "image/jpeg";
  }
  return {
    fecha: "2026-09-22",
    unidad_id: "17",
    fotos_base64,
    fotos_nombre,
    fotos_tipo
  };
}

async function invoke(poolHandlers) {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  pool.query = poolHandlers.query;
  pool.getConnection = poolHandlers.getConnection;
  const result = { status: 200 };
  const res = {
    status(code) { result.status = code; return this; },
    send(value) { result.body = value; return this; },
    redirect(url) { result.status = 302; result.redirect = url; return this; },
    setHeader() {},
    end() {}
  };
  try {
    await postHandler({
      body: requestBody(),
      query: {},
      session: { user, sedeSeleccionada: "Cartago" }
    }, res);
    return result;
  } finally {
    pool.query = originalQuery;
    pool.getConnection = originalGetConnection;
  }
}

function createConnection({ duplicate = null } = {}) {
  const calls = [];
  const state = { calls, committed: false, rolledBack: false, released: false };
  state.connection = {
    async beginTransaction() {},
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM unidades") && sql.includes("FOR UPDATE")) {
        return [[{ id: 17, placa: "C164528", sede: "Cartago" }]];
      }
      if (sql.includes("FROM lavado_unidades") && sql.includes("FOR UPDATE")) {
        return [[...(duplicate ? [duplicate] : [])]];
      }
      if (sql.includes("MAX(CAST(SUBSTRING_INDEX")) return [[{ siguiente: 1 }]];
      if (sql.includes("INSERT INTO lavado_unidades\n")) return [{ insertId: 91 }];
      if (sql.includes("INSERT INTO lavado_unidades_fotos")) return [{ affectedRows: 1 }];
      throw new Error(`Consulta transaccional inesperada: ${sql}`);
    },
    async commit() { state.committed = true; },
    async rollback() { state.rolledBack = true; },
    release() { state.released = true; }
  };
  return state;
}

function poolQueries() {
  return async sql => {
    if (sql.includes("CREATE TABLE IF NOT EXISTS")) return [{}];
    if (sql.includes("FROM unidades") && !sql.includes("FOR UPDATE")) {
      return [[{ id: 17, placa: "C164528", sede: "Cartago" }]];
    }
    if (sql.includes("WHERE lf.foto_hash IN (?)")) return [[]];
    throw new Error(`Consulta inesperada: ${sql}`);
  };
}

test("lavado guarda fotos y unidad dentro de la transacción tras bloquear la unidad", async () => {
  const tx = createConnection();
  const result = await invoke({
    query: poolQueries(),
    getConnection: async () => tx.connection
  });

  assert.equal(result.status, 302);
  assert.match(result.redirect, /success=/);
  assert.equal(tx.committed, true);
  assert.equal(tx.rolledBack, false);
  assert.equal(tx.released, true);
  const lockIndex = tx.calls.findIndex(call => call.sql.includes("FROM unidades") && call.sql.includes("FOR UPDATE"));
  const duplicateIndex = tx.calls.findIndex(call => call.sql.includes("FROM lavado_unidades") && call.sql.includes("FOR UPDATE"));
  assert.ok(lockIndex >= 0 && duplicateIndex > lockIndex);
  assert.equal(tx.calls.filter(call => call.sql.includes("INSERT INTO lavado_unidades_fotos")).length, 5);
});

test("lavado repetido de la unidad en la misma semana se revierte antes de insertar", async () => {
  const tx = createConnection({ duplicate: { numero_lavado: "LAV-2026-0021" } });
  const result = await invoke({
    query: poolQueries(),
    getConnection: async () => tx.connection
  });

  assert.equal(result.status, 302);
  assert.match(decodeURIComponent(result.redirect), /ya fue registrada esta semana/);
  assert.equal(tx.committed, false);
  assert.equal(tx.rolledBack, true);
  assert.equal(tx.released, true);
  assert.equal(tx.calls.some(call => call.sql.includes("INSERT INTO lavado_unidades\n")), false);
  assert.equal(tx.calls.some(call => call.sql.includes("INSERT INTO lavado_unidades_fotos")), false);
});
