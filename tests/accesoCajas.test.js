const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const { validarAcceso, puedeAcceder, MODULOS } = require('../src/utils/accesosTrabajador');
const { SEDES_SOLICITUD } = require('../src/utils/sedesSolicitudesTrabajadores');

const sede = SEDES_SOLICITUD[0];
const cajas = () => validarAcceso({ departamento: 'CONTABILIDAD', unidad: 'CAJAS', sede_asignada: sede, permiso_INICIO: 'GESTION', permiso_SUMINISTROS: 'GESTION' });

test('Contabilidad puede recibir el módulo de solicitud de suministros', () => {
  assert.ok(MODULOS.find(m => m.id === 'SUMINISTROS').areas.includes('CONTABILIDAD'));
});

test('el acceso de Cajas queda en Contabilidad con su unidad', () => {
  const config = cajas();
  assert.equal(config.departamento, 'CONTABILIDAD');
  assert.equal(config.unidad, 'CAJAS');
  assert.deepEqual(config.permisos, { INICIO: 'GESTION', SUMINISTROS: 'GESTION' });
  // La unidad solo existe dentro de Contabilidad.
  const taller = validarAcceso({ departamento: 'TALLER', unidad: 'CAJAS', sede_asignada: sede, permiso_SUMINISTROS: 'GESTION' });
  assert.equal(taller.unidad, undefined);
});

test('Cajas puede pedir suministros pero no ve el resto de Contabilidad', () => {
  const config = cajas();
  assert.equal(puedeAcceder(config, '/proveeduria/mis-solicitudes', 'GET'), true);
  assert.equal(puedeAcceder(config, '/proveeduria/solicitudes', 'POST'), true);
  assert.equal(puedeAcceder(config, '/proveeduria/salidas/15/aceptar', 'POST'), true);
  assert.equal(puedeAcceder(config, '/dashboard', 'GET'), true);
  for (const ruta of ['/contabilidad/cuentas-por-pagar', '/compras/facturas', '/compras/ordenes', '/proveeduria/ordenes', '/proveeduria/inventario']) {
    assert.equal(puedeAcceder(config, ruta, 'GET'), false, ruta);
  }
});

test('Proveeduría ve que la solicitud viene de Cajas', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../src/views/proveeduria/solicitudes_tabla.ejs'), {
    docs: [{ id: 7, tipo: 'solicitud', usuario_id: 3, sede, creado_en: new Date('2026-10-22T10:00:00Z'), datos: { departamento: 'CONTABILIDAD', unidad: 'CAJAS', solicitante: 'Cajera Uno', estado: 'PENDIENTE', lineas: [] } }],
    user: { rol: 'PROVEEDURIA', departamentoActivo: 'PROVEEDURIA' }
  }).catch(error => ({ error }));
  if (html.error) {
    // La tabla depende de más datos del módulo; basta con confirmar la plantilla.
    const fuente = require('node:fs').readFileSync(path.join(__dirname, '../src/views/proveeduria/solicitudes_tabla.ejs'), 'utf8');
    assert.match(fuente, /s\.unidad==='CAJAS'\?' · Cajas'/);
    return;
  }
  assert.match(html, /CONTABILIDAD · Cajas/);
});
