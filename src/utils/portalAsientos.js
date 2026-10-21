const {aprobable}=require('./proveedorHacienda');
const {revisarFactura,exigirControl}=require('./portalControlFactura');
const {empresaFactura}=require('./portalEmpresaReceptora');
const {exigir}=require('./proveeduria');
function convertir(row){
  const d=typeof row.datos==='string'?JSON.parse(row.datos):row.datos,f=d.factura,e=f.electronica;
  if(f.estado!=='CONCILIADA'||!f.cuenta_por_pagar)return null;
  aprobable(f);
  return {id:row.id,tipo:'portal',numero_factura:f.numero,consecutivo_electronico:e.consecutivo,clave_electronica:e.clave,estado_hacienda:e.hacienda.estado,proveedor_nombre:d.proveedor,empresa_destino:empresaFactura(d),moneda:f.moneda||d.moneda,fecha:e.fecha?.slice(0,10)||f.fecha,fecha_vencimiento_factura:f.fecha_vencimiento,monto_original:Number(f.total),monto:Number(f.total),nota_credito_monto:(d.notas_credito||[]).filter(n=>n.aplicada).reduce((s,n)=>s+Number(n.total),0),po_numero:d.orden_compra?.numero||'',factura_observacion:(e.lineas||[]).map(l=>l.descripcion).filter(Boolean).join(', '),pagada:(d.pagos||[]).reduce((s,p)=>s+Number(p.monto),0)>=Number(f.total),url_portal:`/contabilidad/documentos/PROVEEDURIA:factura:${row.id}`};
}
async function obtener(db,filtros={},lock=false){
  if(Array.isArray(filtros.ids)&&!filtros.ids.length)return [];
  let rows;
  try{[rows]=await db.query("SELECT * FROM prov_documentos WHERE tipo='factura_portal'"+(filtros.ids?' AND id IN (?)':'')+' ORDER BY id'+(lock?' FOR UPDATE':''),filtros.ids?[filtros.ids]:[]);}catch(e){if(e.code==='ER_NO_SUCH_TABLE'&&!filtros.ids)return [];throw e;}
  if(filtros.ids)exigir(rows.length===filtros.ids.length,'Una factura del portal ya no existe');
  const result=[];
  for(const row of rows){
    const d=typeof row.datos==='string'?JSON.parse(row.datos):row.datos;
    if(!lock&&(d.factura?.estado!=='CONCILIADA'||!d.factura.cuenta_por_pagar))continue;
    if(lock){exigir(d.factura?.estado==='CONCILIADA'&&d.factura.cuenta_por_pagar,'La factura del portal todavía no está aprobada');const control=await revisarFactura(db,{...row,datos:d},true);exigirControl(control);}
    let f;try{f=convertir({...row,datos:d});}catch(e){if(lock)throw e;if(e.status)continue;throw e;}
    if(!f)continue;
    if(filtros.fecha_desde&&f.fecha<filtros.fecha_desde||filtros.fecha_hasta&&f.fecha>filtros.fecha_hasta)continue;
    if(filtros.proveedor_nombre&&String(f.proveedor_nombre).trim().toUpperCase()!==String(filtros.proveedor_nombre).trim().toUpperCase())continue;
    result.push(f);
  }
  return result;
}
module.exports={obtener,convertir};
