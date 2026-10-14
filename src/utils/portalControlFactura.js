const {exigir}=require('./proveeduria');
const {validarCorrespondencia}=require('./portalFacturaOrden');
const parse=d=>typeof d==='string'?JSON.parse(d):d;
const code=s=>String(s||'').trim().toUpperCase();
function coincide(l,o){return [o.codigo,o.codigo_producto,o.referencia].filter(Boolean).some(c=>[l.codigo,...(l.codigos||[])].map(code).includes(code(c)));}
function compararLineas(lineas,orden,otras=[]){
  const diferencias=[];
  if(!lineas?.length||!orden?.length)return ['Falta detalle de artículos en el XML o la orden'];
  for(const l of lineas){
    const coincidencias=orden.filter(o=>coincide(l,o));
    if(coincidencias.length!==1){diferencias.push(`${l.descripcion}: código sin coincidencia única en la OC`);continue;}
    const o=coincidencias[0];
    if(![l.cantidad,l.precio_unitario,l.iva,o.cantidad,o.precio_unitario,o.iva].every(n=>n!=null&&Number.isFinite(Number(n)))||Number(l.cantidad)<=0){diferencias.push(`${l.codigo}: detalle numérico inválido`);continue;}
    const acumulado=[...otras,...lineas].filter(x=>coincide(x,o)).reduce((s,x)=>s+Number(x.cantidad),0);
    if(acumulado>Number(o.cantidad)+0.00001)diferencias.push(`${l.codigo}: cantidad acumulada supera la OC`);
    if(Math.abs(Number(l.precio_unitario)-Number(o.precio_unitario))>0.01)diferencias.push(`${l.codigo}: precio unitario diferente`);
    if(Math.abs(Number(l.iva)-Number(o.iva))>0.0001)diferencias.push(`${l.codigo}: IVA diferente`);
    if(Math.abs(Number(l.descuento||0)/Number(l.cantidad)-Number(o.descuento||0)/Number(o.cantidad))>0.01)diferencias.push(`${l.codigo}: descuento diferente`);
  }
  return [...new Set(diferencias)];
}
function lineasProveeduria(o){
  const base=(o.lineas||[]).reduce((s,l)=>s+Number(l.subtotal??Number(l.cantidad)*Number(l.precio_unitario)),0);
  return (o.lineas||[]).map(l=>({...l,iva:o.iva_global?Number(o.iva):l.iva,descuento:Number(l.descuento||0)+(base?Number(o.descuento||0)*Number(l.subtotal??Number(l.cantidad)*Number(l.precio_unitario))/base:0)}));
}
async function revisarFactura(db,row,lock=false){
  const d=row.datos,oc=d.orden_compra,issues=[];let lineas=[];
  if(!oc)return {diferencias:['Sin orden de compra vinculada'],revisado_en:new Date().toISOString()};
  await cargarDetalleXML(db,row.datos);
  const bloqueo=lock?' FOR UPDATE':'';
  const identidad=o=>{try{validarCorrespondencia(d,o);}catch(e){if(!e.status)throw e;issues.push(e.message);}};
  if(oc.origen==='PROVEEDURIA'){
    const [r]=await db.query("SELECT datos FROM prov_documentos WHERE id=? AND tipo='oc'"+bloqueo,[oc.id]);
    if(r.length){const o=parse(r[0].datos);identidad({estado:o.estado,proveedor:o.proveedor,cedula:o.proveedor_cedula,moneda:o.moneda,total:Number(o.total),factura_registrada:!!o.factura});lineas=lineasProveeduria(o);if(Number(o.transporte)>0)issues.push('La OC incluye transporte: requiere revisar su correspondencia en el XML');}
  }else{
    const [r]=await db.query('SELECT o.*,p.nombre,p.cedula_juridica FROM ordenes_compra o LEFT JOIN proveedores p ON p.id=o.proveedor_id WHERE o.id=?'+bloqueo,[oc.id]);
    if(r.length){const o=r[0];identidad({estado:o.estado,proveedor:o.nombre,cedula:o.cedula_juridica,moneda:o.moneda,total:Number(o.total),factura_registrada:!!o.factura});const [ls]=await db.query('SELECT * FROM ordenes_compra_detalle WHERE orden_compra_id=? ORDER BY id'+bloqueo,[oc.id]);
      lineas=ls.map(l=>({...l,codigo:l.codigo||l.codigo_producto||`LINEA-${l.id}`,iva:Number(o.iva),descuento:Number(o.subtotal)>0?Number(o.descuento||0)*Number(l.subtotal)/Number(o.subtotal):0}));
      if(Number(o.transporte)>0)issues.push('La OC incluye transporte: requiere revisar su correspondencia en el XML');
    }
  }
  const [rs]=await db.query("SELECT d.id,d.datos FROM prov_portal_factura_orden v JOIN prov_documentos d ON d.id=v.factura_id WHERE v.origen=? AND v.orden_id=? AND v.factura_id<>? AND JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.factura.estado'))<>'RECHAZADA_INTERNA'"+bloqueo,[oc.origen,oc.id,row.id]);
  const anteriores=rs.map(r=>parse(r.datos));for(const anterior of anteriores)await cargarDetalleXML(db,anterior);
  if(anteriores.some(o=>!o.factura.electronica.lineas?.length))issues.push('Otra factura de esta OC no tiene detalle verificable');
  const otras=anteriores.flatMap(o=>o.factura.electronica.lineas||[]),actual=d.factura.electronica.lineas||[];
  issues.push(...(d.factura.electronica.observaciones_control||[]),...compararLineas(actual,lineas,otras));
  const total=rs.reduce((s,r)=>s+Number(parse(r.datos).factura.total),Number(d.factura.total));
  // El vínculo limita el monto; aquí se vuelve a verificar al aprobar y pagar.
  const [limite]=oc.origen==='PROVEEDURIA'?await db.query("SELECT JSON_UNQUOTE(JSON_EXTRACT(datos,'$.total')) AS total FROM prov_documentos WHERE id=?",[oc.id]):await db.query('SELECT total FROM ordenes_compra WHERE id=?',[oc.id]);
  if(!limite.length||total>Number(limite[0].total)+0.01)issues.push('Monto acumulado supera el total de la OC');
  return {diferencias:[...new Set(issues)],revisado_en:new Date().toISOString(),lineas:actual,orden:lineas};
}

