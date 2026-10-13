const fs=require('fs');const path=require('path');const pool=require('../db');
const {desdeExcel,vincularCliente,proveedoresExcel}=require('../utils/carburacionEstaciones');
async function importarEstaciones(source) {
  if(!/^[a-f0-9]{64}$/.test(source.sha256) || !Array.isArray(source.registros))throw Error('Archivo de estaciones inválido.');
  const c=await pool.getConnection();
  try {
    await c.beginTransaction();
    const [usuarios]=await c.query(`SELECT DISTINCT uc.usuario_id id FROM usuario_cedulas uc JOIN usuario_departamentos ud
      ON ud.usuario_id=uc.usuario_id AND ud.departamento='CARBURACION' WHERE uc.persona_nombre=?`,['Fernández Mora Emily Camila']);
    if(usuarios.length!==1)throw Error('No se encontró un único perfil de Emily en Carburación.');
    const actor=usuarios[0].id;
    const [clientes]=await c.query('SELECT id,nombre FROM carburacion_clientes');
    const [proveedores]=await c.query('SELECT id,nombre FROM carburacion_proveedores');
    const [existentes]=await c.query('SELECT hoja_origen,fila_origen FROM carburacion_estaciones_registros WHERE origen_sha=?',[source.sha256]);
    const keys=new Set(existentes.map(r=>`${r.hoja_origen}:${r.fila_origen}`));
    const nuevos=source.registros.filter(r=>!keys.has(`${r.hoja}:${r.fila}`)).map(r=>({source:r,registro:desdeExcel(r)}));
    if(nuevos.length) {
      const rows=nuevos.map(({source:r,registro:d})=>[d.categoria,d.estacion,vincularCliente(d.estacion,clientes),d.ejecutivo,d.prioridad,d.estado,d.detalle,d.proveedor_texto,JSON.stringify(d.campos),JSON.stringify({encabezados:r.encabezados,valores:r.valores}),source.archivo,source.sha256,r.hoja,r.fila,actor,actor]);
      await c.query(`INSERT INTO carburacion_estaciones_registros
        (categoria,estacion,cliente_id,ejecutivo,prioridad,estado,detalle,proveedor_texto,campos_json,origen_json,archivo_origen,origen_sha,hoja_origen,fila_origen,creado_por,actualizado_por) VALUES ?`,[rows]);
      const [registrados]=await c.query('SELECT id,hoja_origen,fila_origen FROM carburacion_estaciones_registros WHERE origen_sha=?',[source.sha256]);
      const ids=new Map(registrados.map(r=>[`${r.hoja_origen}:${r.fila_origen}`,r.id]));
      const relaciones=[],historial=[];
      for(const {source:r,registro:d} of nuevos) {
        const id=ids.get(`${r.hoja}:${r.fila}`);
        proveedoresExcel(d.proveedor_texto,proveedores).forEach(p=>relaciones.push([id,p]));
        historial.push([id,'IMPORTACION',JSON.stringify(d),`Importado de ${source.archivo}, ${r.hoja}, fila ${r.fila}`,actor,'Fernández Mora Emily Camila']);
      }
      if(relaciones.length)await c.query('INSERT INTO carburacion_estaciones_proveedores (registro_id,proveedor_id) VALUES ?',[relaciones]);
      await c.query('INSERT INTO carburacion_estaciones_historial (registro_id,accion,despues_json,observacion,usuario_id,usuario_nombre) VALUES ?',[historial]);
    }
    await c.commit();
    const [resumen]=await c.query('SELECT categoria,COUNT(*) cantidad,SUM(cliente_id IS NULL) sin_vincular FROM carburacion_estaciones_registros WHERE origen_sha=? GROUP BY categoria',[source.sha256]);
    return {leidos:source.registros.length,insertados:nuevos.length,filasSinEstacion:source.omitidas.length,resumen};
  }catch(e){await c.rollback();throw e;}finally{c.release();}
}
if(require.main===module) {
  const source=JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname,'../data/carburacion_estaciones.json'),'utf8'));
  importarEstaciones(source).then(resultado=>console.log(JSON.stringify(resultado)))
    .catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(()=>pool.end());
}
module.exports={importarEstaciones};
