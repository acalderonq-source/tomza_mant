const path=require('node:path');
const lista=require('../data/proveedoresPasivosPdf');
const identidades=require('../data/proveedoresPasivosIdentidades');
const {clasificar,empresaReceptora,identidad}=require('./pasivosPdf');
const normalizar=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\u00a0\u202f]/g,' ').toUpperCase();
function numero(v){
  let s=String(v).replace(/\s/g,'');const pos=Math.max(s.lastIndexOf(','),s.lastIndexOf('.'));
  if(pos>=0&&s.length-pos-1===2)s=s.slice(0,pos).replace(/[.,]/g,'')+'.'+s.slice(pos+1);
  else s=s.replace(/[.,]/g,'');
  const n=Number(s);return Number.isFinite(n)?n:null;
}
function analizarTexto(texto,nombre=''){
  const t=normalizar(texto),filename=normalizar(nombre);
  if(!/FACTURA|NOTA\s+(?:DE\s+)?CREDITO|COMPROBANTE\s+ELECTRONICO/.test(t))return null;
  const claves=[...new Set((t.match(/506(?:\s*\d){47}(?!\d)/g)||[]).map(k=>k.replace(/\s/g,'')))];
  const claveNombre=filename.match(/506\d{47}(?!\d)/)?.[0];
  const clave=claves.length===1?claves[0]:claves.includes(claveNombre)?claveNombre:'';
  const numeroExplicito=t.match(/(?:CONSECUTIVO|FACTURA\s*(?:ELECTRONICA)?|NOTA\s+DE\s+CREDITO\s+ELECTRONICA)\s*(?:N[º°O.]*\s*)?[:#\-]?\s*(\d{20})(?!\d)/)?.[1];
  if(clave&&numeroExplicito&&numeroExplicito!==clave.slice(21,41))return null;
  const consecutivo=numeroExplicito||(clave?clave.slice(21,41):filename.match(/(?:^|\D)(\d{20})(?!\d)/)?.[1]);
  if(!consecutivo)return null;
  const cedulaEmisor=clave?identidad(clave.slice(9,21)):'';
  const fiscal=identidades.find(r=>r[0]===cedulaEmisor)||identidades.find(r=>{
    const rx=new RegExp('(?:^|[^0-9])'+r[0].split('').join('[ -]*')+'(?![0-9])');return rx.test(t);
  });
  let proveedor=fiscal?.[1]||'';
  // La búsqueda por nombre solo completa PDFs sin clave/cédula identificable.
  if(!proveedor){
    const canon=v=>normalizar(v).replace(/[^A-Z0-9]/g,'');const compacto=canon(t);
    const candidatos=lista.filter(p=>p.alias.some(a=>canon(a).length>=8&&compacto.includes(canon(a))));
    const nombres=[...new Set(candidatos.map(p=>p.nombre))];if(nombres.length===1)proveedor=nombres[0];
  }
  const empresas=[['3101349880','GAS TOMZA'],['3101044021','SUPER GAS']].filter(([id])=>new RegExp('(?:^|[^0-9])'+id.split('').join('[ -]*')+'(?![0-9])').test(t));
  let empresa=empresas.length===1?empresas[0][1]:'';
  if(!empresa){
    const receptor=t.match(/(?:RECEPTOR|CLIENTE|DATOS DEL CLIENTE)[\s\S]{0,250}/)?.[0]||'';
    if(/GAS\s+TOMZA\s+DE\s+COSTA\s+RICA/.test(receptor))empresa='GAS TOMZA';
    else if(/(?:ENVASADORA\s+)?SUPER\s*GAS/.test(receptor))empresa='SUPER GAS';
  }
  const patronMonto='\\d[\\d., \\t]*[.,]\\d{2}(?!\\d)';
  const etiquetados=[...t.matchAll(new RegExp('TOTAL\\s*(?:(?:DEL\\s*)?COMPROBANTE|FACTURA)\\s*[:.]?\\s*[¢₡$]?\\s*('+patronMonto+')','g'))];
  const generales=[...t.replace(/MONTO\s+TOTAL/g,'MONTO_GENERAL').replace(/SUB\s+TOTAL/g,'SUBTOTAL').matchAll(new RegExp('(?:^|\\s)TOTAL\\s*:?\\s*[¢₡$]?\\s*('+patronMonto+')','g'))];
  const valores=[...new Set((etiquetados.length?etiquetados:generales).map(m=>numero(m[1])).filter(n=>n!==null))];
  const total=valores.length===1?valores[0]:null;
  const explicita=t.match(/(?:CODIGO\s*(?:DE\s*)?MONEDA|MONEDA)[\s:.\n-]*(CRC|USD)/)?.[1];
  const moneda=explicita||(/COLONES|COLON COSTARRICENSE|[¢₡]/.test(t)?'CRC':/DOLARES|DOLAR ESTADOUNIDENSE|\bUSD\b/.test(t)?'USD':null);
  const credito=consecutivo.slice(8,10)==='03'||/NOTA\s+(?:DE\s+)?CREDITO/.test(t);
  const referencia=t.match(/(?:DOCUMENTO\s+DE\s+REFERENCIA\s*(?:N[º°O.]*)?\s*:|FACTURA\s+ELECTRONICA)\s*(\d{20})/)?.[1]||'';
  const p=clasificar(proveedor,empresa,fiscal?.[0]||cedulaEmisor);
  return {proveedor_nombre:proveedor||'Proveedor por identificar',empresa:p?.empresa||empresa,grupo:p?.grupo||'',cedulaEmisor:fiscal?.[0]||cedulaEmisor,numero_factura:consecutivo,clave,monto:total===null?null:total*(credito?-1:1),moneda,tipoDocumento:credito?'nota_credito':'factura',referenciaFactura:referencia,fuenteIdentificacion:'PDF',identificado:!!p&&['GAS TOMZA','SUPER GAS'].includes(empresa)};
}
async function leerPdf(buffer,nombre){
  if(!Buffer.isBuffer(buffer)||buffer.length>8*1024*1024||!buffer.subarray(0,1024).includes(Buffer.from('%PDF-')))throw Error('PDF inválido');
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=getDocument({data:new Uint8Array(buffer),isEvalSupported:false,useSystemFonts:false,verbosity:0,standardFontDataUrl:path.join(path.dirname(require.resolve('pdfjs-dist/package.json')),'standard_fonts')+path.sep});
  try{
    const doc=await task.promise;if(doc.numPages>20)throw Error('PDF de más de 20 páginas; requiere revisión');
    const lineas=[];
    for(let n=1;n<=doc.numPages;n++){
      const page=await doc.getPage(n),content=await page.getTextContent();if(content.items.length>10000)throw Error('PDF demasiado complejo; requiere revisión');
      const grupos=[];
      for(const item of content.items){if(!item.str?.trim())continue;let g=grupos.find(g=>Math.abs(g.y-item.transform[5])<2);if(!g){g={y:item.transform[5],items:[]};grupos.push(g);}g.items.push(item);}
      for(const g of grupos.sort((a,b)=>b.y-a.y)){
        let linea='',anterior;
        for(const item of g.items.sort((a,b)=>a.transform[4]-b.transform[4])){const espacio=anterior&&item.transform[4]-(anterior.transform[4]+anterior.width)>1;linea+=(espacio?' ':'')+item.str;anterior=item;}lineas.push(linea);
      }
      page.cleanup();
    }
    return analizarTexto(lineas.join('\n'),nombre);
  }finally{await task.destroy();}
}
module.exports={analizarTexto,leerPdf};
