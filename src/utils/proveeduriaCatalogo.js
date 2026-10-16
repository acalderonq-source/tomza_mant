const fuente=require('../data/proveeduriaArticulosExcel.json');
const {exigir}=require('./proveeduria');
const normal=s=>String(s||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ');
// Igual que BUSCARV del Excel, se conserva la primera coincidencia, incluso si su precio está vacío.
const catalogo=new Map();
for(const a of fuente.articulos)if(!catalogo.has(normal(a.descripcion)))catalogo.set(normal(a.descripcion),a);
function articuloExcel(descripcion){return catalogo.get(normal(descripcion));}
function ivaArticulo(descripcion,alternativo=13){return articuloExcel(descripcion)?.iva??alternativo;}
function condicionesOrden(b){
  const credito=Number(b.credito);
  exigir(b.credito!==''&&b.credito!==undefined&&b.credito!==null&&Number.isInteger(credito)&&credito>=0&&credito<=3650,'Indique los días de crédito (0 para contado, hasta 3650 días)');
  return {credito,condicion:credito?'CREDITO':'CONTADO',forma_pago:credito?'Crédito':'Contado'};
}
module.exports={articulosExcel:[...catalogo.values()],articuloExcel,ivaArticulo,condicionesOrden};
