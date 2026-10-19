const fuente=require('../data/proveeduriaArticulosSolicitud.json');
const normal=s=>String(s||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ');
const articulosSolicitud=fuente.articulos.map(a=>({...a,iva:a.iva??13,unidad:'UND',inventariable:false}));
const porCodigo=new Map(articulosSolicitud.map(a=>[a.codigo,a]));
const porDescripcion=new Map(articulosSolicitud.map(a=>[normal(a.descripcion),a]));
const articuloSolicitud=codigo=>porCodigo.get(String(codigo||''));
const articuloSolicitudDescripcion=descripcion=>porDescripcion.get(normal(descripcion));
const esNoInventariable=l=>l.inventariable===false||Boolean(articuloSolicitud(l.codigo));
function catalogoParaOrden(base){
  const catalogo=new Map();
  for(const a of [...articulosSolicitud,...base])if(!catalogo.has(normal(a.descripcion)))catalogo.set(normal(a.descripcion),a);
  return [...catalogo.values()];
}
module.exports={articulosSolicitud,articuloSolicitud,articuloSolicitudDescripcion,esNoInventariable,catalogoParaOrden};
