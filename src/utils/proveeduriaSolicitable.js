const fuente=require('../data/proveeduriaArticulosSolicitud.json');
const codigosInventariables=new Set(require('../data/proveeduriaArticulosInventariables.json'));
const equivalenciasInventario=require('../data/proveeduriaCodigosInventario.json');
const codigoInventario=codigo=>Object.hasOwn(equivalenciasInventario,String(codigo))?equivalenciasInventario[String(codigo)]:String(codigo);
const retiradosSolicitud=new Set(require('../data/proveeduriaArticulosRetiradosSolicitud.json'));
const {categoriaArticulo}=require('./proveeduriaCategorias');
const normal=s=>String(s||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ');
const articulosSolicitud=fuente.articulos.map(a=>({...a,categoria:categoriaArticulo(a),iva:a.iva??13,unidad:'UND',inventariable:codigosInventariables.has(a.codigo)}));
// El catálogo fuente se conserva para documentos existentes; estas opciones ya no se solicitan.
const articulosSinInventario=articulosSolicitud.filter(a=>!a.inventariable&&!retiradosSolicitud.has(a.codigo));
const articulosInventariables=articulosSolicitud.filter(a=>a.inventariable);
const porCodigo=new Map(articulosSolicitud.map(a=>[a.codigo,a]));
const porDescripcion=new Map(articulosSolicitud.map(a=>[normal(a.descripcion),a]));
const articuloSolicitud=codigo=>porCodigo.get(String(codigo||''));
const articuloSolicitudDescripcion=descripcion=>porDescripcion.get(normal(descripcion));
const esNoInventariable=l=>{const a=articuloSolicitud(l.codigo);return a?!a.inventariable:l.inventariable===false;};
function catalogoParaOrden(base){
  const catalogo=new Map();
  for(const a of [...articulosSolicitud,...base])if(!catalogo.has(normal(a.descripcion)))catalogo.set(normal(a.descripcion),a.inventariable?{...a,codigo:codigoInventario(a.codigo)}:a);
  return [...catalogo.values()];
}
module.exports={articulosSolicitud,articulosSinInventario,articulosInventariables,articuloSolicitud,articuloSolicitudDescripcion,esNoInventariable,catalogoParaOrden,codigoInventario};
