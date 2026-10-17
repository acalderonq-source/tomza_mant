function conciliar(colillas, monedasOrdenes = new Map()) {
  const totales = new Map(), movimientos = [], alertas = [];
  for (const c of colillas) {
    let facturas;
    try { facturas = typeof c.facturas_json === 'string' ? JSON.parse(c.facturas_json) : c.facturas_json; }
    catch (_) { alertas.push({id:c.id,motivo:'Detalle JSON inválido'});continue; }
    if (!Array.isArray(facturas) || !facturas.length) {alertas.push({id:c.id,motivo:'Colilla sin detalle de facturas'});continue;}
    const propias = [], refs = new Set();
    for (const f of facturas) {
      const key=f.tipo+':'+f.factura_id;
      const monto=f.monto_pago===null||f.monto_pago===undefined||f.monto_pago===''?NaN:Number(f.monto_pago);
      const moneda=f.tipo==='independiente'?'CRC':f.tipo==='orden'?monedasOrdenes.get(Number(f.factura_id)):null;
      if (refs.has(key)||!Number.isSafeInteger(Number(f.factura_id))||Number(f.factura_id)<=0||!Number.isFinite(monto)||monto<=0||!Number.isSafeInteger(Math.round(monto*100))||!['CRC','USD'].includes(moneda)) {
        alertas.push({id:c.id,motivo:'Referencia repetida, moneda desconocida o importe aplicado no verificable'});propias.length=0;break;
      }
      refs.add(key);
      propias.push({colilla:c.id,recibo:c.recibo_numero,fecha:c.fecha_pago,tipo:c.tipo_pago,referencia:key,factura:String(f.factura||''),proveedor:String(f.proveedor_nombre||''),moneda,centavos:Math.round(monto*100)});
    }
    if(!propias.length)continue;
    const monedas=new Set(propias.map(p=>p.moneda));
    const detalle=propias.reduce((s,p)=>s+p.centavos,0);
    const total=Number(c.total_pagado);
    if(monedas.size!==1||!Number.isFinite(total)||Math.abs(detalle-Math.round(total*100))>1){
      alertas.push({id:c.id,motivo:'El total de la colilla no cuadra con sus aplicaciones o mezcla monedas'});continue;
    }
    for(const p of propias){movimientos.push(p);totales.set(p.moneda,(totales.get(p.moneda)||0)+p.centavos);}
  }
  return {movimientos,alertas,totales:[...totales].map(([moneda,centavos])=>({moneda,monto:centavos/100}))};
}
function cotejarDocumentos(movimientos, documentos) {
  const revisiones=[];
  const porDocumento=new Map();
  for(const m of movimientos){
    if(!porDocumento.has(m.referencia))porDocumento.set(m.referencia,{centavos:0,colillas:new Set()});
    const r=porDocumento.get(m.referencia);r.centavos+=m.centavos;r.colillas.add(m.colilla);
  }
  for(const [referencia,aplicado] of porDocumento){
    const documento=documentos.get(referencia);
    if(!documento){revisiones.push({referencia,motivo:'El documento referenciado no existe actualmente',colillas:[...aplicado.colillas]});continue;}
    const neto=Math.max(0,Math.round(Number(documento.total||0)*100)-Math.round(Number(documento.nota_credito_monto||0)*100));
    const abonos=Math.round(Number(documento.abono_monto||0)*100);
    if(Number(documento.pagada)!==1&&abonos===0){revisiones.push({referencia,motivo:'Tiene colilla, pero el documento figura pendiente y sin abonos registrados',colillas:[...aplicado.colillas]});}
    if(aplicado.centavos>neto+1){revisiones.push({referencia,motivo:'Lo documentado en este conjunto supera el importe neto actual; revisar notas de crédito, reversos y pagos',colillas:[...aplicado.colillas]});}
  }
  return revisiones;
}
module.exports={conciliar,cotejarDocumentos};
