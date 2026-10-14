const {normalizarEmpresa}=require('./empresasContabilidad');
const RUBROS = [
  ['PLANILLA','Planilla'], ['SERVICIOS','Servicios y alquileres'],
  ['GASTOS_GENERALES','Gastos generales'], ['COMBUSTIBLE','Combustible'],
  ['MANTENIMIENTO','Mantenimiento'], ['IMPUESTOS','Impuestos'],
  ['EXTRAORDINARIOS','Extraordinarios'], ['INVERSIONES','Inversiones'],
  ['PRESTAMOS','Préstamos'], ['PROVISIONES','Provisiones']
].map(([key,nombre])=>({key,nombre}));
const FUENTES = ['TALLER_ORDEN','TALLER_FACTURA','PROVEEDURIA','CARBURACION_ORDEN','CARBURACION_FACTURA'];
const MONEDAS = ['CRC','USD'];
function exigir(ok,mensaje){if(!ok)throw Object.assign(new Error(mensaje),{status:400});}
function periodoValido(p){return /^20\d{2}-(0[1-9]|1[0-2])$/.test(String(p||''));}
function centavos(n){const v=Number(n);return Number.isFinite(v)?Math.round(v*100):0;}
function montoValido(n){
  const s=String(n??'').trim();
  exigir(/^\d{1,12}(\.\d{1,2})?$/.test(s),'Ingrese un monto positivo o cero, con hasta dos decimales y punto decimal.');
  return Number(s);
}
function fecha(v){
  if(!v)return '';
  if(v instanceof Date)return require('./fechaCostaRica').fechaActualCostaRica(v);
  if(String(v).includes('T')){const d=new Date(v);return Number.isNaN(d.getTime())?'':require('./fechaCostaRica').fechaActualCostaRica(d);}
  return String(v).slice(0,10);
}
function json(v,fallback){if(v==null)return fallback;return typeof v==='string'?JSON.parse(v):v;}
function documento(fuente,r){
  const d=fuente==='PROVEEDURIA'?json(r.datos,{}):r;
  const prov=fuente==='PROVEEDURIA', independiente=fuente.endsWith('FACTURA');
  const f=prov?d.factura:null;
  const tieneOrden=prov?r.tipo==='oc':!independiente;
  const tieneFactura=prov?!!f:independiente||!!(r.factura||r.facturada);
  const esTaller=fuente.startsWith('TALLER');
  const bruto=prov?(tieneOrden?d.total:0):independiente?0:r.total;
  const facturado=prov?(f?.total||0):independiente?(r.monto??r.total):r.total;
  const nc=esTaller?centavos(r.nota_credito_monto):0;
  return {fuente,id:Number(r.id),referencia:prov?(tieneOrden?'PR-':'Portal-')+r.id:r.po_numero||r.numero_factura||r.numero||String(r.id),
    numeroFactura:prov?f?.numero||'':independiente?r.numero_factura||r.numero||'':r.factura||'',
    proveedor:d.proveedor||r.proveedor_nombre||r.proveedor||'',
    empresa:normalizarEmpresa(prov?(f?.electronica?.nombre_receptor||d.razon_social||d.empresa_destino):r.empresa_destino),
    sede:prov?(r.sede==='PORTAL'?'':r.sede):'',
    departamento:esTaller?'TALLER':prov?'PROVEEDURIA':'CARBURACION',
    moneda:prov?(f?.moneda||d.moneda):r.moneda||'',
    clave:prov?f?.electronica?.clave:r.factura_clave_electronica||r.clave_electronica||'',
    fechaOrden:tieneOrden?fecha(prov?r.creado_en:r.fecha):'',
    fechaFactura:tieneFactura?fecha(prov?(f.electronica?.fecha||f.fecha||f.subida_en):independiente?r.fecha:r.factura_fecha||r.factura_fecha_recepcion):'',
    fechaEstimada:tieneFactura&&(prov?!f.electronica?.fecha&&!f.fecha:!independiente&&!r.factura_fecha),
    orden:tieneOrden?Math.max(0,centavos(bruto)-nc):0,
    factura:tieneFactura?Math.max(0,centavos(facturado)-nc):0,
    tieneFactura,pagos:prov?(d.pagos||[]).map(p=>({fecha:fecha(p.fecha),monto:centavos(p.monto)})):[],
    legacy:esTaller?{pagada:!!Number(r.pagada),fecha:fecha(r.fecha_pago),abonoFecha:fecha(r.abono_fecha),abono:centavos(r.abono_monto)}:null};
}
async function cargarDocumentos(db){
  const advertencias=[];
  async function leer(sql){try{return (await db.query(sql))[0];}catch(e){if(e.code==='ER_NO_SUCH_TABLE'){advertencias.push('Una fuente todavía no está instalada: '+sql.match(/FROM\s+(\w+)/i)?.[1]);return [];}throw e;}}
  const [ordenes,facturas,prov,carOrden,carFactura,colillas,carPagos,planillas,planillaPagos,registrosRubros,pagosRubros]=await Promise.all([
    leer(`SELECT o.id,o.po_numero,o.fecha,o.empresa_destino,o.moneda,o.total,o.factura,o.facturada,o.factura_fecha,o.factura_fecha_recepcion,o.nota_credito_monto,o.pagada,o.fecha_pago,o.abono_monto,o.abono_fecha,o.factura_clave_electronica,p.nombre proveedor_nombre FROM ordenes_compra o LEFT JOIN proveedores p ON p.id=o.proveedor_id WHERE COALESCE(o.estado,'') NOT IN ('ANULADA','CANCELADA','BORRADOR')`),
    leer('SELECT id,numero_factura,fecha,monto,proveedor_nombre,nota_credito_monto,pagada,fecha_pago,abono_monto,abono_fecha,clave_electronica FROM facturas'),
    leer("SELECT id,tipo,sede,creado_en,datos FROM prov_documentos WHERE tipo IN ('oc','factura_portal')"),
    leer('SELECT o.id,o.po_numero,o.fecha,o.empresa_destino,o.moneda,o.total,p.nombre proveedor_nombre FROM carburacion_ordenes o LEFT JOIN carburacion_proveedores p ON p.id=o.proveedor_id WHERE o.eliminado_en IS NULL'),
    leer('SELECT f.id,f.orden_id,f.numero,f.fecha,f.moneda,f.total,p.nombre proveedor_nombre FROM carburacion_facturas f LEFT JOIN carburacion_proveedores p ON p.id=f.proveedor_id'),
    leer('SELECT fecha_pago,facturas_json FROM colillas_pago_proveedor'),
    leer('SELECT d.factura_id,d.monto,p.fecha FROM carburacion_pagos_detalle d JOIN carburacion_pagos p ON p.id=d.pago_id'),
    leer('SELECT r.id,r.fecha,r.salario,r.extras,p.nombre,p.empresa,p.moneda,p.sede,p.departamento FROM cont_planilla_registros r JOIN cont_planilla_personas p ON p.id=r.persona_id'),
    leer('SELECT registro_id,fecha,monto FROM cont_planilla_pagos'),
    leer('SELECT r.id,r.fecha,r.monto,r.proveedor,r.documento,c.concepto,c.empresa,c.rubro,c.moneda,c.sede,c.departamento FROM cont_rubro_registros r JOIN cont_rubro_conceptos c ON c.id=r.concepto_id'),
    leer('SELECT registro_id,fecha,monto FROM cont_rubro_pagos')
  ]);
  const docs=[...ordenes.map(r=>documento('TALLER_ORDEN',r)),...facturas.map(r=>documento('TALLER_FACTURA',r)),...prov.map(r=>documento('PROVEEDURIA',r)),...carOrden.map(r=>documento('CARBURACION_ORDEN',r))];
  const pagosPorPlanilla=new Map();
  for(const p of planillaPagos){const id=Number(p.registro_id),lista=pagosPorPlanilla.get(id)||[];lista.push({fecha:fecha(p.fecha),monto:centavos(p.monto)});pagosPorPlanilla.set(id,lista);}
  for(const r of planillas)docs.push({fuente:'PLANILLA',id:Number(r.id),referencia:'Planilla · '+r.nombre,proveedor:r.nombre,empresa:r.empresa,moneda:r.moneda,sede:r.sede,departamento:r.departamento,fechaOrden:'',fechaFactura:fecha(r.fecha),orden:0,factura:centavos(r.salario)+centavos(r.extras),tieneFactura:false,esGasto:true,pagos:pagosPorPlanilla.get(Number(r.id))||[],clasificacionPropia:{sede:r.sede,departamento:r.departamento,empresa:r.empresa,moneda:r.moneda,rubro:'PLANILLA'}});
  const pagosPorRubro=new Map();
  for(const p of pagosRubros){const id=Number(p.registro_id),lista=pagosPorRubro.get(id)||[];lista.push({fecha:fecha(p.fecha),monto:centavos(p.monto)});pagosPorRubro.set(id,lista);}
  for(const r of registrosRubros)docs.push({fuente:'CONTROL_RUBRO',id:Number(r.id),referencia:r.concepto,numeroFactura:r.documento||'',proveedor:r.proveedor||r.concepto,empresa:r.empresa,moneda:r.moneda,sede:r.sede,departamento:r.departamento,fechaOrden:'',fechaFactura:fecha(r.fecha),orden:0,factura:centavos(r.monto),tieneFactura:false,esRegistro:true,pagos:pagosPorRubro.get(Number(r.id))||[],clasificacionPropia:{sede:r.sede,departamento:r.departamento,empresa:r.empresa,moneda:r.moneda,rubro:r.rubro}});
  const porClave=new Map(docs.map(d=>[`${d.fuente}:${d.id}`,d]));
  const porCarFactura=new Map();
  for(const r of carFactura){
    let d=porClave.get('CARBURACION_ORDEN:'+r.orden_id);
    if(d){
      d.facturas=d.facturas||[];d.facturas.push({fecha:fecha(r.fecha),monto:centavos(r.total),numero:r.numero});
      d.tieneFactura=true;d.factura=d.facturas.reduce((s,f)=>s+f.monto,0);
      d.fechaFactura=d.facturas.map(f=>f.fecha).sort().at(-1);d.numeroFactura=d.facturas.map(f=>f.numero).join(', ');d.clave='';
    }
    else{d=documento('CARBURACION_FACTURA',r);docs.push(d);}
    porCarFactura.set(Number(r.id),d);
  }
  const conColilla=new Set();
  for(const c of colillas)for(const f of json(c.facturas_json,[])){
    const fuente=f.tipo==='orden'?'TALLER_ORDEN':f.tipo==='independiente'?'TALLER_FACTURA':null;
    const key=`${fuente}:${Number(f.factura_id)}`,d=porClave.get(key);
    if(d){conColilla.add(key);d.pagos.push({fecha:fecha(c.fecha_pago),monto:centavos(f.monto_pago??f.total)});}
  }
  for(const d of docs)if(d.legacy&&!conColilla.has(`${d.fuente}:${d.id}`)){
    const l=d.legacy;
    if(l.pagada&&l.fecha)d.pagos.push({fecha:l.fecha,monto:Math.max(0,d.factura-l.abono)});
    if(l.abono&&l.abonoFecha)d.pagos.push({fecha:l.abonoFecha,monto:l.abono});
    if(l.pagada&&l.abono&&!l.abonoFecha)advertencias.push(`Pago parcial sin fecha en ${d.referencia}; no se asigna a un mes.`);
  }
  for(const p of carPagos){const d=porCarFactura.get(Number(p.factura_id));if(d)d.pagos.push({fecha:fecha(p.fecha),monto:centavos(p.monto)});}
  // Una misma clave electrónica en varias fuentes exige conciliación antes de consolidarla.
  const claves=new Map();for(const d of docs)if(d.clave){const lista=claves.get(d.clave)||[];lista.push(d);claves.set(d.clave,lista);}
  for(const lista of claves.values())if(lista.length>1){lista.forEach(d=>d.duplicado=true);advertencias.push('Clave electrónica repetida: '+lista.map(d=>d.referencia).join(', ')+'. Facturación y pagos excluidos hasta conciliar.');}
  return {docs,advertencias};
}
function resumen({docs,clasificaciones,presupuestos,periodo,empresa='',sede='',departamento='',moneda='CRC'}){
  const mapa=new Map(clasificaciones.map(c=>[`${c.fuente}:${c.documento_id}`,c]));
  const grupos=new Map(RUBROS.map(r=>[r.key,{...r,presupuesto:0,ordenado:0,facturado:0,pagado:0,compromiso:0}]));
  const visibles=[];let pendientes=0;
  const coincide=d=>(!empresa||(empresa==='__SIN_EMPRESA__'?!d.empresa:d.empresa===empresa))&&(!sede||d.sede===sede)&&(!departamento||d.departamento===departamento);
  for(const b of presupuestos)if(b.empresa&&b.periodo===periodo&&b.moneda===moneda&&coincide(b)&&grupos.has(b.rubro))grupos.get(b.rubro).presupuesto+=centavos(b.monto);
  for(const original of docs){
    const clas=original.clasificacionPropia||mapa.get(`${original.fuente}:${original.id}`);const d={...original,empresaOrigen:normalizarEmpresa(original.empresa),empresa:normalizarEmpresa(clas?.empresa)||normalizarEmpresa(original.empresa),...(clas?{sede:clas.sede,departamento:clas.departamento,rubro:clas.rubro,moneda:original.moneda||clas.moneda}:{}),clasificado:!!clas};
    const delMes=f=>f&&f.slice(0,7)===periodo;
    d.ordenMes=delMes(d.fechaOrden)?d.orden:0;
    d.facturaMes=d.duplicado?0:d.facturas?d.facturas.filter(f=>delMes(f.fecha)).reduce((s,f)=>s+f.monto,0):delMes(d.fechaFactura)?d.factura:0;
    d.pagoMes=d.duplicado?0:d.pagos.filter(p=>delMes(p.fecha)).reduce((s,p)=>s+p.monto,0);
    const facturadoAlCierre=d.facturas?d.facturas.filter(f=>f.fecha&&f.fecha.slice(0,7)<=periodo).reduce((s,f)=>s+f.monto,0):d.tieneFactura&&d.fechaFactura&&d.fechaFactura.slice(0,7)<=periodo?d.factura:0;
    d.compromisoMes=delMes(d.fechaOrden)?Math.max(0,d.orden-facturadoAlCierre):0;
    if(!(delMes(d.fechaOrden)||delMes(d.fechaFactura)||d.facturas?.some(f=>delMes(f.fecha))||d.pagos.some(p=>delMes(p.fecha)))||!coincide(d))continue;
    if(d.moneda&&d.moneda!==moneda)continue;
    d.motivoExclusion=d.duplicado?'Clave electrónica repetida: requiere conciliación.':!clas?'Documento sin clasificar.':!d.empresa?'Empresa pendiente de asignar.':!MONEDAS.includes(d.moneda)?'Moneda pendiente de confirmar.':!grupos.has(d.rubro)?'Rubro pendiente o inválido.':'';
    d.incluido=!d.motivoExclusion;
    visibles.push(d);
    if(!d.incluido){pendientes++;continue;}
    const g=grupos.get(d.rubro);
    g.ordenado+=d.ordenMes;g.facturado+=d.facturaMes;g.pagado+=d.pagoMes;g.compromiso+=d.compromisoMes;
  }
  const filas=[...grupos.values()].map(g=>({...g,disponible:g.presupuesto-g.facturado-g.compromiso}));
  return {filas,documentos:visibles,pendientes};
}
module.exports={RUBROS,FUENTES,MONEDAS,exigir,periodoValido,montoValido,fecha,centavos,documento,cargarDocumentos,resumen};
