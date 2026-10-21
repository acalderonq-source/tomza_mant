const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Raíz de adjuntos temporal: la prueba no toca los archivos reales del correo.
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'aceptacion-'));
process.env.UPLOAD_ROOT = raiz;
delete require.cache[require.resolve('../src/utils/uploadStorage')];
const { leerRespuesta, estadoAceptacion, registrarAceptacionesCorreo, tipoMensaje } = require('../src/utils/aceptacionReceptor');
const ejs = require('ejs');

const CLAVE = '50621102500310134988000100001010000012345123456789';
const mensaje = (extra = {}) => ({
  Clave: CLAVE, NumeroCedulaEmisor: '3101999999', NumeroCedulaReceptor: '3101349880',
  Mensaje: '1', DetalleMensaje: 'Aceptado', TotalFactura: '1130.00', FechaEmisionDoc: '2026-10-20T10:00:00-06:00',
  NumeroConsecutivoReceptor: '00100001050000000123', ...extra
});

test('lee el tipo de mensaje del consecutivo del receptor', () => {
  assert.equal(tipoMensaje('00100001050000000123'), '05');
  assert.equal(tipoMensaje('00100001070000000123'), '07');
  assert.equal(tipoMensaje('123'), '');
  assert.equal(leerRespuesta({ ...mensaje(), NumeroConsecutivoReceptor: undefined }), null, 'la respuesta a la factura del proveedor no es una aceptación de Tomza');
  assert.equal(leerRespuesta(mensaje()).tipo_mensaje, '05');
});

test('traduce la aceptación a un estado claro para Contabilidad', () => {
  assert.equal(estadoAceptacion(null).estado, 'SIN_ACEPTACION');
  assert.equal(estadoAceptacion(null).pendiente, true);
  assert.equal(estadoAceptacion({ mensaje_hacienda: 1, tipo_mensaje: '05' }).estado, 'ACEPTADA');
  assert.equal(estadoAceptacion({ mensaje_hacienda: 1, tipo_mensaje: '05' }).pendiente, false);
  assert.equal(estadoAceptacion({ mensaje_hacienda: 1, tipo_mensaje: '06' }).estado, 'ACEPTADA_PARCIAL');
  assert.equal(estadoAceptacion({ mensaje_hacienda: 1, tipo_mensaje: '07' }).estado, 'RECHAZADA_POR_TOMZA');
  assert.equal(estadoAceptacion({ mensaje_hacienda: 3, tipo_mensaje: '05' }).estado, 'MENSAJE_RECHAZADO');
});

test('registra solo respuestas firmadas a mensajes de Tomza y marca los adjuntos revisados', async () => {
  const carpeta = path.join(raiz, 'facturas-correo');
  fs.mkdirSync(carpeta, { recursive: true });
  const archivos = {
    'aaaa-1.xml': '<MensajeHacienda id="1"><NumeroConsecutivoReceptor>x</NumeroConsecutivoReceptor></MensajeHacienda>',
    'aaaa-2.xml': '<FacturaElectronica></FacturaElectronica>',
    'aaaa-3.xml': '<MensajeHacienda id="3"><NumeroConsecutivoReceptor>x</NumeroConsecutivoReceptor></MensajeHacienda>',
    'aaaa-4.xml': '<MensajeHacienda id="4"><NumeroConsecutivoReceptor>x</NumeroConsecutivoReceptor></MensajeHacienda>'
  };
  for (const [nombre, xml] of Object.entries(archivos)) fs.writeFileSync(path.join(carpeta, nombre), xml);
  const insertados = [];
  const revisados = [];
  const pool = { query: async (sql, params) => {
    if (sql.includes('FROM facturas_correo_adjuntos')) return [[{ id: 1, ruta_archivo: 'aaaa-1.xml' }, { id: 2, ruta_archivo: 'aaaa-2.xml' }, { id: 3, ruta_archivo: 'aaaa-3.xml' }, { id: 4, ruta_archivo: 'aaaa-4.xml' }]];
    if (sql.includes('FROM prov_portal_receptores')) return [[]];
    if (sql.includes('INSERT INTO hacienda_aceptaciones_receptor')) { insertados.push(params); return [{}]; }
    if (sql.includes('INSERT IGNORE INTO hacienda_aceptaciones_revisadas')) { revisados.push(params); return [{}]; }
    throw new Error(`Consulta inesperada: ${sql}`);
  } };
  const verify = async xml => {
    if (xml === archivos['aaaa-3.xml'] && verify.llamadas++ === 0) throw new Error('Firma de Hacienda inválida');
    return { mensaje: mensaje(), huella: 'huella', hash: 'a'.repeat(64) };
  };
  verify.llamadas = 0;
  // El adjunto 4 es para otra empresa: no se registra.
  const original = verify;
  const verificar = async xml => xml === archivos['aaaa-4.xml'] ? { mensaje: mensaje({ NumeroCedulaReceptor: '3999999999' }), huella: 'h', hash: 'b'.repeat(64) } : original(xml);
  const avisos = console.warn; console.warn = () => {};
  try {
    const resultado = await registrarAceptacionesCorreo(pool, verificar);
    assert.equal(resultado.aceptaciones, 1);
  } finally { console.warn = avisos; }
  assert.equal(insertados.length, 1);
  assert.equal(insertados[0][0], CLAVE);
  assert.equal(insertados[0][1], '05');
  assert.deepEqual(revisados, [[1, 1], [2, 0], [3, 1], [4, 1]]);
});

test('la bandeja muestra la aceptación y pide confirmar el pago cuando falta', async () => {
  const base = { moneda: 'CRC', pagos: [], eventos: [], control: { diferencias: [] }, factura: { numero: 'F-1', estado: 'CONCILIADA', cuenta_por_pagar: true, total: 100, fecha_vencimiento: '2026-11-01', electronica: { fecha: '2026-10-20', consecutivo: '1', clave: CLAVE, hacienda: { estado: 'ACEPTADA', ambiente: 'produccion', detalle: '' } } } };
  const html = await ejs.renderFile(path.join(__dirname, '../src/views/portal_proveedores/tabla.ejs'), {
    interno: true, puedeContabilidad: true,
    docs: [{ id: 1, datos: base, aceptacionTomza: estadoAceptacion(null) }, { id: 2, datos: base, aceptacionTomza: estadoAceptacion({ mensaje_hacienda: 1, tipo_mensaje: '05' }) }],
    saldo: () => ({ saldo: 100, pagos: 0, creditos: 0 }),
    seguimiento: () => ({}), excepciones: () => []
  }, { views: [path.join(__dirname, '../src/views/portal_proveedores')] });
  assert.match(html, /Sin aceptación de Tomza \(Creatica\)/);
  assert.match(html, /Aceptada por Tomza ante Hacienda/);
  assert.match(html, /data-sin-aceptacion="1"/);
  assert.match(html, /data-sin-aceptacion="0"/);
  assert.equal((html.match(/data-confirmar=/g) || []).length, 2, 'programar y registrar pago piden confirmación solo en la factura sin aceptación');
});
