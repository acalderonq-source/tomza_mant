// Las plantillas tienen cifras reales y no se publican (el repositorio es público):
// sin ellas, por ejemplo en GitHub, estas pruebas se omiten en lugar de fallar.
const sinPlantillas=['informes-junta/informe-original.xlsx','informes-junta/presentacion-original.pptx'].some(p=>!require('node:fs').existsSync(require('node:path').join(__dirname,'../src/templates',p)));
const test=(nombre,...resto)=>require('node:test')(nombre,{skip:sinPlantillas&&'Plantilla privada no incluida en el repositorio'},resto.at(-1));
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const ExcelJS=require('exceljs'),JSZip=require('jszip');
const {DOMParser}=require('@xmldom/xmldom');
const {createModel,NA}=require('../src/services/informesJuntaCalculos');
const {buildAutomatic,overlays}=require('../src/services/informesJuntaAutomaticos');
const templates=require('../src/services/informesJuntaPlantillas');
const {toEot}=require('../src/services/informesJuntaFuentes');

function fixture(full=true){
  const records=[
    ['G1','GRANEL',100,120],['G1','GRANEL',0,80],['G2','GRANEL',6000,7000],['G3','GRANEL',12000,15000],['G4','GRANEL',30000,35000],
    ['P1','PULPERIAS',200,300],['P2','PULPERIAS',5000,6000],['P3','PULPERIAS',10000,12000],
    ['D1','DISTRIBUIDOR',3000,4000],['D2','DISTRIBUIDOR',8000,9000],['D3','DISTRIBUIDOR PLANTA',20000,21000],
    ...(full?[['GG1','GRAN GRANEL',60000,70000],['GG2','GRAN GRANEL',40000,45000],['C1','CARBURACION',60000,65000],['C2','CARBURACION',30000,35000],['C3','CARBURACION',15000,16000],['C4','CARBURACION',7000,8000],['C5','CARBURACION',1000,1200]]:[])
  ].map(([codigo,cc,aug,sep])=>({codigo,cc,nombre:codigo,grupo:cc,division:'Prueba',ruta:'1',canal:'Prueba',sourceFile:'Fuente.xlsx',values:{'2026-08':aug,'2026-09':sep}}));
  return {id:'test',revision:1,data:{filename:'Fuente.xlsx',months:['2026-08','2026-09'],records},params:{period:'2026-09',days:26,target:null,title:'Informe de resultados',unit:'Kilos',notes:''}};
}

test('evalúa fórmulas de plantilla, rangos y referencias cruzadas sin ejecutar texto',()=>{
  const book=new ExcelJS.Workbook(),a=book.addWorksheet('A'),b=book.addWorksheet('Otra hoja');
  a.getCell('A1').value=10;a.getCell('A2').value=20;a.getCell('B1').value={formula:'SUM(A1:A2)',result:30};
  b.getCell('A1').value={formula:"+'A'!B1/2",result:15};
  a.getCell('C1').value={formula:'IF(A1>0,SUMPRODUCT(A1:A2,A1:A2),1/0)',result:500};
  a.getCell('D1').value={formula:'AVERAGE(A1:A2)',result:15};
  const model=createModel(book,new Map([['A!A1',30]]));
  assert.equal(model.get('A','B1').value,50);assert.equal(model.get('Otra hoja','A1').value,25);
  assert.equal(model.get('A','C1').value,1300);assert.equal(model.get('A','D1').value,25);
  a.getCell('E1').value={formula:'UNKNOWN(A1)',result:99};
  assert.deepEqual(model.get('A','E1').value,NA);
  a.getCell('F1').value={formula:'UNKNOWN(A2)',result:99};assert.equal(model.get('A','F1').value,99);
});

