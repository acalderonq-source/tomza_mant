const fs = require('node:fs/promises');
const path = require('node:path');
async function consultar(db, sql, params = []) {
  try { const [filas] = await db.query(sql, params); return { filas, error: null }; }
  catch (error) { console.error('Consulta del centro de control:', error.code || 'ERROR'); return { filas: [], error: 'No se pudo consultar esta seccion. Revise esquema y conexion.' }; }
}
async function estadoRespaldo(env = process.env, now = Date.now()) {
  if (!env.BACKUP_ROOT) return { estado: 'Sin configurar', fecha: null };
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(env.BACKUP_ROOT, 'ultimo-respaldo.json'), 'utf8'));
    const fecha = Date.parse(manifest.creado_en);
    if (!Number.isFinite(fecha) || fecha > now) throw Error('Fecha invalida');
    return { estado: now - fecha > 36 * 3600000 ? 'Atrasado' : 'Cifrado e integridad verificada', fecha: manifest.creado_en };
  } catch (_) { return { estado: 'Sin respaldo verificado registrado', fecha: null }; }
}
async function centroControl(db) {
  const [operaciones, auditoria, correos, inventario, preventivos, minae, respaldo] = await Promise.all([
    consultar(db, 'SELECT actor,ruta,estado,respuesta,creado_en FROM empresa_operaciones ORDER BY creado_en DESC LIMIT 100'),
    consultar(db, 'SELECT usuario_nombre,accion,tabla_afectada,registro_id,antes,despues,creado_en FROM auditoria_sistema ORDER BY id DESC LIMIT 100'),
    consultar(db, "SELECT proveedor_nombre,estado,intentos,enviado_en FROM colillas_pago_envios WHERE estado <> 'ENVIADO' ORDER BY id DESC LIMIT 100"),
    consultar(db, 'SELECT nombre,stock_actual,stock_minimo FROM bodega_articulos WHERE activo=1 AND stock_actual <= stock_minimo ORDER BY stock_actual,nombre LIMIT 100'),
    consultar(db, "SELECT u.placa,u.sede,m.fecha_programada,m.estado FROM mantenimientos m JOIN unidades u ON u.id=m.unidad_id WHERE m.fecha_programada < CURDATE() AND UPPER(m.estado) NOT IN ('CERRADO','REALIZADO','FINALIZADO','COMPLETADO','CANCELADO') ORDER BY m.fecha_programada LIMIT 100"),
    consultar(db, 'SELECT u.placa,t.sede,t.tipo,t.estado,t.vencimiento FROM minae_tramites t JOIN unidades u ON u.id=t.unidad_id WHERE t.vencimiento <= DATE_ADD(CURDATE(),INTERVAL 30 DAY) ORDER BY t.vencimiento DESC LIMIT 100'),
    estadoRespaldo()
  ]);
  return { respaldo, secciones: [
    { titulo: 'Solicitudes protegidas (ultimas 100)', ...operaciones },
    { titulo: 'Bitacora de cambios (ultimos 100)', ...auditoria },
    { titulo: 'Correos de colillas pendientes o con error (hasta 100)', ...correos },
    { titulo: 'Existencias en minimo o agotadas (hasta 100)', ...inventario },
    { titulo: 'Mantenimientos vencidos segun estado registrado (hasta 100)', ...preventivos },
    { titulo: 'MINAE vencido o por vencer en 30 dias (hasta 100)', ...minae }
  ] };
}
async function expediente(db, placa) {
  const unidad = await consultar(db, 'SELECT id,placa,sede,activa,varada,marca,modelo,anio FROM unidades WHERE placa=? LIMIT 1', [placa]);
  if (unidad.error || !unidad.filas.length) return { unidad, secciones: [] };
  const id = unidad.filas[0].id;
  const definiciones = [
    ['Mantenimientos', 'SELECT id,fecha_programada,tipo,estado,plan,ejecucion,pendiente FROM mantenimientos WHERE unidad_id=? ORDER BY fecha_programada DESC LIMIT 100', id],
    ['Trabajos correctivos', 'SELECT id,fecha,tipo_mantenimiento,trabajo_realizado,pendiente FROM correctivos WHERE unidad_id=? ORDER BY fecha DESC LIMIT 100', id],
    ['Ordenes de compra (importes por moneda; no sumarlos entre monedas)', 'SELECT id,po_numero,fecha,moneda,total,facturada,pagada,fecha_pago FROM ordenes_compra WHERE placa_unidad=? ORDER BY id DESC LIMIT 100', placa],
    ['Cambios de aceite', 'SELECT id,fecha,galones,sede FROM cambios_aceite WHERE unidad_id=? ORDER BY fecha DESC LIMIT 100', id],
    ['Solicitudes de llantas', 'SELECT id,sede,estado FROM solicitudes_llantas WHERE unidad_id=? ORDER BY id DESC LIMIT 100', id],
    ['DEKRA', 'SELECT id,mes,estado,cita_fecha,cita_hora,estado_segunda,cita_fecha_segunda,cita_hora_segunda FROM dekra_control WHERE unidad_id=? ORDER BY id DESC LIMIT 100', id],
    ['MINAE', 'SELECT id,tipo,estado,vencimiento FROM minae_tramites WHERE unidad_id=? ORDER BY vencimiento DESC LIMIT 100', id],
    ['Movimientos de bodega', 'SELECT id,articulo_id,tipo_movimiento,cantidad,sede FROM bodega_movimientos WHERE placa=? ORDER BY id DESC LIMIT 100', placa]
  ];
  const secciones = await Promise.all(definiciones.map(async ([titulo, sql, value]) => ({ titulo: titulo + ' (hasta 100 registros)', ...await consultar(db, sql, [value]) })));
  return { unidad, secciones };
}
module.exports = { consultar, estadoRespaldo, centroControl, expediente };
