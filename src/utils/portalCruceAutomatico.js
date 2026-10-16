const {compararLineas,cargarDetalleXML,lineasProveeduria}=require('./portalControlFactura');
const {validarCorrespondencia,vincularOrden}=require('./portalFacturaOrden');
const {diferenciaEmpresa}=require('./portalEmpresaReceptora');
const parse=r=>({...r,datos:typeof r.datos==='string'?JSON.parse(r.datos):r.datos});
function candidatosUnicos(factura,ordenes){
  return ordenes.filter(o=>{
    try{validarCorrespondencia(factura,o);}catch(_){return false;}
    // Solo se enlaza automáticamente una coincidencia exacta de total y saldo disponible.
    return Math.abs(o.total-factura.factura.total)<=0.01 && Number(o.asignado||0)===0;
  });
}
async function buscarCandidatos(db,datos){
  if(datos.factura.electronica.observaciones_control?.length)return {limite:false,candidatos:[]};
  const monto=datos.factura.total;
  const nombres=[datos.proveedor,datos.factura.electronica.nombre_emisor,datos.factura.electronica.nombre_comercial_emisor].filter(Boolean).map(n=>String(n).split('(')[0].trim().toUpperCase());
  const emisor=String(datos.factura.electronica.emisor||'').replace(/\D/g,'').replace(/^0+/,'');
  const [pr]=await db.query(`SELECT d.* FROM prov_documentos d WHERE d.tipo='oc'
    AND JSON_EXTRACT(d.datos,'$.factura') IS NULL
    AND UPPER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.estado')),'')) NOT REGEXP 'ANUL|CANCEL'
    AND CAST(JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.total')) AS DECIMAL(14,5))>=?-0.01
    AND (TRIM(LEADING '0' FROM REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.proveedor_cedula')),'[^0-9]',''))=?
      OR (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.proveedor_cedula')),'')=''
        AND UPPER(TRIM(SUBSTRING_INDEX(JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.proveedor')),'(',1))) IN (?)))
    ORDER BY d.id DESC LIMIT 201`,[monto,emisor,nombres.length?nombres:['']]);
  const [compras]=await db.query(`SELECT o.*,p.nombre,p.cedula_juridica
    FROM ordenes_compra o LEFT JOIN proveedores p ON p.id=o.proveedor_id WHERE o.total>=?-0.01
    AND COALESCE(o.factura,'')='' AND UPPER(COALESCE(o.estado,'')) NOT REGEXP 'ANUL|CANCEL'
    AND (TRIM(LEADING '0' FROM REGEXP_REPLACE(p.cedula_juridica,'[^0-9]',''))=?
      OR ((p.cedula_juridica IS NULL OR p.cedula_juridica='') AND UPPER(TRIM(SUBSTRING_INDEX(p.nombre,'(',1))) IN (?)))
    ORDER BY o.id DESC LIMIT 201`,[monto,emisor,nombres.length?nombres:['']]);
  if(pr.length>200||compras.length>200)return {limite:true,candidatos:[]};
  const ordenes=[...pr.map(parse).map(r=>({origen:'PROVEEDURIA',id:r.id,numero:`PR-${r.id}`,referencia:`PR-${r.id}`,estado:r.datos.estado,razon_social:r.datos.razon_social,empresa_destino:r.datos.empresa_destino,proveedor:r.datos.proveedor,cedula:r.datos.proveedor_cedula,total:Number(r.datos.total),moneda:r.datos.moneda,factura_registrada:!!r.datos.factura})),
    ...compras.map(o=>({origen:'COMPRAS',id:o.id,numero:o.po_numero,referencia:`#${o.id}`,estado:o.estado,empresa_destino:o.empresa_destino,proveedor:o.nombre,cedula:o.cedula_juridica,total:Number(o.total),moneda:o.moneda,factura_registrada:!!o.factura}))];
  const candidatos=[],empresas_incompatibles=[];
  for(const o of ordenes){
    try{validarCorrespondencia(datos,o,{ignorarEmpresa:true});}catch(_){continue;}
    let lineas;
    if(o.origen==='PROVEEDURIA'){
      const r=pr.map(parse).find(r=>r.id===o.id);if(Number(r.datos.transporte)>0)continue;lineas=lineasProveeduria(r.datos);
    }else{
      const compra=compras.find(r=>r.id===o.id),[ls]=await db.query('SELECT * FROM ordenes_compra_detalle WHERE orden_compra_id=?',[o.id]);
      if(Number(compra.transporte)>0)continue;
      lineas=ls.map(l=>({...l,codigo:l.codigo||l.codigo_producto||`LINEA-${l.id}`,iva:Number(compra.iva),descuento:Number(compra.subtotal)>0?Number(compra.descuento||0)*Number(l.subtotal)/Number(compra.subtotal):0}));
    }
    const [usadas]=await db.query("SELECT d.datos FROM prov_portal_factura_orden v JOIN prov_documentos d ON d.id=v.factura_id WHERE v.origen=? AND v.orden_id=? AND JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.factura.estado'))<>'RECHAZADA_INTERNA'",[o.origen,o.id]);
    const otras=usadas.map(r=>typeof r.datos==='string'?JSON.parse(r.datos):r.datos);
    for(const anterior of otras)await cargarDetalleXML(db,anterior);
    if(otras.some(o=>!o.factura.electronica.lineas?.length))continue;
    if(otras.reduce((s,d)=>s+Number(d.factura.total),Number(datos.factura.total))>o.total+0.01)continue;
    if(compararLineas(datos.factura.electronica.lineas,lineas,otras.flatMap(d=>d.factura.electronica.lineas||[])).length===0){
      const diferencia=diferenciaEmpresa(datos,o);
      if(diferencia)empresas_incompatibles.push({numero:o.numero,origen:o.origen,detalle:diferencia});else candidatos.push(o);
    }
  }
  return {limite:false,candidatos,empresas_incompatibles};
}
async function cruzarFactura(pool,id){
  const db=await pool.getConnection();
  try{
    await db.beginTransaction();
    const [rows]=await db.query("SELECT * FROM prov_documentos WHERE id=? AND tipo='factura_portal' FOR UPDATE",[id]);
    if(!rows.length){await db.commit();return {estado:'NO_ENCONTRADA'};}
    const row=parse(rows[0]),d=row.datos;
    if(d.orden_compra||d.pagos?.length||!['PENDIENTE','CONCILIADA'].includes(d.factura.estado)){await db.commit();return {estado:'SIN_CAMBIOS'};}
    await cargarDetalleXML(db,d);
    const {limite,candidatos,empresas_incompatibles=[]}=await buscarCandidatos(db,d);
    let estado=limite?'REQUIERE_REVISION':candidatos.length===0?(empresas_incompatibles.length?'EMPRESA_NO_COINCIDE':'SIN_COINCIDENCIA'):candidatos.length>1?'VARIAS_COINCIDENCIAS':'ENLAZADA';
    if(estado==='ENLAZADA'){
      const o=candidatos[0];
      try{await vincularOrden(db,row,{origen:o.origen,referencia:o.referencia},0);d.orden_compra.automatico=true;}
      catch(e){if(!e.status)throw e;estado='REQUIERE_REVISION';}
    }
    const anterior=d.cruce_automatico;
    d.cruce_automatico={estado,coincidencias:candidatos.length,empresas_incompatibles:estado==='EMPRESA_NO_COINCIDE'?empresas_incompatibles.slice(0,10):[],revisado_en:new Date().toISOString(),criterio:'Empresa receptora, proveedor, moneda, artículos, precios e impuestos'};
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
