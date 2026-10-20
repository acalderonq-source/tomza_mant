const {exigir}=require('./proveeduria');
const {aprobable}=require('./proveedorHacienda');
const {revisarFactura,exigirControl}=require('./portalControlFactura');
const version=f=>require('node:crypto').createHash('sha256').update(JSON.stringify(f)).digest('hex');
async function validarYAprobar(db,row){
  const f=row.datos.factura;
  exigir(row.tipo==='factura_portal','La aceptación aplica únicamente a facturas del portal');
  exigir(f.estado==='PENDIENTE','Factura ya revisada');
  row.datos.control=await revisarFactura(db,row,true);exigirControl(row.datos.control);aprobable(f);
  f.estado='CONCILIADA';f.cuenta_por_pagar=true;f.aprobada_en=new Date().toISOString();
}
async function aprobar(db,id,actor,esperada){
  const [rows]=await db.query("SELECT * FROM prov_documentos WHERE id=? AND tipo='factura_portal' FOR UPDATE",[id]);
  exigir(rows.length===1,'Factura del portal no encontrada');
  const row=rows[0];row.datos=typeof row.datos==='string'?JSON.parse(row.datos):row.datos;
  // Reenviar el mismo formulario no vuelve a aprobar ni duplica la auditoría.
  if(row.datos.factura.estado==='CONCILIADA'&&row.datos.factura.cuenta_por_pagar)return false;
  exigir(esperada&&esperada===version(row.datos.factura),'La factura cambió. Recargue y revise los datos antes de aceptar');
  await validarYAprobar(db,row);
  (row.datos.eventos??=[]).push({accion:'aprobar',actor,fecha:new Date().toISOString()});
  await db.query('UPDATE prov_documentos SET datos=? WHERE id=?',[JSON.stringify(row.datos),row.id]);
  await db.query('INSERT INTO prov_auditoria (documento_id,actor,accion) VALUES (?,?,?)',[row.id,String(actor),'Portal proveedor: aprobar desde cuentas por pagar']);
  return true;
}
module.exports={validarYAprobar,aprobar,version};
