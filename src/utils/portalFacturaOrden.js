const {exigir}=require('./proveeduria');
const {diferenciaEmpresa}=require('./portalEmpresaReceptora');
const {claveProveedor}=require('./proveeduriaProveedores');
const parse=r=>({...r,datos:typeof r.datos==='string'?JSON.parse(r.datos):r.datos});
function validarCorrespondencia(factura,orden,{ignorarEmpresa=false}={}){
  exigir(!/ANUL|CANCEL/.test(String(orden.estado||'').toUpperCase()),'La orden está anulada o cancelada');
  const e=factura.factura.electronica,id=n=>String(n||'').replace(/\D/g,'').replace(/^0+/,''),nombre=n=>claveProveedor(String(n||'').split('(')[0]);
  if(orden.cedula)exigir(id(orden.cedula)===id(e.emisor),'El proveedor de la OC no coincide con el emisor de la factura');
  else exigir([factura.proveedor,e.nombre_emisor,e.nombre_comercial_emisor].filter(Boolean).some(n=>nombre(n)===nombre(orden.proveedor)),'El proveedor de la OC no coincide con la factura');
  exigir((orden.moneda||'CRC').toUpperCase()===factura.moneda,'La moneda de la OC no coincide con la factura');
  if(!ignorarEmpresa){const diferencia=diferenciaEmpresa(factura,orden);exigir(!diferencia,diferencia);}
  exigir(!orden.factura_registrada,'La OC ya tiene una factura registrada por el flujo anterior; revise antes de enlazar otra');
  exigir(Number.isFinite(orden.total)&&orden.total>0,'La OC no tiene un monto válido');
}
async function vincularOrden(db,row,body,actor){
  exigir(!row.datos.pagos?.length && (row.datos.factura.estado==='PENDIENTE'||(row.datos.factura.estado==='CONCILIADA'&&!row.datos.orden_compra)),'Solo se puede asignar la primera OC sin pagos, o cambiarla antes de aprobar la factura');
  const origen=String(body.origen||'');exigir(['PROVEEDURIA','COMPRAS'].includes(origen),'Seleccione el módulo de la OC');
  const referencia=String(body.referencia||'').trim();exigir(referencia&&referencia.length<=80,'Indique el número de OC');
  let orden;
  if(origen==='PROVEEDURIA'){
    const id=referencia.replace(/^PR-/i,'');exigir(/^\d+$/.test(id),'Use el número PR- de Proveeduría');
    const [r]=await db.query("SELECT * FROM prov_documentos WHERE id=? AND tipo='oc' FOR UPDATE",[id]);exigir(r.length===1,'Orden de Proveeduría no encontrada');const d=parse(r[0]);
    orden={id:d.id,numero:`PR-${d.id}`,estado:d.datos.estado,razon_social:d.datos.razon_social,empresa_destino:d.datos.empresa_destino,proveedor:d.datos.proveedor,total:Number(d.datos.total),moneda:d.datos.moneda,cedula:d.datos.proveedor_cedula,factura_registrada:!!d.datos.factura,url:`/proveeduria/ordenes/${d.id}`};
  }else{
    const porId=/^#\d+$/.test(referencia);
    const [r]=await db.query(`SELECT o.id,o.po_numero,o.total,o.moneda,o.factura,o.estado,o.empresa_destino,p.nombre,p.cedula_juridica FROM ordenes_compra o LEFT JOIN proveedores p ON p.id=o.proveedor_id WHERE ${porId?'o.id':'o.po_numero'}=? FOR UPDATE`,[porId?referencia.slice(1):referencia]);exigir(r.length===1,'Orden de Taller / Compras no encontrada');const o=r[0];
    orden={id:o.id,numero:o.po_numero,estado:o.estado,empresa_destino:o.empresa_destino,proveedor:o.nombre,cedula:o.cedula_juridica,total:Number(o.total),moneda:o.moneda,factura_registrada:!!o.factura,url:`/compras/ordenes/${o.id}/detalle`};
  }
  validarCorrespondencia(row.datos,orden);
  const [s]=await db.query(`SELECT COALESCE(SUM(v.monto),0) AS total FROM prov_portal_factura_orden v JOIN prov_documentos d ON d.id=v.factura_id WHERE v.origen=? AND v.orden_id=? AND v.factura_id<>? AND JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.factura.estado')) <> 'RECHAZADA_INTERNA'`,[origen,orden.id,row.id]);
  exigir(Number(s[0]?.total||0)+row.datos.factura.total<=orden.total+0.01,'El total de facturas enlazadas supera el monto de la OC');
  await db.query('INSERT INTO prov_portal_factura_orden (factura_id,origen,orden_id,monto,moneda,vinculado_por) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE origen=VALUES(origen),orden_id=VALUES(orden_id),monto=VALUES(monto),moneda=VALUES(moneda),vinculado_por=VALUES(vinculado_por)',[row.id,origen,orden.id,row.datos.factura.total,row.datos.moneda,actor]);
  row.datos.orden_compra={origen,id:orden.id,numero:orden.numero,url:orden.url};
}
async function facturasDeOrden(pool,origen,id){
  const [r]=await pool.query('SELECT d.* FROM prov_portal_factura_orden v JOIN prov_documentos d ON d.id=v.factura_id WHERE v.origen=? AND v.orden_id=? ORDER BY d.id DESC',[origen,id]);
  return r.filter(d=>d.tipo==='factura_portal').map(parse);
}
module.exports={vincularOrden,validarCorrespondencia,facturasDeOrden};
