const {exigir}=require('./proveeduria');
const {normalizarEmpresa}=require('./empresasContabilidad');
const identidad=v=>String(v||'').replace(/\D/g,'').replace(/^0+/,'');
const empresasFiscales={'3101349880':'GAS TOMZA','3101044021':'SUPER GAS'};
function identificarReceptor(e,receptores){
  const r=receptores.find(r=>identidad(r.cedula)===identidad(e.receptor)&&Number(r.activo??1)===1);
  exigir(r,'La factura no está emitida a una empresa receptora autorizada. Revise la cédula del receptor del XML.');
  const empresa=normalizarEmpresa(r.nombre);
  exigir(!empresasFiscales[identidad(r.cedula)]||empresasFiscales[identidad(r.cedula)]===empresa,'La empresa configurada no corresponde a su cédula fiscal; Administración debe corregir el catálogo de receptores.');
  // La cédula del catálogo es la autoridad; el nombre del XML no puede cambiar de empresa.
  exigir(empresa&&empresa===normalizarEmpresa(e.nombre_receptor),`El nombre del receptor del XML (${e.nombre_receptor||'vacío'}) no corresponde a la cédula autorizada de ${r.nombre}.`);
  return {cedula:r.cedula,nombre:r.nombre,empresa};
}
function empresaFactura(d){return empresasFiscales[identidad(d.factura?.electronica?.receptor)]||d.empresa_receptora?.empresa||normalizarEmpresa(d.factura?.electronica?.nombre_receptor||d.razon_social)||'Sin identificar';}
function empresasOrden(o){return [...new Set([o.razon_social,o.empresa_destino].map(normalizarEmpresa).filter(Boolean))];}
function diferenciaEmpresa(d,o){
  const actual=empresaFactura(d),esperadas=empresasOrden(o);
  const e=d.factura?.electronica;
  if((empresasFiscales[identidad(e?.receptor)]||d.empresa_receptora)&&normalizarEmpresa(e?.nombre_receptor)!==actual)return `El nombre del receptor del XML no corresponde a la cédula de ${actual}. Solicite al proveedor corregir el comprobante.`;
  if(esperadas.length>1)return `La OC tiene empresas contradictorias: ${esperadas.join(' / ')}. Corrija la orden antes de aceptar la factura.`;
  if(esperadas.length&&esperadas[0]!==actual)return `La OC es de ${esperadas[0]}, pero la factura está emitida a ${actual}. Solicite al proveedor una factura para ${esperadas[0]}; no se puede aceptar ni pagar con esta orden.`;
  return '';
}
module.exports={identificarReceptor,empresaFactura,empresasOrden,diferenciaEmpresa};
