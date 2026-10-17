const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { huella, protegerOperaciones, rutaProtegida } = require('../src/utils/operacionesEmpresa');
const token = '12345678-1234-1234-1234-123456789abc';
function response() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.status = n => { res.statusCode = n; return res; };
  res.json = body => { res.body = body; return res; };
  res.sendStatus = n => res.status(n);
  return res;
}
function request(body = {}, rol = 'ADMIN', path = '/compras/ordenes') {
  return { method: 'POST', path, body, get: () => undefined, session: { user: { id: 1, rol, nombre: 'Persona de prueba' } } };
}
test('huella estable sin depender del orden de campos ni CSRF', () => {
  assert.equal(huella({ a: 1, b: 2, _csrf: 'uno' }), huella({ b: 2, a: 1, _csrf: 'dos' }));
  assert.notEqual(huella({ monto: 1 }), huella({ monto: 2 }));
});
test('solo protege altas y tres rutas financieras, no consultas ni ediciones ajenas', () => {
  assert.ok(rutaProtegida('/compras/facturas/12/abono'));
  assert.ok(rutaProtegida('/compras/ordenes/consignacion-consumo'));
  assert.equal(rutaProtegida('/compras/proveedores'), false);
});
test('bloquea token ausente y rol sin permisos antes de consultar DB', async () => {
  const guard = protegerOperaciones({ query: () => { throw Error('No consultar'); } });
  const res = response(); await guard(request(), res, () => assert.fail()); assert.equal(res.statusCode, 428);
  const forbidden = response(); await guard(request({ _operacion: token }, 'MECANICO'), forbidden, () => assert.fail());
  assert.equal(forbidden.statusCode, 403);
});
test('una solicitud concurrente con el mismo token no ejecuta el negocio dos veces', async () => {
  const claves = new Set(), registros = [];
  const db = { query: async (sql, params) => {
    if (sql.startsWith('INSERT INTO')) {
      if (claves.has(params[0])) throw Object.assign(Error('repetido'), { code: 'ER_DUP_ENTRY' });
      claves.add(params[0]); registros.push(params);
    }
    return [{}];
  } };
  const guard = protegerOperaciones(db); let ejecutadas = 0;
  const a = response(), b = response();
  await Promise.all([guard(request({ _operacion: token }), a, () => ejecutadas++), guard(request({ _operacion: token }), b, () => ejecutadas++)]);
  assert.equal(ejecutadas, 1); assert.equal(b.statusCode, 409);
  assert.equal(registros[0][3], 'Persona de prueba');
  a.emit('finish');
});
test('pago con otro pago activo falla sin reservar identificador', async () => {
  let released = false, inserted = false;
  const db = { query: async sql => { if (sql.startsWith('INSERT')) inserted = true; return [[]]; },
    getConnection: async () => ({ query: async () => [[{ adquirido: 0 }]], release: () => { released = true; } }) };
  const res = response();
  await protegerOperaciones(db)(request({ _operacion: token }, 'ADMIN', '/compras/facturas/pagar-multiple'), res, () => assert.fail());
  assert.equal(res.statusCode, 409); assert.ok(released); assert.equal(inserted, false);
});
test('error de DB impide ejecutar negocio', async () => {
  const res = response();
  await protegerOperaciones({ query: async () => { throw Error('sin conexion'); } })(request({ _operacion: token }), res, () => assert.fail());
  assert.equal(res.statusCode, 503);
});
test('al terminar o cortar un pago libera el bloqueo una sola vez', async () => {
  let releases = 0, unlocks = 0;
  const db = { query: async () => [{}], getConnection: async () => ({
    query: async sql => { if (sql.includes('RELEASE_LOCK')) unlocks++; return [[{ adquirido: 1 }]]; },
    release: () => releases++, destroy: () => assert.fail('No destruir conexion sana')
  }) };
  const res = response(); let negocio = false;
  await protegerOperaciones(db)(request({ _operacion: token }, 'ADMIN', '/compras/facturas/1/pagar'), res, () => { negocio = true; });
  assert.ok(negocio); res.emit('finish'); res.emit('close');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(releases, 1); assert.equal(unlocks, 1);
});