test('rellena volúmenes y clientes por tramo, agrega códigos repetidos y recalcula totales y variaciones',async()=>{
  const auto=await buildAutomatic(fixture()),get=(sheet,cell)=>auto.model.get(sheet,cell).value;
  assert.equal(get('Por canal','G8'),34000);assert.equal(get('Por canal','J8'),18300);assert.equal(get('Por canal','K8'),52300);
  assert.equal(get('Por canal','L8'),57200);assert.equal(get('Por canal','M8'),115000);assert.equal(get('Por canal','N8'),125200);
  assert.equal(get('Por canal','O8'),349700);assert.equal(get('Venta Total','E7'),349700);
  assert.equal(get('Histórico de Venta Total','I13'),349700);
  assert.equal(get('Productividad Histórica G','Q8'),35000);assert.equal(get('Productividad Histórica G','Q9'),1);
  assert.equal(get('Productividad Histórica G','Q14'),200);assert.equal(get('Productividad Histórica G','Q15'),1);
  assert.equal(get('Productividad Histórica G','Q18'),57200);assert.equal(get('Productividad Histórica G','Q22'),4);
  assert.equal(get('Productividad Histórica G','Q23'),14300);assert.equal(get('Productividad Histórica G','Q24'),2200);
  assert.equal(get('Venta Directa en Envasado','K18'),52300);assert.equal(get('Venta Directa en Envasado','F18'),34000/52300);
  assert.equal(get('Por canal','L26'),57200-1781985);
  assert.equal(auto.pending.length,0);
});

test('falta de fuentes marca errores pendientes y no reutiliza valores viejos; días y ajustes se aplican',async()=>{
  const report=fixture(false),auto=await buildAutomatic(report);
  assert.deepEqual(auto.model.get('Por canal','M8').value,NA);assert.deepEqual(auto.model.get('Por canal','N8').value,NA);
  assert.deepEqual(auto.model.get('Venta Total','E7').value,NA);assert.deepEqual(auto.model.get('Por canal','O8').value,NA);
  assert.equal(auto.model.get('Por canal','K8').value,52300);assert.deepEqual(auto.pending,['Gran Granel','Carburación']);
  const meta=(await templates.manifest()).sheets.find(sheet=>sheet.name==='Base de Datos Ventas');
  report.templateEdits={cells:{[`${meta.id}:E18`]:35000},texts:{},images:{}};report.params.days=25;
  const edited=await buildAutomatic(report);assert.equal(edited.model.get('Por canal','G8').value,35000);
  assert.equal(edited.model.get('Productividad Histórica G','Q24').value,57200/25);
  const overflow=fixture(false);overflow.data.records[0].values['2026-09']=60000;
  await assert.rejects(buildAutomatic(overflow),/50.000/);
});

