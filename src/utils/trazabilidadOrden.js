const ROLES_FINANCIEROS = new Set(['ADMIN','TALLER','PROVEEDURIA_TALLER','CONTABILIDAD']);

async function cargarTrazabilidadOrden(db, orden, user) {
  const financiero = ROLES_FINANCIEROS.has(user?.rol);
  const resultado = {
    financiero,
    recibida: Number(orden.factura_producto_recibido) === 1,
    facturada: Number(orden.facturada) === 1 && Boolean(String(orden.factura || '').trim()),
    pagos: [], asientos: [], advertencias: []
  };
  if (!financiero) return resultado;
  try {
    const [rows] = await db.query(`SELECT id,recibo_numero,fecha_pago,tipo_pago,facturas_json
      FROM colillas_pago_proveedor
      WHERE JSON_CONTAINS(CASE WHEN JSON_VALID(facturas_json) THEN facturas_json ELSE '[]' END, ?)
      ORDER BY fecha_pago DESC,id DESC LIMIT 100`, [JSON.stringify({tipo:'orden',factura_id:Number(orden.id)})]);
    for (const row of rows) {
      const facturas = typeof row.facturas_json === 'string' ? JSON.parse(row.facturas_json) : row.facturas_json;
      const propias = Array.isArray(facturas) ? facturas.filter(f=>f.tipo==='orden' && Number(f.factura_id)===Number(orden.id)) : [];
      if (!propias.length) continue;
      const valores = propias.map(f=>f.monto_pago === null || f.monto_pago === undefined || f.monto_pago === '' ? NaN : Number(f.monto_pago));
      resultado.pagos.push({id:row.id,numero:row.recibo_numero,fecha:row.fecha_pago,tipo:row.tipo_pago,
        monto:valores.every(n=>Number.isFinite(n)&&n>=0) ? valores.reduce((s,n)=>s+n,0) : null});
    }
  } catch (error) {
    console.error('Trazabilidad de pagos no disponible:', error.code || error.message);
    resultado.advertencias.push('No se pudo consultar el historial de pagos de esta orden.');
  }
  try {
    const [rows] = await db.query("SELECT lote_id,numero_factura,fecha_factura,monto_asiento FROM asientos_pasivos_facturas WHERE factura_tipo='orden' AND factura_id=? ORDER BY lote_id DESC LIMIT 20",[orden.id]);
    resultado.asientos = rows;
  } catch (error) {
    console.error('Trazabilidad de asientos no disponible:', error.code || error.message);
    resultado.advertencias.push('No se pudieron consultar los asientos relacionados.');
  }
  return resultado;
}

module.exports = { cargarTrazabilidadOrden };
