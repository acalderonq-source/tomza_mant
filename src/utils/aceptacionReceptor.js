// Aceptación de facturas que Tomza envía a Hacienda desde Creatica.
// Hacienda responde por correo con un MensajeHacienda firmado que incluye
// NumeroConsecutivoReceptor; aquí se guarda por la clave de la factura.
const fs = require('node:fs');
const path = require('node:path');
const { UPLOAD_ROOT } = require('./uploadStorage');

const RECEPTORES_TOMZA = ['3101349880', '3101044021'];
const LOTE = 300;
const sinCeros = valor => String(valor || '').trim().replace(/^0+/, '');

// Tipo de documento dentro del consecutivo: 05 acepta, 06 acepta en parte, 07 rechaza.
function tipoMensaje(consecutivo) {
  return /^\d{20}$/.test(consecutivo) ? consecutivo.slice(8, 10) : '';
}

function leerRespuesta(mensaje) {
  const consecutivo = String(mensaje?.NumeroConsecutivoReceptor || '').trim();
  const tipo = tipoMensaje(consecutivo);
  if (!['05', '06', '07'].includes(tipo) || !/^506\d{47}$/.test(String(mensaje.Clave || ''))) return null;
  const total = Number(mensaje.TotalFactura);
  return {
    clave: String(mensaje.Clave),
    tipo_mensaje: tipo,
    mensaje_hacienda: Number(mensaje.Mensaje),
    consecutivo_receptor: consecutivo,
    cedula_emisor: sinCeros(mensaje.NumeroCedulaEmisor) || null,
    cedula_receptor: sinCeros(mensaje.NumeroCedulaReceptor) || null,
    total_factura: Number.isFinite(total) ? total : null,
    fecha_documento: String(mensaje.FechaEmisionDoc || '').slice(0, 40) || null,
    detalle: typeof mensaje.DetalleMensaje === 'string' ? mensaje.DetalleMensaje.slice(0, 2000) : null
  };
}

function estadoAceptacion(registro) {
  if (!registro) return { estado: 'SIN_ACEPTACION', texto: 'Sin aceptación de Tomza (Creatica)', clase: 'text-bg-danger', pendiente: true };
  if (Number(registro.mensaje_hacienda) !== 1) return { estado: 'MENSAJE_RECHAZADO', texto: 'Hacienda rechazó el mensaje de Creatica: debe reenviarse', clase: 'text-bg-danger', pendiente: true };
  if (registro.tipo_mensaje === '05') return { estado: 'ACEPTADA', texto: 'Aceptada por Tomza ante Hacienda', clase: 'text-bg-success', pendiente: false };
  if (registro.tipo_mensaje === '06') return { estado: 'ACEPTADA_PARCIAL', texto: 'Aceptada parcialmente por Tomza', clase: 'text-bg-warning', pendiente: false };
  return { estado: 'RECHAZADA_POR_TOMZA', texto: 'Rechazada por Tomza ante Hacienda', clase: 'text-bg-danger', pendiente: true };
}

async function receptoresPermitidos(pool) {
  const permitidos = new Set(RECEPTORES_TOMZA);
  try {
    const [rows] = await pool.query('SELECT cedula FROM prov_portal_receptores WHERE activo = 1');
    rows.forEach(row => permitidos.add(sinCeros(row.cedula)));
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
  }
  return permitidos;
}

// Revisa los XML del correo que aún no se han revisado y guarda las respuestas firmadas.
async function registrarAceptacionesCorreo(pool, verify) {
  try {
    return await registrarPendientes(pool, verify);
  } catch (error) {
    // Sin la migración 202610210005 no hay dónde guardar: se omite sin afectar el correo.
    if (error.code === 'ER_NO_SUCH_TABLE') return { aceptaciones: 0, sinTabla: true };
    throw error;
  }
}

