const JSZip=require('jszip');
const {XMLParser}=require('fast-xml-parser');
const {exigir}=require('./presupuestosContabilidad');
const array=v=>v==null?[]:Array.isArray(v)?v:[v];
const text=v=>v==null?'':typeof v==='object'?String(v['#text']??''):String(v);
async function leerLibroCompleto(buffer){
  const zip=await JSZip.loadAsync(buffer);
  const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',parseTagValue:false,processEntities:false});
  async function xml(path){const f=zip.file(path);exigir(f,'Falta una parte del Excel: '+path);const s=await f.async('string');exigir(s.length<25000000,'Una hoja supera el tamaño permitido.');return parser.parse(s);}
  const libro=await xml('xl/workbook.xml'),rels=await xml('xl/_rels/workbook.xml.rels');
  const paths=new Map(array(rels.Relationships.Relationship).map(r=>[r.Id,r.Target]));
  let strings=[];
  let estilos=[];
  if(zip.file('xl/styles.xml')){
    const styles=(await xml('xl/styles.xml')).styleSheet;
    const formatos=new Map(array(styles.numFmts?.numFmt).map(f=>[Number(f.numFmtId),f.formatCode]));
    estilos=array(styles.cellXfs?.xf).map(f=>{const id=Number(f.numFmtId),codigo=String(formatos.get(id)||'').replace(/"[^"]*"|\[[^\]]*\]/g,'');return (id>=14&&id<=22)||(/[dy]/i.test(codigo)&&/[m]/i.test(codigo));});
  }
  if(zip.file('xl/sharedStrings.xml'))strings=array((await xml('xl/sharedStrings.xml')).sst.si).map(s=>s.t!=null?text(s.t):array(s.r).map(r=>text(r.t)).join(''));
  const hojas=[];
  for(const sh of array(libro.workbook.sheets.sheet)){
    const target=paths.get(sh['r:id']);exigir(target,'No se encontró la hoja '+sh.name);
    const path=require('path').posix.normalize(target.startsWith('/')?target.slice(1):'xl/'+target);exigir(path.startsWith('xl/worksheets/'),'Ruta de hoja inválida.');
    const sheet=(await xml(path)).worksheet,filas=[];let errores=0,sinResultado=0;
    for(const row of array(sheet.sheetData?.row)){
      const celdas=[];
      for(const c of array(row.c)){
        const formula=Object.hasOwn(c,'f'),cache=c.v!=null&&text(c.v)!=='';
        let valor=null,tipo='vacio';
        if(c.t==='s'){valor=strings[Number(c.v)]??'';tipo='texto';}
        else if(c.t==='inlineStr'){valor=c.is?.t!=null?text(c.is.t):array(c.is?.r).map(r=>text(r.t)).join('');tipo='texto';}
        else if(c.t==='e'){valor=text(c.v);tipo='error';errores++;}
        else if(cache){const n=Number(text(c.v));if(!['str','b'].includes(c.t)&&Number.isFinite(n)){valor=n;tipo='numero';}else{valor=text(c.v);tipo='texto';}}
        else if(formula)sinResultado++;
        if(valor===null&&!formula)continue;
        const celda={direccion:c.r,valor,tipo};
        if(tipo==='numero'&&estilos[Number(c.s)])celda.esFecha=true;
        if(formula){celda.formula=text(c.f);if(typeof c.f==='object'&&c.f.si!=null)celda.formulaCompartida=c.f.si;}
        celdas.push(celda);
      }
      if(celdas.length)filas.push({numero:Number(row.r),celdas});
    }
    hojas.push({nombre:sh.name,oculta:sh.state==='hidden'||sh.state==='veryHidden',filas,errores,sinResultado});
  }
  const primera=hojas[0];const periodoOriginal=primera?.filas.flatMap(r=>r.celdas).find(c=>c.direccion==='B3')?.valor||'';
  return {hojas,periodoOriginal,errores:hojas.reduce((s,h)=>s+h.errores,0),sinResultado:hojas.reduce((s,h)=>s+h.sinResultado,0),vinculosExternos:Object.keys(zip.files).filter(p=>/^xl\/externalLinks\/externalLink\d+\.xml$/.test(p)).length};
}
module.exports={leerLibroCompleto};
