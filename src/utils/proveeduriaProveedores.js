function limpiarNombre(nombre) {
  const limpio=String(nombre||'').replace(/\s*[•·]\s*$/,'').trim().replace(/\s+/g,' ');
  return /^yacopi(?:\s+s\.?\s*a\.?)?$/i.test(limpio)?'Yacopi S.A.':limpio;
}
function claveProveedor(nombre) {
  return limpiarNombre(nombre).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
}
function proveedoresUnicos(nombres) {
  const encontrados=new Map();
  for(const entrada of nombres){const nombre=limpiarNombre(entrada),clave=claveProveedor(nombre);if(clave&&!encontrados.has(clave))encontrados.set(clave,{nombre,clave});}
  return [...encontrados.values()].sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
}
function correosValidos(valor) {
  const valores=Array.isArray(valor)?valor:String(valor||'').split(/[,;/]+/);
  const lista=valores.map(s=>String(s).trim().toLowerCase()).filter(Boolean);
  if(lista.some(s=>!(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/).test(s)))return [];
  return [...new Set(lista)];
}
function leerContactosTSV(texto) {
  const claves=new Set();
  return texto.replace(/^\uFEFF/,'').split(/\r?\n/).slice(1).filter(l=>l.trim()).map((l,i)=>{
    const campos=l.split('\t');if(campos.length!==5)throw Error(`Fila ${i+2}: se requieren cinco columnas`);
    const [nombre,telefono,correo,direccion,pago]=campos.map(s=>s.trim());
    const clave=claveProveedor(nombre);if(!clave||claves.has(clave))throw Error(`Proveedor repetido o vacío: ${nombre}`);claves.add(clave);
    const condicion_pago=pago.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
    if(condicion_pago&&!['CONTADO','CREDITO'].includes(condicion_pago))throw Error(`Condición desconocida: ${pago}`);
    return {nombre:limpiarNombre(nombre),clave,telefono:/^[\d,]+$/.test(telefono)?telefono.replace(/,/g,''):telefono,correo_original:correo,correos:correosValidos(correo),direccion,condicion_pago:condicion_pago||null};
  });
}
function leerCorreosJSON(valor) {
  if(Array.isArray(valor))return valor;
  try{return JSON.parse(valor||'[]');}catch(_){return [];}
}
module.exports={limpiarNombre,claveProveedor,proveedoresUnicos,correosValidos,leerContactosTSV,leerCorreosJSON};
