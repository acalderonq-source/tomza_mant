const pendientes = new WeakMap();
function asegurarEliminaciones(pool) {
  if (!pendientes.has(pool)) pendientes.set(pool, pool.query(`CREATE TABLE IF NOT EXISTS preventivos_eliminados (
    mantenimiento_id INT PRIMARY KEY, unidad_id INT NOT NULL, fecha DATE NOT NULL,
    eliminado_por INT NOT NULL, eliminado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    registro JSON NOT NULL, INDEX idx_preventivo_omitido (unidad_id,fecha)
  ) ENGINE=InnoDB`).catch(e => { pendientes.delete(pool); throw e; }));
  return pendientes.get(pool);
}
const fallo = (status,message) => Object.assign(new Error(message),{status});
async function eliminarPreventivo(pool,id,user,autorizar) {
  await asegurarEliminaciones(pool);
  const db=await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[referencia]]=await db.query('SELECT unidad_id FROM mantenimientos WHERE id=?',[id]);
    if(!referencia)throw fallo(404,'Mantenimiento no encontrado.');
    // Mismo orden de bloqueo que el generador semanal: unidad y mantenimiento.
    const [[unidad]]=await db.query('SELECT id,placa,sede FROM unidades WHERE id=? FOR UPDATE',[referencia.unidad_id]);
    if(!unidad||!autorizar(unidad))throw fallo(403,'No autorizado para esta sede.');
    const [[m]]=await db.query("SELECT *, DATE_FORMAT(fecha_programada,'%Y-%m-%d') AS fecha FROM mantenimientos WHERE id=? FOR UPDATE",[id]);
    if(!m)throw fallo(404,'Mantenimiento no encontrado.');
    if(m.unidad_id!==unidad.id)throw fallo(409,'La unidad cambió. Actualice la página.');
    if(m.tipo!=='PREVENTIVO'||m.estado!=='PROGRAMADO'||String(m.ejecucion||'').trim()||m.fecha_cierre)throw fallo(409,'Solo puede eliminar preventivos programados sin ejecución.');
    for(const tabla of ['ejecuciones','mantenimiento_mecanicos','planes_taller','reportes_supervisores']) {
      const [vinculados]=await db.query(`SELECT mantenimiento_id FROM ${tabla} WHERE mantenimiento_id=? LIMIT 1`,[id]);
      if(vinculados.length)throw fallo(409,'El preventivo tiene registros vinculados y no se puede eliminar.');
    }
    await db.query('INSERT INTO preventivos_eliminados (mantenimiento_id,unidad_id,fecha,eliminado_por,registro) VALUES (?,?,?,?,?)',[id,m.unidad_id,m.fecha,user.id,JSON.stringify(m)]);
    const [r]=await db.query("DELETE FROM mantenimientos WHERE id=? AND tipo='PREVENTIVO' AND estado='PROGRAMADO'",[id]);
    if(r.affectedRows!==1)throw fallo(409,'El mantenimiento cambió. Actualice la página.');
    await db.commit();
  } catch(e) { await db.rollback(); throw e; } finally { db.release(); }
}
module.exports={asegurarEliminaciones,eliminarPreventivo};
