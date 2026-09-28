const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

let query;
const statements = [];
const dbPath = require.resolve("../src/db");
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (sql, params = []) => {
      statements.push({ sql, params });
      return query(sql, params);
    }
  }
};

const router = require("../src/routes/repuestosSemanales.routes");

async function postArrival(role = "BODEGUERO", body = { marcado_rojo_items: ["Filtro de aceite"] }) {
  const layer = router.stack.find(item => item.route?.path === "/:id/llegada" && item.route.methods.post);
  assert.ok(layer, "arrival route exists");
  const req = {
    params: { id: "24" },
    body,
    query: {},
    session: { user: { id: 12, rol: role, usuario: role.toLowerCase() } }
  };
  const result = { status: 200 };
  const res = {
    status(code) { result.status = code; return res; },
    send(value) { result.body = value; return res; },
    redirect(url) { result.redirect = url; return res; }
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
  query = async sql => {
    if (/^\s*CREATE TABLE IF NOT EXISTS repuestos_semanales/i.test(sql)) return [{ affectedRows: 0 }];
    if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) return [[{ total: 0, column_type: "" }]];
    if (/ALTER TABLE/.test(sql)) return [{ affectedRows: 0 }];
    if (/SELECT solicitud, no_compra/.test(sql)) return [[{ solicitud: "Filtro de aceite", no_compra: null }]];
    if (/UPDATE repuestos_semanales/.test(sql)) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected SQL: ${sql}`);
  };
});

test("bodeguero can mark arriving parts without changing purchase exclusions", async () => {
  const response = await postArrival();
  const update = statements.find(item => /UPDATE repuestos_semanales/.test(item.sql));

  assert.equal(response.status, 200);
  assert.match(response.session.success, /Llegada/);
  assert.match(update.sql, /SET marcado_rojo = \?,\s*estado = \?/);
  assert.doesNotMatch(update.sql, /no_compra\s*=/);
  assert.deepEqual(update.params.slice(0, 3), ["Filtro de aceite", "LLEGANDO", "24"]);
});

test("other roles cannot use the bodeguero arrival endpoint", async () => {
  const response = await postArrival("SUPERVISOR");
  assert.equal(response.status, 403);
  assert.equal(statements.length, 0);
});
