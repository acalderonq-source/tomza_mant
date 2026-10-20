const path=require('node:path');
const {Parser}=require('htmlparser2');
const css=require('css-tree');
const integridad=require('../data/integridadRecursos.json');
const nonceExpr="<%= typeof cspNonce !== 'undefined' ? cspNonce : '' %>";
const escapar=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function editarTags(source,transform){
 const cambios=[];
 const parser=new Parser({onopentag(nombre,attrs){const start=parser.startIndex,end=parser.endIndex+1;const raw=source.slice(start,end);const texto=transform(nombre,attrs,raw);if(texto!==raw)cambios.push({start,end,texto});}},{decodeEntities:true});
 parser.write(source);parser.end();
 for(const c of cambios.reverse())source=source.slice(0,c.start)+c.texto+source.slice(c.end);
 return source;
}
function literalAtributo(source){return source.split(/(<%[\s\S]*?%>)/g).map(part=>part.startsWith('<%')?part:part.replace(/"/g,'&quot;')).join('');}
function prepararFuente(source){
 return editarTags(source,(nombre,attrs,raw)=>{
  if(['script','style'].includes(nombre)&&!Object.hasOwn(attrs,'nonce'))raw=raw.replace(/\s*\/?>(\s*)$/,` nonce="${nonceExpr}">$1`);
  const recurso=nombre==='script'?attrs.src:nombre==='link'&&attrs.rel==='stylesheet'?attrs.href:null;
  if(recurso&&integridad[recurso]&&!attrs.integrity)raw=raw.replace(/\s*\/?>(\s*)$/,` integrity="${integridad[recurso]}" crossorigin="anonymous">$1`);
  return raw.replace(/\s+on(click|change|submit)\s*=\s*(["'])([\s\S]*?)\2/gi,(_all,event,_quote,code)=>{
   const confirm=code.trim().match(/^return\s+confirm\((['"])([\s\S]*)\1\);?$/);
   if(confirm)return ` data-confirm-${event.toLowerCase()}="${literalAtributo(confirm[2])}"`;
   if(event.toLowerCase()==='change'&&/^this\.form\.submit\(\);?$/.test(code.trim()))return ' data-submit-on-change';
   if(event.toLowerCase()==='click'&&/^(?:window\.)?print\(\);?$/.test(code.trim()))return ' data-print';
   if(event.toLowerCase()==='click'&&/^(?:window\.)?history\.back\(\);?$/.test(code.trim()))return ' data-history-back';
   throw Error('Evento inline no migrado: '+event+' '+code.slice(0,80));
  });
 });
}
function configurarVistasSeguras(ejs,root=path.resolve(__dirname,'../views')){
 if(ejs.fileLoader.__vistasSeguras)return;
 const original=ejs.fileLoader;
 const loader=file=>{
  const source=original(file),rel=path.relative(root,path.resolve(String(file)));
  return rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)&&String(file).endsWith('.ejs')?prepararFuente(String(source)):source;
 };
 loader.__vistasSeguras=true;ejs.fileLoader=loader;
}
function estiloSeguro(texto){
 if(typeof texto!=='string'||texto.length>4000||/[<>]/.test(texto))return null;
 try{
  const ast=css.parse(texto,{context:'declarationList',parseCustomProperty:true,onParseError(e){throw e;}});
  let valido=true;
  ast.children.forEach(n=>{if(n.type!=='Declaration')valido=false;});
  css.walk(ast,n=>{if(['Raw','Url','Atrule'].includes(n.type)||n.type==='Function'&&/^(expression|url)$/i.test(n.name)||n.type==='Declaration'&&/^(behavior|-moz-binding)$/i.test(n.property))valido=false;});
  return valido?css.generate(ast):null;
 }catch(_){return null;}
}
function finalizarHtmlSeguro(html,nonce){
 if(typeof html!=='string'||!nonce)return html;
 const reglas=[];
 let output=editarTags(html,(_nombre,attrs,raw)=>{
  if(!Object.hasOwn(attrs,'style'))return raw;
  const estilo=estiloSeguro(attrs.style);
  raw=raw.replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'');
  if(!estilo)return raw;
  const id='s'+reglas.length;
  reglas.push(`[data-safe-style="${id}"]{${estilo}}`);
  return raw.replace(/(\/?>)$/,` data-safe-style="${id}"$1`);
 });
 const head=`<meta name="csp-nonce" content="${escapar(nonce)}"><script src="/js/eventos-seguros.js"></script>`;
 output=output.replace(/<head\b[^>]*>/i,tag=>tag+head);
 if(reglas.length)output=output.replace(/<\/head>/i,`<style nonce="${escapar(nonce)}">${reglas.join('\n')}</style></head>`);
 return output;
}
module.exports={prepararFuente,configurarVistasSeguras,finalizarHtmlSeguro,estiloSeguro,editarTags};