test('Excel automático conserva las 43 hojas, estilos y gráficos; no pierde celdas vacías contiguas',async()=>{
  const report=fixture(false),buffer=await templates.exportTemplate(report,'xlsx');
  const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
  assert.equal(book.worksheets.length,43);
  assert.equal(book.getWorksheet('Por canal').getCell('G8').value.result,34000);
  assert.equal(book.getWorksheet('Por canal').getCell('I8').value,18300);
  assert.equal(book.getWorksheet('Por canal').getCell('F8').value,0);
  assert.equal(book.getWorksheet('Por canal').getCell('H8').value,0);
  assert.deepEqual(book.getWorksheet('Por canal').getCell('O8').value.result,NA);
  const original=await JSZip.loadAsync(await templates.template('xlsx')),output=await JSZip.loadAsync(buffer),parse=text=>new DOMParser().parseFromString(text,'application/xml');
  for(const file of Object.keys(original.files).filter(file=>/styles\.xml|xl\/charts\/|xl\/drawings\//.test(file)&&!original.files[file].dir))assert.deepEqual(await output.file(file).async('nodebuffer'),await original.file(file).async('nodebuffer'),file);
  for(const file of Object.keys(original.files).filter(file=>/^xl\/worksheets\/sheet\d+\.xml$/.test(file))){
    const before=[...parse(await original.file(file).async('string')).getElementsByTagName('c')],after=[...parse(await output.file(file).async('string')).getElementsByTagName('c')];
    const styles=new Map(after.map(cell=>[cell.getAttribute('r'),cell.getAttribute('s')]));
    assert.equal(styles.size,after.length,'No hay coordenadas duplicadas');
    for(const cell of before)assert.equal(styles.get(cell.getAttribute('r')),cell.getAttribute('s'),`${file} ${cell.getAttribute('r')}`);
  }
});

test('PPT se rellena automáticamente con números editables, conserva originales, no altera fotos ni posiciones',async()=>{
  const report=fixture(false),original=await JSZip.loadAsync(await templates.template('pptx')),output=await JSZip.loadAsync(await templates.exportTemplate(report,'pptx'));
  const slides=Object.keys(output.files).filter(file=>/^ppt\/slides\/slide\d+\.xml$/.test(file));assert.equal(slides.length,29);
  for(const file of Object.keys(original.files).filter(file=>/^ppt\/(media|slideLayouts|slideMasters|theme)\//.test(file)&&!original.files[file].dir))assert.deepEqual(await output.file(file).async('nodebuffer'),await original.file(file).async('nodebuffer'),file);
  for(const file of slides){
    const before=await original.file(file).async('string'),after=await output.file(file).async('string');
    for(const pic of before.match(/<p:pic>[\s\S]*?<\/p:pic>/g)||[])assert.ok(after.includes(pic),`Imagen / transformación intacta: ${file}`);
    for(const geometry of before.match(/<p:spPr>[\s\S]*?<\/p:spPr>/g)||[])assert.ok(after.includes(geometry),`Forma original intacta: ${file}`);
    const doc=new DOMParser().parseFromString(after,'application/xml'),originalDoc=new DOMParser().parseFromString(before,'application/xml');
    const originalIds=new Set([...originalDoc.getElementsByTagName('p:cNvPr')].map(node=>node.getAttribute('id')));
    const ids=[...doc.getElementsByTagName('p:cNvPr')].filter(node=>node.getAttribute('name').startsWith('AUTO ')).map(node=>node.getAttribute('id'));
    assert.equal(ids.length,new Set(ids).size);assert.ok(ids.every(id=>!originalIds.has(id)));
  }
  const slide=await output.file('ppt/slides/slide12.xml').async('string');assert.match(slide,/AUTO Productividad Histórica G!Q18/);assert.match(slide,/>57,200<\/a:t>/);
  const channels=await output.file('ppt/slides/slide10.xml').async('string');assert.match(channels,/>34,000<\/a:t>/);assert.match(channels,/>18,300<\/a:t>/);assert.match(channels,/Pendiente/);
  assert.match(await output.file('ppt/slides/slide17.xml').async('string'),/>PEND\.<\/a:t>/);
  assert.equal(Object.keys(output.files).filter(file=>file.endsWith('.fntdata')).length,4);
  assert.match(await output.file('ppt/presentation.xml').async('string'),/embeddedFontLst/);
  const blocks=await overlays(await buildAutomatic(report));
  for(const block of blocks){const image=(await templates.manifest()).slides.find(slide=>slide.number===block.slide).images.find(image=>image.name===block.image);for(const cell of block.cells){assert.ok(cell.x>=0&&cell.y>=0&&cell.x+cell.w<=image.width&&cell.y+cell.h<=image.height,`${block.image} ${cell.address}`);assert.ok(cell.fontPx>0);}}
});

test('Lato se incrusta completo con cabecera EOT válida y permiso de edición',async()=>{
  const raw=await fs.readFile(path.join(__dirname,'../public/fonts/lato/Lato-Regular.ttf')),font=toEot(raw);
  assert.equal(font.readUInt32LE(0),font.length);assert.equal(font.readUInt32LE(4),raw.length);
  assert.equal(font.readUInt32LE(8),0x00010000);assert.equal(font.readUInt16LE(34),0x504c);assert.equal(font.readUInt16LE(32)&0x0002,0);
  assert.deepEqual(font.subarray(font.length-raw.length),raw);
});
