async function bloquearNumeroOrden(connection) {
  const nombre = 'gas_tomza:numero_orden_compra';
  const [[row]] = await connection.query('SELECT GET_LOCK(?, 5) AS adquirido', [nombre]);
  if (Number(row?.adquirido) !== 1) throw Object.assign(new Error('Otra orden se está guardando. Intente nuevamente en unos segundos.'), { status: 503 });
  let liberado = false;
  return async () => {
    if (liberado) return;
    liberado = true;
    try { await connection.query('SELECT RELEASE_LOCK(?)', [nombre]); }
    catch (error) {
      // No devolver al pool una conexion que pueda conservar el bloqueo de numeracion.
      if (typeof connection.destroy === 'function') connection.destroy();
      console.error('No se pudo liberar el bloqueo de numeración:', error.code || error.message);
    }
  };
}
module.exports = { bloquearNumeroOrden };