async function cargarDetalleXML(db,d){
  const e=d.factura.electronica;if(!e.archivo?.id||(e.lineas&&(e.detalle_version===2||!e.observaciones_control?.length)))return;
  const [r]=await db.query('SELECT nombre,contenido FROM prov_adjuntos WHERE id=?',[e.archivo.id]);
  if(!r.length)return;
  try{const f=require('./proveedorHacienda').leerFacturaXML({nombre:r[0].nombre,base64:Buffer.from(r[0].contenido).toString('base64')});if(f.clave===e.clave){e.lineas=f.lineas;e.observaciones_control=f.observaciones_control;e.detalle_version=f.detalle_version;}}catch(_){/* Los XML antiguos no válidos quedan como excepción, nunca se aprueban. */}
}
function exigirControl(c){exigir(c.diferencias.length===0,c.diferencias.join('; '));}
function excepciones(d){
  const f=d.factura,h=f.electronica.hacienda,e=[];
  if(f.estado==='RECHAZADA_INTERNA')return ['Devuelta al proveedor'];
  if(!d.orden_compra)e.push('Sin OC');
  if(h.estado==='RECHAZADA')e.push('Rechazada por Hacienda');
  else if(h.estado!=='ACEPTADA'||h.ambiente!=='produccion')e.push('Hacienda pendiente');
  e.push(...(d.control?.diferencias||[]));
  return [...new Set(e)];
}
module.exports={compararLineas,revisarFactura,exigirControl,excepciones,cargarDetalleXML,lineasProveeduria};
