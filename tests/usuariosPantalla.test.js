const { test } = require("node:test");
const assert = require("node:assert/strict");
const { departamentosInicialesPorRol } = require("../src/utils/departamentos");
const { esCuentaPantalla, restringirCuentaPantalla } = require("../src/utils/usuariosPantalla");

test("screen users are restricted to read-only dashboard routes", () => {
  const request = (rol, method, path) => {
    let status;
    let body;
    let redirect;
    let continued = false;
    const req = { method, path, session: { user: { rol } } };
    const res = {
      status(value) { status = value; return this; },
      send(value) { body = value; return this; },
      redirect(value) { redirect = value; return this; }
    };
    restringirCuentaPantalla(req, res, () => { continued = true; });
    return { status, body, redirect, continued };
  };

  for (const rol of ["PANTALLA_MECANICOS", "PANTALLA_PESADOS"]) {
    assert.equal(esCuentaPantalla({ rol }), true);
    assert.deepEqual(departamentosInicialesPorRol(rol), ["TALLER"]);
    assert.equal(request(rol, "GET", "/taller/dashboard").continued, true);
    assert.equal(request(rol, "GET", "/taller/eventos-prioridades").continued, true);
    assert.equal(request(rol, "GET", "/logout").continued, true);
    assert.equal(request(rol, "GET", "/").redirect, "/taller/dashboard");
    assert.equal(request(rol, "GET", "/dashboard").redirect, "/taller/dashboard");
    assert.equal(request(rol, "GET", "/taller/dashboard/").continued, true);
    assert.equal(request(rol, "POST", "/taller/prioridades").status, 403);
    assert.equal(request(rol, "GET", "/compras/facturas").status, 403);
  }

  assert.equal(esCuentaPantalla({ rol: "MECANICO" }), false);
  assert.equal(request("MECANICO", "POST", "/taller/prioridades").continued, true);
});
