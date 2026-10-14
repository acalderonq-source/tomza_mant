const crypto = require('crypto');
function exigir(condicion, mensaje) { if (!condicion) { const e = new Error(mensaje); e.status = 400; throw e; } }
function numero(valor, nombre, minimo = 0) {
  const n = Number(valor);
  exigir(valor !== '' && valor !== null && valor !== undefined && Number.isFinite(n) && n >= minimo && n <= 1e10, `${nombre} inválido`);
  return n;
}
const redondear = n => Math.round((n + Number.EPSILON) * 100) / 100;
function lineasCompra(lineas, precios = false) {
  exigir(Array.isArray(lineas) && lineas.length > 0 && lineas.length <= 200, 'Agregue entre 1 y 200 artículos');
  const codigos = new Set();
  return lineas.map(l => {
    const codigo = String(l.codigo || '').trim();
    const descripcion = String(l.descripcion || '').trim();
    exigir(codigo && codigo.length <= 80 && descripcion && descripcion.length <= 255 && !codigos.has(codigo), 'Código y descripción requeridos; no repita códigos');
    codigos.add(codigo);
    const cantidad = numero(l.cantidad, 'Cantidad', 0.001);
    exigir(Math.abs(cantidad * 1000 - Math.round(cantidad * 1000)) < 0.00001, 'Máximo tres decimales en cantidad');
    const iva = numero(l.iva ?? 13, 'IVA'); exigir(iva <= 100, 'IVA inválido');
    const precio = precios ? numero(l.precio_unitario, 'Precio') : 0;
    const subtotal = redondear(cantidad * precio);
    return { codigo, referencia:String(l.referencia||''), descripcion, cantidad, iva, precio_unitario: precio, subtotal, impuesto: redondear(subtotal * iva / 100) };
  });
}
function totales(lineas) {
  const subtotal = redondear(lineas.reduce((s,l) => s + l.subtotal, 0));
  const impuesto = redondear(lineas.reduce((s,l) => s + l.impuesto, 0));
  exigir(subtotal + impuesto <= 1e10, 'El total excede el límite permitido');
  return { subtotal, impuesto, total: redondear(subtotal + impuesto) };
}
function totalesConAjustes(lineas,valores={}) {
  const base=totales(lineas);
  const descuento=numero(valores.descuento??0,'Descuento');
  const transporte=numero(valores.transporte??0,'Transporte');
  const iva=numero(valores.iva??(base.subtotal?base.impuesto/base.subtotal*100:13),'IVA');
  exigir(descuento<=base.subtotal && iva<=100,'Descuento o IVA inválido');
  const global=valores.iva_global===true||valores.iva_global==='true';
  const impuesto=global?redondear((base.subtotal-descuento+transporte)*iva/100):redondear(base.impuesto*(base.subtotal?(base.subtotal-descuento)/base.subtotal:0)+transporte*iva/100);
  const total=redondear(base.subtotal-descuento+transporte+impuesto);
  exigir(total<=1e10,'El total excede el límite permitido');
  return {...base,descuento,transporte,iva,impuesto,total};
}
function compararFactura(oc, factura) {
  const diferencias = [];
  if (factura.proveedor !== oc.proveedor) diferencias.push('Proveedor / razón social diferente');
  if (factura.moneda !== oc.moneda) diferencias.push('Moneda diferente');
  if (Math.abs(factura.total - oc.total) > 0.01) diferencias.push('Total diferente');
  if (factura.lineas.length !== oc.lineas.length) diferencias.push('Cantidad de artículos diferente');
  for (const l of oc.lineas) {
    const f = factura.lineas.find(x => x.codigo === l.codigo);
    if (!f || f.cantidad !== l.cantidad || f.precio_unitario !== l.precio_unitario || f.iva !== l.iva) diferencias.push(`No coincide: ${l.codigo}`);
  }
  return diferencias;
}
function saldo(oc) {
  const pagos = redondear((oc.pagos || []).reduce((s,p) => s + p.monto, 0));
  const facturado = oc.factura?.total ?? 0;
  const creditos=redondear((oc.notas_credito||[]).filter(n=>n.aplicada).reduce((s,n)=>s+Number(n.total),0));
  return { facturado, pagos, ...(oc.notas_credito?{creditos}:{}), saldo: redondear(facturado - pagos - creditos) };
}
const hash = token => crypto.createHash('sha256').update(token).digest('hex');
function conciliarEstado(estado,ordenes) {
  return estado.partidas.map(p=>{
    const row=ordenes.find(o=>o.id===p.oc_id && o.datos.email===estado.email && o.datos.moneda===estado.moneda);
    if(!row)return {...p,error:'OC no encontrada para este proveedor y moneda'};
    const s=saldo(row.datos);
    const diferencia=redondear(p.saldo-s.saldo);
    const diferenciaDepositos=redondear(p.depositos-s.pagos);
    const facturaCoincide=row.datos.factura?.numero===p.factura;
    return {...p,sistema:s,diferencia,diferenciaDepositos,facturaCoincide,error:!facturaCoincide?'Factura diferente':(diferencia||diferenciaDepositos)?'Diferencias de saldo / depósitos':''};
  });
}
function adjunto(a) {
  exigir(a && typeof a.base64 === 'string' && a.base64.length <= 7000000, 'Adjunte un archivo de hasta 5 MB');
  const bytes = Buffer.from(a.base64, 'base64');
  exigir(bytes.length > 0 && bytes.length <= 5 * 1024 * 1024, 'Archivo inválido');
  const pdf = bytes.subarray(0,5).toString() === '%PDF-';
  const png = bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a';
  const jpg = bytes.subarray(0,3).toString('hex') === 'ffd8ff';
  exigir(pdf || png || jpg, 'Solo PDF, PNG o JPEG');
  return { nombre: String(a.nombre || 'documento').replace(/[^\w. -]/g,'_').slice(0,120), mime: pdf ? 'application/pdf' : png ? 'image/png' : 'image/jpeg', base64: bytes.toString('base64') };
}
module.exports = { exigir, numero, redondear, lineasCompra, totales, totalesConAjustes, compararFactura, saldo, hash, adjunto, conciliarEstado };
