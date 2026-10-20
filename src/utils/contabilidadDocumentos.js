const { fechaActualCostaRica } = require('./fechaCostaRica');
const { normalizarEmpresa } = require('./empresasContabilidad');
const { fecha } = require('./presupuestosContabilidad');
const parse = v => typeof v === 'string' ? JSON.parse(v) : v || {};
const cents = v => Math.round(Number(v || 0) * 100);
const text = v => String(v || '').trim();
function documento(origen, id, tipo, datos) {
  return { origen, id: Number(id), tipo, referencia: '', numero: '', fecha: '', empresa: '', moneda: '', proveedor: '', total: 0, pagado: 0, clave: '', estadoOrigen: '', ...datos };
}
async function cargar(db) {
  const advertencias = [];
  const leer = async sql => { try { return (await db.query(sql))[0]; } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    advertencias.push('Fuente no instalada: ' + sql.match(/FROM\s+(\w+)/i)?.[1]); return [];
  } };
  const [oc, independientes, prov, carOC, carF, motor, caja, electronicas, colillas] = await Promise.all([
    leer('SELECT o.*,p.nombre proveedor FROM ordenes_compra o LEFT JOIN proveedores p ON p.id=o.proveedor_id'),
    leer('SELECT * FROM facturas'),
    leer("SELECT * FROM prov_documentos WHERE tipo IN ('oc','factura_portal')"),
    leer('SELECT o.*,p.nombre proveedor FROM carburacion_ordenes o LEFT JOIN carburacion_proveedores p ON p.id=o.proveedor_id WHERE o.eliminado_en IS NULL'),
    leer('SELECT f.id,f.orden_id,f.numero,f.fecha,f.vencimiento,f.moneda,f.total,f.pagado,p.nombre proveedor FROM carburacion_facturas f LEFT JOIN carburacion_proveedores p ON p.id=f.proveedor_id'),
    leer('SELECT o.*,p.nombre proveedor FROM ordenes_motor o LEFT JOIN proveedores p ON p.id=o.proveedor_id'),
    leer('SELECT * FROM caja_chica_documentos'),
    leer('SELECT * FROM facturas_electronicas_cruce'),
    leer("SELECT fecha_pago,facturas_json FROM colillas_pago_proveedor WHERE origen='actual'")
  ]);
  const docs = [], agregar = (origen,id,tipo,d) => docs.push(documento(origen,id,tipo,d));
  const pagos = new Map();
  for (const c of colillas) for (const p of parse(c.facturas_json)) {
    const k = `${p.tipo}:${p.factura_id}`; pagos.set(k,(pagos.get(k)||0)+cents(p.monto_pago ?? p.total));
  }
  const pagadoTaller = (r,t,total) => pagos.has(`${t}:${r.id}`) ? pagos.get(`${t}:${r.id}`) : Number(r.pagada) ? total : cents(r.abono_monto);
  for (const r of oc) {
    const base = { referencia:r.po_numero,fecha:fecha(r.fecha),empresa:normalizarEmpresa(r.empresa_destino),moneda:r.moneda,proveedor:r.proveedor,total:cents(r.total),estadoOrigen:r.estado,url:`/compras/ordenes/${r.id}/detalle` };
    agregar('TALLER',r.id,'orden',base);
    if (r.factura || Number(r.facturada)) {
      const e=electronicas.find(e=>Number(e.orden_compra_id)===Number(r.id));
      const total=cents(e?.monto_total??r.total)-cents(r.nota_credito_monto);
      agregar('TALLER',r.id,'factura',{...base,numero:r.factura,fecha:fecha(r.factura_fecha||e?.fecha_emision||r.factura_fecha_recepcion),moneda:e?.moneda||r.moneda,total,pagado:pagadoTaller(r,'orden',total),clave:r.factura_clave_electronica||e?.clave,hacienda:r.factura_estado_hacienda||e?.estado_hacienda,vencimiento:fecha(r.fecha_vencimiento_factura)});
    }
  }
  for (const r of independientes) {
    const e=electronicas.find(e=>Number(e.factura_id)===Number(r.id));const total=cents(r.monto)-cents(r.nota_credito_monto);
    agregar('TALLER_INDEPENDIENTE',r.id,'factura',{numero:r.numero_factura,fecha:fecha(r.fecha),empresa:'',moneda:e?.moneda||'',proveedor:r.proveedor_nombre,total,pagado:pagadoTaller(r,'independiente',total),clave:r.clave_electronica,hacienda:r.estado_hacienda,url:'/compras/facturas?q='+encodeURIComponent(r.numero_factura)});
  }
  for (const r of prov) {
    const d=parse(r.datos),f=d.factura;
    const base={referencia:`PR-${r.id}`,fecha:fecha(r.creado_en),empresa:normalizarEmpresa(d.razon_social||d.empresa_destino),moneda:d.moneda,proveedor:d.proveedor,total:cents(d.total),estadoOrigen:d.estado,lineas:d.lineas||[],url:r.tipo==='oc'?`/proveeduria/ordenes/${r.id}`:'/proveeduria/portal-proveedores/facturas'};
    if(r.tipo==='oc')agregar('PROVEEDURIA',r.id,'orden',base);
    if(f)agregar('PROVEEDURIA',r.id,'factura',{...base,portal:r.tipo==='factura_portal',versionPortal:require('./portalAprobacionContable').version(f),aprobadaPortal:f.estado==='CONCILIADA'&&f.cuenta_por_pagar===true,ambienteHacienda:f.electronica?.hacienda?.ambiente,numero:f.numero,fecha:fecha(f.electronica?.fecha||f.fecha||f.subida_en),empresa:normalizarEmpresa(f.electronica?.nombre_receptor)||base.empresa,moneda:f.moneda||d.moneda,total:cents(f.total)-(d.notas_credito||[]).filter(n=>n.aplicada).reduce((s,n)=>s+cents(n.total),0),pagado:(d.pagos||[]).reduce((s,p)=>s+cents(p.monto),0),clave:f.electronica?.clave,hacienda:f.electronica?.hacienda?.estado,estadoOrigen:f.estado,requiereConciliar:f.estado!=='CONCILIADA',vencimiento:fecha(f.fecha_vencimiento||f.vencimiento)});
  }
  for(const r of carOC)agregar('CARBURACION',r.id,'orden',{referencia:r.po_numero,fecha:fecha(r.fecha),empresa:normalizarEmpresa(r.empresa_destino),moneda:r.moneda,proveedor:r.proveedor,total:cents(r.total),estadoOrigen:r.estado,lineas:parse(r.lineas_json)||[]});
  for(const r of carF)agregar('CARBURACION',r.id,'factura',{numero:r.numero,referencia:carOC.find(o=>Number(o.id)===Number(r.orden_id))?.po_numero||'',fecha:fecha(r.fecha),vencimiento:fecha(r.vencimiento),empresa:normalizarEmpresa(carOC.find(o=>Number(o.id)===Number(r.orden_id))?.empresa_destino),moneda:r.moneda,proveedor:r.proveedor,total:cents(r.total),pagado:cents(r.pagado)});
  for(const r of motor)agregar('MOTOR',r.id,'orden',{referencia:r.numero,fecha:fecha(r.fecha),empresa:normalizarEmpresa(r.empresa_destino),moneda:r.moneda,proveedor:r.proveedor,total:cents(r.total),estadoOrigen:r.estado});
  for(const r of caja)agregar('CAJA_CHICA',r.id,'factura',{numero:r.numero_factura,fecha:fecha(r.fecha),empresa:normalizarEmpresa(r.empresa),moneda:'CRC',proveedor:r.proveedor,total:cents(r.monto),pagado:cents(r.monto),estadoOrigen:r.estado,caja:true,clave:electronicas.find(e=>Number(e.id)===Number(r.factura_electronica_id))?.clave,url:'/compras/facturas/caja-chica'});
  const claves=new Set(docs.map(d=>d.clave).filter(Boolean)),idsCaja=new Set(caja.map(c=>Number(c.factura_electronica_id)));
  for(const r of electronicas)if(!r.orden_compra_id&&!r.factura_id&&!idsCaja.has(Number(r.id))&&!claves.has(r.clave))agregar('ELECTRONICA',r.id,'factura',{numero:r.numero_factura||r.consecutivo,fecha:fecha(r.fecha_emision),moneda:r.moneda,proveedor:r.nombre_emisor,total:cents(r.monto_total),clave:r.clave,hacienda:r.estado_hacienda,pendienteVinculo:true,url:'/compras/facturas'});
  const clasificaciones=await leer('SELECT * FROM cont_clasificaciones');
  for(const d of docs){
    const fuente=d.origen==='TALLER'?'TALLER_ORDEN':d.origen==='TALLER_INDEPENDIENTE'?'TALLER_FACTURA':d.origen==='PROVEEDURIA'?'PROVEEDURIA':d.origen==='CARBURACION'?(d.tipo==='orden'?'CARBURACION_ORDEN':'CARBURACION_FACTURA'):'';
    const c=clasificaciones.find(c=>c.fuente===fuente&&Number(c.documento_id)===d.id);
    if(c){d.empresa=normalizarEmpresa(c.empresa)||d.empresa;d.moneda=d.moneda||c.moneda;}
  }
  preparar(docs);
  return {docs,advertencias};
}
function identidad(d){return [d.empresa,d.moneda,d.proveedor,d.numero].map(v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'')).join('|');}
function preparar(docs, _revisionesIgnoradas=[], hoy=fechaActualCostaRica()){
  for(const d of docs){
    d.key=`${d.origen}:${d.tipo}:${d.id}`;
    d.empresa=normalizarEmpresa(d.empresa);d.moneda=text(d.moneda).toUpperCase();
    d.saldo=Math.max(0,d.total-d.pagado);
    d.estado=d.tipo==='orden'?(d.estadoOrigen||'REGISTRADA'):d.portal?(d.aprobadaPortal?'ACEPTADA':/RECHAZ|DEVUEL/.test(d.estadoOrigen||'')?'DEVUELTA':'PENDIENTE'):'REGISTRADA';
    d.motivos=[];
    if(!d.empresa)d.motivos.push('Empresa pendiente');
    if(!['CRC','USD'].includes(d.moneda))d.motivos.push('Moneda pendiente');
    if(!d.numero||!d.proveedor||!d.fecha||!Number.isSafeInteger(d.total)||d.total<=0)d.motivos.push('Datos de factura incompletos');
    if(/ANUL|CANCEL|RECHAZ|DEVUEL/.test(d.estadoOrigen||''))d.motivos.push('Documento anulado, rechazado o devuelto');
    if(d.clave&&d.hacienda!=='ACEPTADA')d.motivos.push('Validación Hacienda pendiente o rechazada');
    if(d.portal&&!d.aprobadaPortal)d.motivos.push('Pendiente de aprobación en el portal');
    if(d.portal&&d.ambienteHacienda!=='produccion')d.motivos.push('Hacienda: requiere ambiente de producción');
    if(!d.portal&&d.requiereConciliar)d.motivos.push('Conciliación pendiente en el módulo de origen');
    if(d.pendienteVinculo)d.motivos.push('Factura electrónica pendiente de vincular');
    if(d.caja)d.motivos.push('Caja chica: gasto pagado, no genera pasivo de proveedor');
    if(d.pagado>d.total)d.motivos.push('Pagos superiores al total neto: conciliar saldo');
  }
  const facturas=docs.filter(d=>d.tipo==='factura'),identidades=new Map(),claves=new Map();
  for(const d of facturas){const k=identidad(d);identidades.set(k,(identidades.get(k)||0)+1);if(d.clave)claves.set(d.clave,(claves.get(d.clave)||0)+1);}
  for(const d of facturas)if(identidades.get(identidad(d))>1||(d.clave&&claves.get(d.clave)>1))d.motivos.push('Posible duplicado: conciliar antes de aceptar');
  for(const d of docs){
    d.incluido=d.tipo==='factura'&&!d.motivos.length;
    d.diasVencidos=d.tipo==='factura'&&d.saldo>0&&/^\d{4}-\d{2}-\d{2}$/.test(d.vencimiento||'')?Math.max(0,Math.floor((Date.parse(hoy+'T00:00:00Z')-Date.parse(d.vencimiento+'T00:00:00Z'))/86400000)):0;
    d.estadoPago=d.tipo==='orden'?'COMPROMISO':d.saldo===0?'PAGADA':d.diasVencidos>0?'VENCIDA':d.pagado>0?'PARCIAL':'PENDIENTE';
    d.tramoVencimiento=d.saldo===0?'Sin saldo':!d.vencimiento?'Sin vencimiento':d.diasVencidos===0?'Por vencer':d.diasVencidos<=30?'1–30 días':d.diasVencidos<=60?'31–60 días':d.diasVencidos<=90?'61–90 días':'Más de 90 días';
  }
  return docs;
}
const claveProveedor=v=>text(v).replace(/\s+/g,' ').toLocaleUpperCase('es-CR');
function filtrar(docs,q={}){return docs.filter(d=>(!q.tipo||d.tipo===q.tipo)&&(!q.origen||d.origen===q.origen)&&(!q.estado||d.estado===q.estado)&&(!q.pago||d.estadoPago===q.pago)&&(!q.empresa||d.empresa===q.empresa)&&(!q.proveedor||claveProveedor(d.proveedor)===claveProveedor(q.proveedor))&&(!q.desde||d.fecha>=q.desde)&&(!q.hasta||d.fecha<=q.hasta)&&(!q.q||`${d.numero} ${d.referencia} ${d.proveedor}`.toLowerCase().includes(String(q.q).toLowerCase())));}
function resumen(docs){return ['CRC','USD'].map(moneda=>{const facturas=docs.filter(d=>d.tipo==='factura'&&d.moneda===moneda),validas=facturas.filter(d=>d.incluido);return {moneda,saldo:validas.reduce((s,d)=>s+d.saldo,0),vencido:validas.filter(d=>d.diasVencidos>0).reduce((s,d)=>s+d.saldo,0),excluido:facturas.filter(d=>!d.incluido).reduce((s,d)=>s+d.saldo,0),pendientesPortal:facturas.filter(d=>d.portal&&d.estado==='PENDIENTE').length};});}
function porProveedor(docs){
  const grupos=new Map();
  for(const d of docs){
    if(!d.incluido||d.tipo!=='factura'||d.saldo<=0)continue;
    const key=JSON.stringify([claveProveedor(d.proveedor),d.empresa,d.moneda]);
    const r=grupos.get(key)||{proveedor:text(d.proveedor).replace(/\s+/g,' '),empresa:d.empresa,moneda:d.moneda,facturas:0,total:0,pagado:0,saldo:0,vencido:0,porVencer:0,sinVencimiento:0};
    r.facturas++;r.total+=d.total;r.pagado+=d.pagado;r.saldo+=d.saldo;
    if(d.diasVencidos>0)r.vencido+=d.saldo;else if(d.vencimiento)r.porVencer+=d.saldo;else r.sinVencimiento+=d.saldo;
    grupos.set(key,r);
  }
  return [...grupos.values()].sort((a,b)=>a.proveedor.localeCompare(b.proveedor,'es')||a.empresa.localeCompare(b.empresa,'es')||a.moneda.localeCompare(b.moneda));
}
module.exports={cargar,preparar,filtrar,identidad,resumen,porProveedor};
