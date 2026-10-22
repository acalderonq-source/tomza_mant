const test = require('node:test');
const assert = require('node:assert/strict');
const { ipCliente, esCloudflare, usarIpCliente } = require('../src/middleware/ipCliente');

test('reconoce las redes de Cloudflare que aparecían en el panel de incidentes', () => {
  for (const ip of ['172.71.147.89', '172.68.12.99', '162.158.81.138', '104.22.1.1', '::ffff:172.70.1.1']) assert.equal(esCloudflare(ip), true, ip);
  for (const ip of ['201.191.10.20', '10.0.0.5', '127.0.0.1', 'basura']) assert.equal(esCloudflare(ip), false, ip);
});

test('usa la IP real solo si la conexión viene de Cloudflare', () => {
  assert.equal(ipCliente({ ip: '172.71.147.89', headers: { 'cf-connecting-ip': '201.191.10.20' } }), '201.191.10.20');
  // Alguien que se conecta directo no puede inventar su IP con la cabecera.
  assert.equal(ipCliente({ ip: '201.191.10.20', headers: { 'cf-connecting-ip': '8.8.8.8' } }), '201.191.10.20');
  // Una cabecera inválida no se usa.
  assert.equal(ipCliente({ ip: '172.71.147.89', headers: { 'cf-connecting-ip': 'no-es-ip' } }), '172.71.147.89');
});

test('el middleware reemplaza req.ip para todo el sistema', () => {
  const req = Object.create({ get ip() { return '162.158.81.139'; } });
  req.headers = { 'cf-connecting-ip': '2001:db8::7' };
  let siguio = false;
  usarIpCliente(req, {}, () => { siguio = true; });
  assert.equal(siguio, true);
  assert.equal(req.ip, '2001:db8::7');
});

test('la clave pública de avisos no exige sesión y la prueba masiva es solo para ADMIN', async () => {
  const router = require('../src/routes/notificaciones.routes');
  const ruta = (path, metodo) => router.stack.find(l => l.route && l.route.path === path && l.route.methods[metodo]).route.stack;
  assert.equal(ruta('/public-key', 'get').length, 1, 'sin middleware de sesión');
  const pasos = ruta('/probar', 'post');
  const ejecutar = async rol => {
    const req = { session: { user: { id: 1, rol } }, body: {} };
    const r = {};
    const res = { status(c) { r.status = c; return res; }, json(b) { r.body = b; } };
    for (const paso of pasos) { let next = false; await paso.handle(req, res, () => { next = true; }); if (!next) break; }
    return r;
  };
  const mecanico = await ejecutar('MECANICO');
  assert.equal(mecanico.status, 403);
});
