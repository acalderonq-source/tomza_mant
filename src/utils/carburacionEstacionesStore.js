const pool=require('../db');
const {fallo}=require('./carburacionFinanzas');
const {validarRegistro,parseJSON}=require('./carburacionEstaciones');
async function guardarRegistro(id,body,user) {
  const connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    let antes=null;
    if(id) {
      [[antes]]=await connection.query('SELECT * FROM carburacion_estaciones_registros WHERE id=? FOR UPDATE',[id]);
      if(!antes)throw fallo('Registro de estación no encontrado.',404);
      if(!Number.isInteger(Number(body.version)) || Number(body.version)!==antes.version)throw fallo('Otra persona actualizó este registro. Vuelva a abrirlo antes de guardar.',409);
    }
    const datos=validarRegistro(body,antes?.categoria || body.categoria);
    let clienteId=null;
    if(body.cliente_id) {
      const [[cliente]]=await connection.query('SELECT id FROM carburacion_clientes WHERE id=?',[body.cliente_id]);
      if(!cliente)throw fallo('Seleccione un cliente válido de Carburación.');clienteId=cliente.id;
    }
    const raw=Array.isArray(body.proveedor_ids)?body.proveedor_ids:body.proveedor_ids?[body.proveedor_ids]:[];
    if(raw.length>20 || raw.some(p=>!/^[1-9]\d*$/.test(String(p))))throw fallo('Seleccione proveedores válidos.');
    const proveedoresIds=[...new Set(raw.map(Number))];let proveedores=[];
    if(proveedoresIds.length) {
      [proveedores]=await connection.query(`SELECT id,nombre FROM carburacion_proveedores WHERE id IN (${proveedoresIds.map(()=>'?').join(',')}) ORDER BY nombre`,proveedoresIds);
      if(proveedores.length!==proveedoresIds.length)throw fallo('Un proveedor no pertenece a Carburación.');
    }
    const proveedorTexto=proveedores.map(p=>p.nombre).join(', ');
    if(proveedorTexto.length>500)throw fallo('La lista de proveedores es demasiado extensa.');
    const despues={...datos,cliente_id:clienteId,proveedor_texto:proveedorTexto,proveedor_ids:proveedoresIds};
    if(antes) {
      const [links]=await connection.query('SELECT proveedor_id FROM carburacion_estaciones_proveedores WHERE registro_id=?',[id]);
      antes={...antes,campos:parseJSON(antes.campos_json),proveedor_ids:links.map(p=>p.proveedor_id)};
      await connection.query(`UPDATE carburacion_estaciones_registros SET estacion=?,cliente_id=?,ejecutivo=?,prioridad=?,estado=?,detalle=?,proveedor_texto=?,campos_json=?,
        actualizado_por=?,actualizado_en=CURRENT_TIMESTAMP,version=version+1 WHERE id=?`,
      [datos.estacion,clienteId,datos.ejecutivo,datos.prioridad,datos.estado,datos.detalle,proveedorTexto,JSON.stringify(datos.campos),user.id,id]);
      await connection.query('DELETE FROM carburacion_estaciones_proveedores WHERE registro_id=?',[id]);
    } else {
      const [result]=await connection.query(`INSERT INTO carburacion_estaciones_registros
        (categoria,estacion,cliente_id,ejecutivo,prioridad,estado,detalle,proveedor_texto,campos_json,creado_por,actualizado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [datos.categoria,datos.estacion,clienteId,datos.ejecutivo,datos.prioridad,datos.estado,datos.detalle,proveedorTexto,JSON.stringify(datos.campos),user.id,user.id]);
      id=result.insertId;
    }
    if(proveedoresIds.length)await connection.query('INSERT INTO carburacion_estaciones_proveedores (registro_id,proveedor_id) VALUES ?',[proveedoresIds.map(p=>[id,p])]);
    await connection.query(`INSERT INTO carburacion_estaciones_historial (registro_id,accion,antes_json,despues_json,observacion,usuario_id,usuario_nombre)
      VALUES (?,?,?,?,?,?,?)`,[id,antes?'ACTUALIZACION':'CREACION',antes?JSON.stringify(antes):null,JSON.stringify(despues),String(body.motivo || '').trim().slice(0,1000),user.id,String(user.nombre || user.usuario || 'Carburación').slice(0,160)]);
    await connection.commit();return id;
  }catch(e){await connection.rollback();throw e;}finally{connection.release();}
}
module.exports={guardarRegistro};
