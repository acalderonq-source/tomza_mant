const {validarCorrespondencia,vincularOrden}=require('./portalFacturaOrden');
const parse=r=>({...r,datos:typeof r.datos==='string'?JSON.parse(r.datos):r.datos});
function candidatosUnicos(factura,ordenes){
  return ordenes.filter(o=>{
    try{validarCorrespondencia(factura,o);}catch(_){return false;}
    // Solo se enlaza automáticamente una coincidencia exacta de total y saldo disponible.
    return Math.abs(o.total-factura.factura.total)<=0.01 && Number(o.asignado||0)===0;
  });
}
async function buscarCandidatos(db,datos){
  const monto=datos.factura.total;
  const [pr]=await db.query(`SELECT d.* FROM prov_documentos d WHERE d.tipo='oc'
    AND ABS(CAST(JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.total')) AS DECIMAL(14,5))-?)<=0.01 ORDER BY d.id DESC LIMIT 201`,[monto]);
  const [compras]=await db.query(`SELECT o.id,o.po_numero,o.total,o.moneda,o.factura,p.nombre,p.cedula_juridica
    FROM ordenes_compra o LEFT JOIN proveedores p ON p.id=o.proveedor_id WHERE ABS(o.total-?)<=0.01 ORDER BY o.id DESC LIMIT 201`,[monto]);
  if(pr.length>200||compras.length>200)return {limite:true,candidatos:[]};
  const ordenes=[...pr.map(parse).map(r=>({origen:'PROVEEDURIA',id:r.id,numero:`PR-${r.id}`,referencia:`PR-${r.id}`,proveedor:r.datos.proveedor,cedula:r.datos.proveedor_cedula,total:Number(r.datos.total),moneda:r.datos.moneda,factura_registrada:!!r.datos.factura})),
    ...compras.map(o=>({origen:'COMPRAS',id:o.id,numero:o.po_numero,referencia:`#${o.id}`,proveedor:o.nombre,cedula:o.cedula_juridica,total:Number(o.total),moneda:o.moneda,factura_registrada:!!o.factura}))];
  let candidatos=candidatosUnicos(datos,ordenes);
  if(candidatos.length){
    const [usados]=await db.query(`SELECT v.origen,v.orden_id,SUM(v.monto) AS asignado FROM prov_portal_factura_orden v JOIN prov_documentos d ON d.id=v.factura_id
      WHERE JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.factura.estado'))<>'RECHAZADA_INTERNA' GROUP BY v.origen,v.orden_id`);
    candidatos=candidatos.filter(o=>!usados.some(u=>u.origen===o.origen&&Number(u.orden_id)===Number(o.id)&&Number(u.asignado)>0));
  }
  return {limite:false,candidatos};
}
async function cruzarFactura(pool,id){
  const db=await pool.getConnection();
  try{
    await db.beginTransaction();
    const [rows]=await db.query("SELECT * FROM prov_documentos WHERE id=? AND tipo='factura_portal' FOR UPDATE",[id]);
    if(!rows.length){await db.commit();return {estado:'NO_ENCONTRADA'};}
    const row=parse(rows[0]),d=row.datos;
    if(d.orden_compra||d.pagos?.length||!['PENDIENTE','CONCILIADA'].includes(d.factura.estado)){await db.commit();return {estado:'SIN_CAMBIOS'};}
    const {limite,candidatos}=await buscarCandidatos(db,d);
    let estado=limite?'REQUIERE_REVISION':candidatos.length===0?'SIN_COINCIDENCIA':candidatos.length>1?'VARIAS_COINCIDENCIAS':'ENLAZADA';
    if(estado==='ENLAZADA'){
      const o=candidatos[0];
      try{await vincularOrden(db,row,{origen:o.origen,referencia:o.referencia},0);d.orden_compra.automatico=true;}
      catch(e){if(!e.status)throw e;estado='REQUIERE_REVISION';}
    }
    const anterior=d.cruce_automatico;
    d.cruce_automatico={estado,coincidencias:candidatos.length,revisado_en:new Date().toISOString(),criterio:'Proveedor, moneda y total exactos'};
    await db.query("UPDATE prov_documentos SET datos=JSON_SET(datos,'$.cruce_automatico',CAST(? AS JSON)) WHERE id=?",[JSON.stringify(d.cruce_automatico),row.id]);
    if(estado==='ENLAZADA')await db.query("UPDATE prov_documentos SET datos=JSON_SET(datos,'$.orden_compra',CAST(? AS JSON)) WHERE id=?",[JSON.stringify(d.orden_compra),row.id]);
    if(anterior?.estado!==estado)await db.query('INSERT INTO prov_auditoria (documento_id,actor,accion) VALUES (?,?,?)',[row.id,'Sistema',`Cruce automático: ${estado}`]);
    await db.commit();return {estado,orden:d.orden_compra||null};
  }catch(e){await db.rollback();throw e;}finally{db.release();}
}
let ejecutando=false;
async function cruzarFacturasPendientes(pool){
  if(ejecutando)return {enlazadas:0};ejecutando=true;let enlazadas=0;
  try{
    const [rows]=await pool.query(`SELECT id FROM prov_documentos WHERE tipo='factura_portal' AND JSON_EXTRACT(datos,'$.orden_compra') IS NULL
      AND JSON_UNQUOTE(JSON_EXTRACT(datos,'$.factura.estado')) IN ('PENDIENTE','CONCILIADA')
      ORDER BY JSON_UNQUOTE(JSON_EXTRACT(datos,'$.cruce_automatico.revisado_en')),id LIMIT 50`);
    for(const row of rows){const r=await cruzarFactura(pool,row.id);if(r.estado==='ENLAZADA')enlazadas++;}
    return {enlazadas};
  }finally{ejecutando=false;}
}
module.exports={candidatosUnicos,buscarCandidatos,cruzarFactura,cruzarFacturasPendientes};
