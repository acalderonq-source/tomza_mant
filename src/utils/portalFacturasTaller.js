const {normalizarEmpresa}=require('./empresasContabilidad');
// Razones sociales contrastadas con Taller y confirmadas por Administración.
const proveedoresTaller=[
  {id:16,alias:'JM REPUESTOS'},{id:14,alias:'PURDY'},{id:32,alias:'MP RADIADORES'},
  {id:38,alias:'TURBOS CARTAGO'},{id:52,alias:'JSM'},{id:8,alias:'JF'},
  {id:34,alias:'MORA'},{id:2,alias:'PINTURAS ALEX'},{id:7,alias:'DAITOMO'},
  {id:54,alias:'EURO EMBRAGUES'},{id:43,alias:'2001'},{id:18,alias:'ORTEGA Y ROJAS'},
  {id:40,alias:'Recontructora y Accesorios H G C S.A'},{id:6,alias:'COMPUTRANS'}
];
const redondear=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
function presentarFactura(r,interno=false){
  const monto=Number(r.monto),credito=Math.min(Math.max(0,Number(r.nota_credito_monto||0)),monto);
  const abono=Math.min(Math.max(0,Number(r.abono_monto||0)),Math.max(0,monto-credito));
  return {id:Number(r.id),tipo:r.tipo,proveedor_id:Number(r.proveedor_id),proveedor:r.proveedor_nombre,
    alias:proveedoresTaller.find(p=>p.id===Number(r.proveedor_id))?.alias||r.proveedor_nombre,
    numero:r.numero_factura||'Sin número registrado',orden:r.po_numero||'',fecha:r.fecha||'',vence:r.vence||'',
    empresa:normalizarEmpresa(r.empresa_destino)||'Por confirmar',moneda:r.moneda||'CRC',
    monto:redondear(monto),credito:redondear(credito),abono:redondear(abono),saldo:redondear(Math.max(0,monto-credito-abono)),
    hacienda:r.estado_hacienda||'Sin verificación registrada',
    ...(interno?{url:r.tipo==='orden'?`/compras/ordenes/${Number(r.id)}/detalle`:`/compras/facturas?proveedor_id=${Number(r.proveedor_id)}&pagada=0`}:{})};
}
async function facturasPendientesTaller(db,{cedula,interno=false}={}){
  // El portal externo requiere cédula exacta; nunca se comparte por similitud del nombre.
  const fiscal=String(cedula||'').replace(/\D/g,'').replace(/^0+/,'');
  if(!interno&&!/^\d{9,12}$/.test(fiscal))return {facturas:[],proveedores:[],resumen:{pendientes:0,CRC:0,USD:0}};
  const ids=proveedoresTaller.map(p=>p.id);
  const filtroFiscal=interno?'':" AND TRIM(LEADING '0' FROM REGEXP_REPLACE(p.cedula_juridica,'[^0-9]',''))=?";
  const [ordenes]=await db.query(`SELECT o.id,'orden' AS tipo,p.id AS proveedor_id,p.nombre AS proveedor_nombre,o.factura AS numero_factura,o.po_numero,
    DATE_FORMAT(COALESCE(o.factura_fecha,o.fecha),'%Y-%m-%d') AS fecha,DATE_FORMAT(o.fecha_vencimiento_factura,'%Y-%m-%d') AS vence,
    o.empresa_destino,o.total AS monto,o.nota_credito_monto,o.abono_monto,o.factura_estado_hacienda AS estado_hacienda,
    COALESCE((SELECT fe.moneda FROM facturas_electronicas_cruce fe WHERE fe.orden_compra_id=o.id AND fe.moneda IS NOT NULL ORDER BY fe.id DESC LIMIT 1),o.moneda,'CRC') AS moneda
    FROM ordenes_compra o JOIN proveedores p ON p.id=o.proveedor_id
    WHERE o.facturada=1 AND COALESCE(o.pagada,0)=0 AND p.id IN (?)${filtroFiscal}
    AND GREATEST(o.total-COALESCE(o.nota_credito_monto,0)-COALESCE(o.abono_monto,0),0)>0.005
    AND NOT EXISTS (SELECT 1 FROM prov_portal_factura_orden v JOIN prov_documentos d ON d.id=v.factura_id WHERE v.origen='COMPRAS' AND v.orden_id=o.id AND d.tipo='factura_portal' AND JSON_UNQUOTE(JSON_EXTRACT(d.datos,'$.factura.estado'))<>'RECHAZADA_INTERNA')
    AND NOT EXISTS (SELECT 1 FROM prov_facturas_claves k WHERE k.clave=o.factura_clave_electronica)`,interno?[ids]:[ids,fiscal]);
  const [independientes]=await db.query(`SELECT f.id,'independiente' AS tipo,p.id AS proveedor_id,COALESCE(p.nombre,f.proveedor_nombre) AS proveedor_nombre,f.numero_factura,NULL AS po_numero,
    DATE_FORMAT(f.fecha,'%Y-%m-%d') AS fecha,NULL AS vence,NULL AS empresa_destino,f.monto,f.nota_credito_monto,f.abono_monto,f.estado_hacienda,
    COALESCE((SELECT fe.moneda FROM facturas_electronicas_cruce fe WHERE fe.factura_id=f.id AND fe.moneda IS NOT NULL ORDER BY fe.id DESC LIMIT 1),'CRC') AS moneda
    FROM facturas f JOIN proveedores p ON p.id=f.proveedor_id
    WHERE COALESCE(f.pagada,0)=0 AND p.id IN (?)${filtroFiscal}
    AND GREATEST(f.monto-COALESCE(f.nota_credito_monto,0)-COALESCE(f.abono_monto,0),0)>0.005
    AND NOT EXISTS (SELECT 1 FROM prov_facturas_claves k WHERE k.clave=f.clave_electronica)`,interno?[ids]:[ids,fiscal]);
  const facturas=[...ordenes,...independientes].map(r=>presentarFactura(r,interno)).filter(r=>r.saldo>0);
  facturas.sort((a,b)=>a.alias.localeCompare(b.alias,'es')||String(a.vence||a.fecha).localeCompare(String(b.vence||b.fecha))||a.id-b.id);
  const resumen={pendientes:facturas.length,CRC:0,USD:0};for(const f of facturas)if(['CRC','USD'].includes(f.moneda))resumen[f.moneda]=redondear(resumen[f.moneda]+f.saldo);
  return {facturas,proveedores:interno?proveedoresTaller:proveedoresTaller.filter(p=>facturas.some(f=>f.proveedor_id===p.id)),resumen};
}
module.exports={facturasPendientesTaller,presentarFactura,proveedoresTaller};
