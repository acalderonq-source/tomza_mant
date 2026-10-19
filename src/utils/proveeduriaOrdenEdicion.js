const crypto=require('node:crypto');
const {exigir,lineasCompra,totalesConAjustes,hash}=require('./proveeduria');
const {ivaArticulo,condicionesOrden}=require('./proveeduriaCatalogo');
const {correosValidos}=require('./proveeduriaProveedores');
const {articuloSolicitudDescripcion}=require('./proveeduriaSolicitable');
function motivoBloqueoOrden(d){
  if(['PARCIAL','RECIBIDA'].includes(d.estado)||d.recibida_en||d.recepciones?.length)return 'La orden ya tiene mercadería recibida';
  if(d.factura||d.factura_historial?.length||d.facturas_vinculadas?.length||d.pagos?.length)return 'La orden ya tiene facturas o pagos asociados';
  if(d.salida_id)return 'La orden ya tiene una entrega asociada';
  return '';
}
function versionOrden(row){
  const {facturas_vinculadas,...d}=row.datos;
  const ordenar=x=>Array.isArray(x)?x.map(ordenar):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordenar(x[k])])):x;
  return hash(JSON.stringify(ordenar({sede:row.sede,datos:d})));
}
function cambiosOrden(b,solicitud){
  const empresas={'GAS TOMZA':'GAS TOMZA DE COSTA RICA S.A.','SUPER GAS':'ENVASADORA SUPER GAS GLP S.A.'};
  exigir(empresas[b.empresa_destino],'Empresa destinataria inválida');
  exigir(b.origen_formulario==='taller','Use el formulario de edición de la orden');
  let lineas=lineasCompra(Object.values(b.lineas||{}).map(l=>({...l,referencia:l.codigo,codigo:String(l.codigo_producto||'').trim()||articuloSolicitudDescripcion(l.descripcion)?.codigo||'ART-'+crypto.createHash('sha256').update(String(l.descripcion||'')).digest('hex').slice(0,12),iva:ivaArticulo(l.descripcion)})),true);
  if(solicitud?.datos.departamento){
    const pedidas=solicitud.datos.lineas;
    exigir(lineas.length===pedidas.length&&pedidas.every(p=>lineas.some(l=>l.codigo===p.codigo&&l.cantidad===p.cantidad&&l.descripcion===p.descripcion)),'Conserve los artículos y cantidades de la solicitud del departamento');
    lineas=lineasCompra(pedidas.map(p=>({...p,iva:ivaArticulo(p.descripcion,p.iva),precio_unitario:lineas.find(l=>l.codigo===p.codigo).precio_unitario})),true);
  }
  const proveedor=String(b.proveedor||'').trim(),entrega=String(b.entrega||'').trim(),correos=correosValidos(String(b.email||''));
  exigir(proveedor&&entrega&&correos.length,'Complete proveedor, correo válido y plazo de entrega');
  exigir(['CRC','USD'].includes(b.moneda),'Moneda inválida');
  return {lineas,...totalesConAjustes(lineas,{...b,iva:13,iva_global:false}),...condicionesOrden(b),proveedor,email:correos.join(', '),entrega,moneda:b.moneda,empresa_destino:b.empresa_destino,razon_social:empresas[b.empresa_destino],proveedor_telefono:String(b.proveedor_telefono||'').trim().slice(0,120),proveedor_direccion:String(b.proveedor_direccion||'').trim().slice(0,4000),observaciones:String(b.observaciones||''),placa_unidad:String(b.placa_unidad||''),iva_global:false};
}
module.exports={motivoBloqueoOrden,versionOrden,cambiosOrden};
