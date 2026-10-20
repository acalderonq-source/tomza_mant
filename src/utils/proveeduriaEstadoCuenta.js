const {exigir}=require('./proveeduria');
const centavos=n=>Math.round(Number(n)*100);
function resumenEstadoCuenta(fuente){
  exigir(fuente.moneda==='USD'&&fuente.facturas?.length,'Estado de cuenta sin facturas en dólares');
  const vistos=new Set();
  for(const f of fuente.facturas){
    exigir(/^\d{20}$/.test(f.consecutivo)&&/^\d+$/.test(f.numero)&&!vistos.has(f.consecutivo),'Factura repetida o identificador inválido');vistos.add(f.consecutivo);
    exigir([f.monto,f.saldo].every(n=>Number.isFinite(n)&&n>=0)&&f.saldo<=f.monto,'Monto o saldo inválido');
    exigir([f.fecha,f.vence].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))),'Fecha inválida');
    exigir(f.vence>=f.fecha,'Vencimiento anterior a emisión');
  }
  const total=fuente.facturas.reduce((n,f)=>n+centavos(f.monto),0)/100;
  const saldo=fuente.facturas.reduce((n,f)=>n+centavos(f.saldo),0)/100;
  return {facturas:fuente.facturas.length,total_facturas:total,saldo_detallado:saldo,saldo_resumen:fuente.saldo_reportado,diferencia:(centavos(fuente.saldo_reportado)-centavos(saldo))/100,aplicaciones_anteriores:(centavos(total)-centavos(saldo))/100};
}
function datosFacturaEstado(fuente,f,proveedorId,archivo){
  const resumen=resumenEstadoCuenta(fuente);
  const fecha=new Date().toISOString();
  const proveedor=fuente.proveedor.replace(/\s*\(\$\)\s*$/,'').trim();
  exigir(/^\d{4}-\d{2}-\d{2}$/.test(fuente.fecha_corte),'Fecha de corte requerida');
  return {proveedor,proveedor_id:proveedorId,razon_social:fuente.receptor,empresa_receptora:{nombre:fuente.receptor,empresa:'GAS TOMZA',fuente:'ESTADO_CUENTA'},moneda:fuente.moneda,pagos:[],notas_credito:[],mensajes:[],eventos:[{accion:'importacion_estado_cuenta',actor:1,fecha}],
    importacion_estado_cuenta:{tipo:'ESTADO_CUENTA',archivo,sha256:fuente.sha256,fila:f.fila,corte:fuente.fecha_corte,cliente_codigo:fuente.cliente_codigo,numero_interno:f.numero,consecutivo:f.consecutivo,detalle:f.detalle,monto_original:f.monto,saldo_al_corte:f.saldo,aplicaciones_anteriores:(centavos(f.monto)-centavos(f.saldo))/100,resumen,fecha_reporte_texto:fuente.fecha_reporte_texto},
    factura:{numero:f.numero,total:f.monto,estado:'PENDIENTE',diferencias:['Importada de un estado de cuenta; faltan XML y PDF originales y validación de la OC'],subida_en:fecha,fecha_vencimiento:f.vence,
      electronica:{tipo:'FACTURA',clave:'',consecutivo:f.consecutivo,nombre_emisor:proveedor,nombre_receptor:fuente.receptor,emisor:'',receptor:'',fecha:f.fecha+'T00:00:00-06:00',total:f.monto,moneda:fuente.moneda,lineas:[],observaciones_control:['Estado de cuenta sin XML ni PDF original'],hacienda:{estado:'PENDIENTE',ambiente:'sin_verificar',detalle:'Estado de cuenta sin clave fiscal ni XML; pendiente de validación'}}}};
}
module.exports={resumenEstadoCuenta,datosFacturaEstado};
