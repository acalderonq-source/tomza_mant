const JSZip=require('jszip');
const {XMLParser}=require('fast-xml-parser');
const {exigir,centavos}=require('./presupuestosContabilidad');
const {EMPRESAS_BASE,GRUPOS_OPERATIVOS,normalizarEmpresa}=require('./empresasContabilidad');
const lista=v=>v==null?[]:Array.isArray(v)?v:[v];
const texto=v=>v==null?'':typeof v==='object'?String(v['#text']??''):String(v);
async function leerPresupuestoExcel(buffer){
  const zip=await JSZip.loadAsync(buffer);
  const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',parseTagValue:false,processEntities:false});
  async function leer(nombre){const file=zip.file(nombre);exigir(file,'El Excel no contiene '+nombre);const xml=await file.async('string');exigir(xml.length<=16000000,'El Excel contiene una hoja demasiado grande.');return parser.parse(xml);}
  const libro=await leer('xl/workbook.xml');
  const hojas=lista(libro.workbook?.sheets?.sheet).filter(s=>/ordinarios/i.test(s.name));
  exigir(hojas.length===1,'Seleccione el presupuesto individual de una sede, con una única hoja Ordinarios. El consolidado no se importa por esta opción.');
  const hoja=hojas[0];
  const relaciones=await leer('xl/_rels/workbook.xml.rels');
  const relacion=lista(relaciones.Relationships?.Relationship).find(r=>r.Id===hoja['r:id']);
  exigir(relacion,'No se encontró la hoja de presupuesto.');
  const target=require('path').posix.normalize(relacion.Target.startsWith('/')?relacion.Target.slice(1):'xl/'+relacion.Target);
  exigir(target.startsWith('xl/worksheets/'),'Ruta de hoja inválida.');
  let strings=[];
  if(zip.file('xl/sharedStrings.xml')){
    const s=await leer('xl/sharedStrings.xml');
    strings=lista(s.sst?.si).map(si=>si.t!=null?texto(si.t):lista(si.r).map(r=>texto(r.t)).join(''));
  }
  const sheet=await leer(target),filas=[],errores=[];
  let rubro='',totalControl=null,empresaArchivo='';
  const reglas=[[/^planilla$/i,'PLANILLA'],[/^servicios$/i,'SERVICIOS'],[/^gastos operativos (de )?(agencias|tiendas)/i,'GASTOS_GENERALES'],[/^gastos generales$/i,'GASTOS_GENERALES'],[/^mantenimientos?$/i,'MANTENIMIENTO'],[/^impuestos patronales/i,'IMPUESTOS']];
  const valor=c=>{
    if(!c)return null;
    if(c.t==='e')return {error:texto(c.v)};
    if(c.t==='s')return strings[Number(c.v)]||'';
    if(c.t==='inlineStr')return texto(c.is?.t)||lista(c.is?.r).map(r=>texto(r.t)).join('');
    if(c.v==null||texto(c.v)==='')return null;
    if(c.t==='str')return texto(c.v);
    const n=Number(texto(c.v));return Number.isFinite(n)?n:texto(c.v);
  };
  for(const row of lista(sheet.worksheet?.sheetData?.row)){
    const i=Number(row.r);if(i>1000)continue;
    const cells=new Map(lista(row.c).map(c=>[c.r,c]));
    if(i===1){const nombre=normalizarEmpresa(valor(cells.get('A1')));if(EMPRESAS_BASE.includes(nombre))empresaArchivo=nombre;}
    const etiqueta=String(valor(cells.get('B'+i))||'').trim(),normal=etiqueta.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/:$/,'');
    const c=cells.get('D'+i),monto=valor(c);
    if(/^gran total presupuesto.*colones/i.test(normal)&&typeof monto==='number')totalControl=monto;
    const regla=reglas.find(([re])=>re.test(normal));if(regla&&monto==null){rubro=regla[1];continue;}
    if(/sub.?total|gran total|venta proyectada|partidas de presupuesto|^prueba$/i.test(normal)){rubro='';continue;}
    if(!rubro||!etiqueta||/^(total|ttao)\b/i.test(normal))continue;
    if(monto&&typeof monto==='object'&&monto.error){errores.push(`D${i}: ${monto.error}`);continue;}
    if(monto==null){if(c&&Object.hasOwn(c,'f'))errores.push(`D${i}: fórmula sin resultado guardado`);continue;}
    if(typeof monto!=='number'||!Number.isFinite(monto)||monto<0||monto>=1e12){errores.push(`D${i}: monto no válido`);continue;}
    filas.push({celda:'D'+i,concepto:etiqueta,rubro:/diesel|combustible/i.test(normal)?'COMBUSTIBLE':rubro,monto:centavos(monto)/100});
  }
  exigir(filas.length,'No se encontraron partidas importables.');
  const totalImportado=filas.reduce((s,r)=>s+centavos(r.monto),0)/100;
  if(totalControl==null)errores.push('No se encontró el gran total en colones para comprobar la importación.');
  else if(Math.abs(totalImportado-totalControl)>1)errores.push('Las partidas leídas no coinciden con el gran total en colones. Revise el formato de esta hoja.');
  const grupo=normalizarEmpresa(hoja.name);
  if(GRUPOS_OPERATIVOS.includes(grupo))empresaArchivo=grupo;
  return {hoja:hoja.name,empresaArchivo,filas,errores,totalImportado,totalControl};
}
module.exports={leerPresupuestoExcel};