async function registrarPendientes(pool, verify) {
  const [adjuntos] = await pool.query(`SELECT a.id, a.ruta_archivo FROM facturas_correo_adjuntos a
    LEFT JOIN hacienda_aceptaciones_revisadas r ON r.adjunto_correo_id = a.id
    WHERE a.tipo_documento = 'XML' AND r.adjunto_correo_id IS NULL
    ORDER BY a.id LIMIT ${LOTE}`);
  if (!adjuntos.length) return { aceptaciones: 0 };
  const permitidos = await receptoresPermitidos(pool);
  let aceptaciones = 0;
  for (const adjunto of adjuntos) {
    let revisado = true;
    let esReceptor = 0;
    try {
      if (!/^[a-f\d-]+\.xml$/i.test(adjunto.ruta_archivo || '')) continue;
      const archivo = path.join(UPLOAD_ROOT, 'facturas-correo', adjunto.ruta_archivo);
      if (!fs.existsSync(archivo) || fs.statSync(archivo).size > 2 * 1024 * 1024) continue;
      const xml = fs.readFileSync(archivo, 'utf8');
      if (!xml.includes('MensajeHacienda') || !xml.includes('NumeroConsecutivoReceptor')) continue;
      esReceptor = 1;
      let resultado;
      try {
        resultado = await verify(xml);
      } catch (error) {
        // Una falla de red al consultar revocación se reintenta en la próxima sincronización.
        revisado = !/revocaci|CRL|fetch|timeout|ECONN|ENOTFOUND/i.test(error.message || '');
        console.warn('Aceptación de Creatica sin verificar:', adjunto.id, error.message);
        continue;
      }
      const datos = leerRespuesta(resultado.mensaje);
      if (!datos || !permitidos.has(datos.cedula_receptor)) continue;
      // Si ya hay una aceptación válida, una respuesta posterior rechazada no la sustituye.
      await pool.query(`INSERT INTO hacienda_aceptaciones_receptor
        (clave, tipo_mensaje, mensaje_hacienda, consecutivo_receptor, cedula_emisor, cedula_receptor, total_factura, fecha_documento, detalle, adjunto_correo_id, huella_firmante, hash_respuesta)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          tipo_mensaje = IF(mensaje_hacienda = 1 AND VALUES(mensaje_hacienda) <> 1, tipo_mensaje, VALUES(tipo_mensaje)),
          consecutivo_receptor = IF(mensaje_hacienda = 1 AND VALUES(mensaje_hacienda) <> 1, consecutivo_receptor, VALUES(consecutivo_receptor)),
          detalle = IF(mensaje_hacienda = 1 AND VALUES(mensaje_hacienda) <> 1, detalle, VALUES(detalle)),
          adjunto_correo_id = IF(mensaje_hacienda = 1 AND VALUES(mensaje_hacienda) <> 1, adjunto_correo_id, VALUES(adjunto_correo_id)),
          huella_firmante = IF(mensaje_hacienda = 1 AND VALUES(mensaje_hacienda) <> 1, huella_firmante, VALUES(huella_firmante)),
          hash_respuesta = IF(mensaje_hacienda = 1 AND VALUES(mensaje_hacienda) <> 1, hash_respuesta, VALUES(hash_respuesta)),
          mensaje_hacienda = IF(mensaje_hacienda = 1 AND VALUES(mensaje_hacienda) <> 1, mensaje_hacienda, VALUES(mensaje_hacienda))`,
      [datos.clave, datos.tipo_mensaje, datos.mensaje_hacienda, datos.consecutivo_receptor, datos.cedula_emisor, datos.cedula_receptor,
        datos.total_factura, datos.fecha_documento, datos.detalle, adjunto.id, resultado.huella, resultado.hash]);
      aceptaciones += 1;
    } finally {
      if (revisado) await pool.query('INSERT IGNORE INTO hacienda_aceptaciones_revisadas (adjunto_correo_id, es_respuesta_receptor) VALUES (?, ?)', [adjunto.id, esReceptor]);
    }
  }
  return { aceptaciones };
}

async function aceptacionesPorClave(pool, claves) {
  const lista = [...new Set(claves.filter(clave => /^\d{50}$/.test(String(clave || ''))))];
  if (!lista.length) return new Map();
  const [rows] = await pool.query(`SELECT clave, tipo_mensaje, mensaje_hacienda, consecutivo_receptor, fecha_documento, registrado_en, actualizado_en
    FROM hacienda_aceptaciones_receptor WHERE clave IN (${lista.map(() => '?').join(',')})`, lista);
  return new Map(rows.map(row => [row.clave, row]));
}

module.exports = { leerRespuesta, estadoAceptacion, registrarAceptacionesCorreo, aceptacionesPorClave, tipoMensaje };
