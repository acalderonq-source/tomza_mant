const id=v=>String(v||'').replace(/\D/g,'').replace(/^0+/,'');
async function ordenesDisponibles(db,cedula){
  // La identidad fiscal limita la consulta antes de exponer cualquier OC al proveedor.
  const filtro="TRIM(LEADING '0' FROM REGEXP_REPLACE(%s,'[^0-9]',''))=?";
  const [pr]=await db.query(`SELECT d.id,d.datos FROM prov_documentos d WHERE d.tipo='oc' AND (
    ${filtro.replace('%s',"JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.proveedor_cedula'))")} OR (
    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.proveedor_cedula')),'')='' AND EXISTS (
      SELECT 1 FROM prov_proveedores p JOIN prov_portal_cuentas c ON c.proveedor_id=p.id
      WHERE p.nombre=JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.proveedor')) AND ${filtro.replace('%s','c.cedula')}
      AND (SELECT COUNT(DISTINCT c2.cedula) FROM prov_portal_cuentas c2 WHERE c2.proveedor_id=p.id)=1)))
    ORDER BY d.id DESC LIMIT 200`,[id(cedula),id(cedula)]);
  const [oc]=await db.query(`SELECT o.id,o.po_numero,o.total,o.moneda,o.estado,o.factura,o.empresa_destino FROM ordenes_compra o JOIN proveedores p ON p.id=o.proveedor_id WHERE ${filtro.replace('%s','p.cedula_juridica')} ORDER BY o.id DESC LIMIT 200`,[id(cedula)]);
  const ordenes=[...pr.map(r=>{const d=typeof r.datos==='string'?JSON.parse(r.datos):r.datos;return {id:r.id,origen:'PROVEEDURIA',numero:`PR-${r.id}`,referencia:`PR-${r.id}`,total:Number(d.total),moneda:d.moneda||'CRC',estado:d.estado,factura:d.factura,empresa:d.razon_social||d.empresa_destino};}),...oc.map(o=>({id:o.id,origen:'COMPRAS',numero:o.po_numero,referencia:`#${o.id}`,total:Number(o.total),moneda:o.moneda||'CRC',estado:o.estado,factura:o.factura,empresa:o.empresa_destino}))];
  const [vinculos]=await db.query(`SELECT v.origen,v.orden_id,SUM(v.monto) AS asignado FROM prov_portal_factura_orden v JOIN prov_documentos d ON d.id=v.factura_id JOIN prov_portal_cuentas c ON c.id=CAST(JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.cuenta_id')) AS UNSIGNED) WHERE ${filtro.replace('%s','c.cedula')} AND JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.factura.estado'))<>'RECHAZADA_INTERNA' GROUP BY v.origen,v.orden_id`,[id(cedula)]);
  return ordenes.filter(o=>!o.factura&&!/ANUL|CANCEL/.test(String(o.estado).toUpperCase())).map(o=>{const asignado=Number(vinculos.find(v=>v.origen===o.origen&&Number(v.orden_id)===Number(o.id))?.asignado||0);const {factura,...publica}=o;return {...publica,disponible:Math.max(0,o.total-asignado)};}).filter(o=>o.disponible>0.01);
}
module.exports={ordenesDisponibles};
