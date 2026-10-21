const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const XLSX=require('xlsx');
const JSZip=require('jszip');
const ExcelJS=require('exceljs');
const express=require('express');
const service=require('../src/services/capturaGeneralArchivos');
const {createRouter}=require('../src/routes/ventasGas.routes');
const headers=['No Documento','Nombre Cliente','Nombre Comercial','Identificacion','Fecha','Ruta','Unidad Negocio','Clasificacioncontabilidad','Forma Pago','Total General','Total Descuentos','Total Litros','Total Kilos','BRUTO'];
const invoice=(overrides={})=>({id:'100',day:'20/10/2026',unit:'Planta Cartago Gas Tomza',group:'PULPERIAS',payment:'CONTADO',liters:100,kg:54,gross:1000,discount:100,net:900,...overrides});
function file(records,ext='xlsx'){
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([headers,...records.map(r=>[r.id,'Cliente','Comercio','123',r.day,'Ruta 1',r.unit,r.group,r.payment,r.net,r.discount,r.liters,r.kg,r.gross])]),'Reporte general');
 return {filename:'Reporte general.'+ext,buffer:XLSX.write(book,{type:'buffer',bookType:ext==='xls'?'biff8':'xlsx'})};
}
const blank=()=>({records:[],references:[],portfolios:[],sources:[],files:[],revision:0});
async function imported(records,ext){return service.importFiles([file(records,ext)]);}

test('lee XLS y XLSX del sistema, conserva ajustes negativos y crédito con acento dañado',async()=>{
 for(const ext of ['xls','xlsx']){
  const data=await imported([invoice(),invoice({id:'NC1',liters:-10,kg:-5.4,gross:-100,discount:0,net:-100,payment:'CR�DITO'})],ext);
  const model=service.modelFor(service.merge(blank(),data,'admin'));
  assert.equal(model.days[19].documents,2);assert.ok(Math.abs(model.totalKg-48.6)<1e-8);assert.equal(model.totalNet,800);
  assert.equal(model.cells.get('49:20'),-100);assert.equal(model.cells.get('79:20'),-5.4);
  assert.equal(model.days[18].kg,null);assert.equal(model.cells.has('132:20'),false);
 }
});
test('omite duplicados aun si el libro cambia de nombre y rechaza documentos cambiados',async()=>{
 const data=await imported([invoice()]),state=service.merge(blank(),data,'admin');
 const again=await service.importFiles([{...file([invoice()]),filename:'Otro nombre.xlsx'}]);
 const merged=service.merge(state,again,'admin');assert.equal(merged.records.length,1);assert.equal(merged.duplicates,1);assert.equal(service.modelFor(merged).totalNet,900);
 assert.throws(()=>service.merge(state,{...data,records:[{...data.records[0],net:800,gross:900}]},'admin'),/cambió/);
});
test('los días nuevos y meses posteriores no reemplazan los anteriores',async()=>{
 let state=service.merge(blank(),await imported([invoice()]),'a');
 state=service.merge(state,await imported([invoice({id:'101',day:'21/10/2026'}),invoice({id:'102',day:'01/11/2026'})]),'a');
 assert.deepEqual(service.modelFor(state).periods,['2026-10','2026-11']);assert.equal(service.modelFor(state,'2026-10').totalNet,1800);assert.equal(service.modelFor(state,'2026-11').totalNet,900);
});
test('no convierte datos faltantes, clasificaciones desconocidas ni importes inconsistentes en ceros',async()=>{
 await assert.rejects(imported([invoice({group:'SIN CLASIFICAR'})]),/Clasificación/);
 await assert.rejects(imported([invoice({gross:123})]),/no coincide/);
 await assert.rejects(imported([invoice({day:'31/02/2026'})]),/fecha inválida/);
 await assert.rejects(imported([invoice({kg:''})]),/número válido/);
 await assert.rejects(service.importFiles([{filename:'falso.xls',buffer:file([invoice()]).buffer}]),/no corresponde/);
});
test('acepta ZIP y no interpreta machotes vacíos como ventas',async()=>{
 const zip=new JSZip();zip.file('Reporte.xlsx',file([invoice()]).buffer);
 const empty=file([]);zip.file('MACHOTE.xlsx',empty.buffer);
 const data=await service.importFiles([{filename:'Correo.zip',buffer:await zip.generateAsync({type:'nodebuffer'})}]);
 assert.equal(data.records.length,1);assert.deepEqual(data.ignored,['MACHOTE.xlsx']);
 zip.file('otro.zip',Buffer.from('no'));await assert.rejects(service.importFiles([{filename:'Correo.zip',buffer:await zip.generateAsync({type:'nodebuffer'})}]),/ZIP dentro/);
});
test('prioriza resumen diario, compara factura y captura, y conserva vacíos los días sin archivo',()=>{
 const general={day:'2026-10-20',id:'1',unit:'Cartago',kind:'general',category:4,payment:'CONTADO',kg:54,liters:100,gross:1000,discount:100,net:900};
 const daily={...general,id:'HINOS',kind:'diario'};
 const model=service.modelFor({...blank(),records:[general,daily],references:[{day:'2026-10-20',cells:[[25,53]],details:[]}]});
 assert.equal(model.totalKg,54);assert.equal(model.days[19].origin,'Reporte diario');assert.equal(model.differences.length,1);assert.equal(model.days[18].kg,null);
 const changed=service.modelFor({...blank(),records:[general,{...daily,gross:1100,net:1000}]});assert.equal(changed.totalNet,1000);assert.equal(changed.differences.length,2);
});
test('almacenamiento atómico conserva el Excel original exacto después de reinicio',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'captura-import-'));
 try{const store=service.createStore(root),data=await imported([invoice()]),original=Buffer.from(data.files[0].buffer);await store.import(data,'a',0);await assert.rejects(store.import(data,'b',0),e=>e.status===409);const restarted=service.createStore(root),loaded=await restarted.load();assert.equal(loaded.records.length,1);assert.deepEqual(await restarted.readOriginal(loaded.files[0]),original);
  await assert.rejects(store.import({...data,records:[{...data.records[0],gross:500}]},'b',1),/cambió/);assert.equal((await store.load()).revision,1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('la descarga diaria entrega el mismo Excel original byte por byte',async()=>{
 const importedData=await imported([invoice()]),original=Buffer.from(importedData.files[0].buffer),state=service.merge(blank(),importedData,'admin');
 state.references=[{day:'2026-10-01',filename:'Reporte general.xlsx',cells:[[25,12],[34,100]],details:[{sheet:'CAMION PULPERIAS',row:5,kg:12,label:'Chofer recibido',labelColumn:2,plate:'C123456',plateColumn:3}]}];
 const model=service.modelFor(state),book=new ExcelJS.Workbook();await book.xlsx.load(await service.exportExcel(model));
 assert.equal(book.worksheets.length,16);const sheet=book.getWorksheet('VENTAS TOTALES');assert.equal(sheet.getCell('U25').value,54);assert.equal(sheet.getCell('U95').value,'PENDIENTE');assert.equal(sheet.getCell('T25').value,null);assert.equal(sheet.getCell('U131').value,'PENDIENTE');
 assert.equal(book.getWorksheet('CAMION PULPERIAS').getCell('D5').value,12);
 assert.ok(book.getWorksheet('Datos importados').rowCount>1);
 const daily=await JSZip.loadAsync(await service.exportDay(model,'2026-10-20',async()=>original));assert.deepEqual(await daily.file('Reporte general.xlsx').async('nodebuffer'),original);
 const month=await JSZip.loadAsync(await service.exportOriginals(model,async()=>original));assert.deepEqual(await month.file('Reporte general.xlsx').async('nodebuffer'),original);
 const zip=await JSZip.loadAsync(await service.exportDaysZip(model,async()=>original));assert.deepEqual(await zip.file('2026-10-20/Reporte general.xlsx').async('nodebuffer'),original);
 await assert.rejects(service.exportDay(model,'2026-10-19'),/no tiene información/);
});
test('acepta capturas separadas y cartera sin duplicar el total general',()=>{
 const state=service.merge(blank(),{
  records:[],
  references:[
   {day:'2026-10-01',filename:'1-captura general.xls',cells:[[25,100]],details:[]},
   {day:'2026-10-01',filename:'2-CAPTURA GAS TOMZA.xls',cells:[[25,40]],details:[]},
   {day:'2026-10-01',filename:'3-CAPTURA SUPER GAS.xls',cells:[[25,60]],details:[]},
  ],
  portfolios:[{day:'2026-10-01',filename:'16-CARTERA GENERAL.xls',sheet:'COLONES',kind:'cartera',currency:'COLONES',fields:[['SALDO INICIAL',500]]},{day:'2026-10-02',filename:'16-CARTERA GENERAL.xls',sheet:'COLONES',kind:'cartera',currency:'COLONES',fields:[['SALDO INICIAL',525]]}],
  sources:[],files:[{filename:'1-captura general.xls',hash:'a'},{filename:'2-CAPTURA GAS TOMZA.xls',hash:'b'},{filename:'3-CAPTURA SUPER GAS.xls',hash:'c'},{filename:'16-CARTERA GENERAL.xls',hash:'d'}],ignored:[],
 },'admin');
 const model=service.modelFor(state,'2026-10');assert.equal(model.days[0].kg,100);assert.equal(model.days[0].captureFiles,3);assert.equal(model.days[0].portfolioEntries,1);assert.equal(model.totalKg,100);assert.deepEqual(model.originalsByDay.get('2026-10-02').map(file=>file.filename),['1-captura general.xls','2-CAPTURA GAS TOMZA.xls','3-CAPTURA SUPER GAS.xls','16-CARTERA GENERAL.xls']);
});
test('reconoce los libros de cartera incluidos con las capturas',async()=>{
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['GAS TOMZA'],[],[],['FECHA','SALDO INICIAL','CAMION PULPERIAS'],[new Date('2026-10-01T12:00:00Z'),500,25]]);
 XLSX.utils.book_append_sheet(book,sheet,'COLONES');
 const data=await service.importFiles([{filename:'16-CARTERA GENERAL.xlsx',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})}]);
 assert.equal(data.portfolios.length,1);assert.equal(data.portfolios[0].day,'2026-10-01');assert.equal(data.files[0].filename,'16-CARTERA GENERAL.xlsx');
});
test('rutas requieren ADMIN, usan únicamente archivos y exportan la importación guardada',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'captura-router-')),store=service.createStore(root);
 const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));app.use(express.json({limit:'10mb'}));
 app.use((req,_res,next)=>{const role=req.get('x-role');req.session={user:role?{rol:role,id:1}:undefined,csrfToken:'test'};next();});
 app.use(createRouter({fileStore:store}));
 const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));const url='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(url+'/captura-general/archivos/api',{redirect:'manual'})).status,302);
  assert.equal((await fetch(url+'/captura-general/archivos/api',{headers:{'x-role':'TALLER'}})).status,403);
  const headers={'x-role':'ADMIN','Content-Type':'application/json'};
  const home=await fetch(url+'/',{headers,redirect:'manual'});assert.equal(home.status,302);assert.equal(home.headers.get('location'),'/admin/ventas-gas/captura-general/archivos');
  assert.equal((await fetch(url+'/conectar',{method:'POST',headers})).status,404);
  assert.equal((await fetch(url+'/desconectar',{method:'POST',headers})).status,404);
  const page=await fetch(url+'/captura-general/archivos',{headers});assert.equal(page.status,200);assert.match(await page.text(),/Adjuntar archivos/);
  const data=file([invoice()]);const response=await fetch(url+'/captura-general/archivos/importar',{method:'POST',headers,body:JSON.stringify({revision:0,files:[{filename:data.filename,content:data.buffer.toString('base64')}]})});assert.equal(response.status,201);assert.equal((await response.json()).totalNet,900);
  const download=await fetch(url+'/captura-general/archivos/excel?period=2026-10',{headers});assert.equal(download.status,200);assert.match(download.headers.get('content-type'),/zip/);const downloadZip=await JSZip.loadAsync(Buffer.from(await download.arrayBuffer()));assert.deepEqual(await downloadZip.file(data.filename).async('nodebuffer'),data.buffer);
  const daily=await fetch(url+'/captura-general/archivos/excel-dia?day=2026-10-20',{headers});assert.equal(daily.status,200);assert.match(daily.headers.get('content-disposition'),/Capturas-originales-2026-10-20\.zip/);const dailyZip=await JSZip.loadAsync(Buffer.from(await daily.arrayBuffer()));assert.deepEqual(await dailyZip.file(data.filename).async('nodebuffer'),data.buffer);
  const daysZip=await fetch(url+'/captura-general/archivos/dias.zip?period=2026-10',{headers});assert.equal(daysZip.status,200);assert.match(daysZip.headers.get('content-type'),/zip/);
  const large=new JSZip();large.file('Reporte.xlsx',file([invoice({id:'101'})]).buffer);large.file('adjunto.bin',require('node:crypto').randomBytes(3*1024*1024));
  const largeBuffer=await large.generateAsync({type:'nodebuffer'});
  const largeResponse=await fetch(url+'/captura-general/archivos/importar',{method:'POST',headers,body:JSON.stringify({revision:1,files:[{filename:'Correo.zip',content:largeBuffer.toString('base64')}]})});assert.equal(largeResponse.status,201);assert.equal((await largeResponse.json()).totalNet,1800);
  assert.equal((await fetch(url+'/captura-general/archivos/importar',{method:'POST',headers,body:JSON.stringify({files:[{filename:'bad.xlsx',content:'%$!'}],revision:1})})).status,400);
 }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
});

test('excluye el subtotal situado en una fila libre de la captura recibida',()=>{
 const book=XLSX.utils.book_new(),total=XLSX.utils.aoa_to_sheet([]),detail=XLSX.utils.aoa_to_sheet([]);
 total.B9={t:'n',v:46296};total.B12={t:'n',v:1};total.B23={t:'n',v:54};total.B25={t:'n',v:54};total['!ref']='A1:AM140';
 detail.B7={t:'s',v:'Trova Taras'};detail.C7={t:'n',v:54};detail.C70={t:'n',v:54,f:'SUM(C7:C68)'};detail['!ref']='A1:AM73';
 XLSX.utils.book_append_sheet(book,total,'VENTAS TOTALES');XLSX.utils.book_append_sheet(book,detail,'CARBURACION ESTACIONES');
 const parsed=service.parseWorkbook(book,'Captura.xls');assert.equal(parsed.references[0].details.filter(r=>r.sheet==='CARBURACION ESTACIONES').reduce((s,r)=>s+r.kg,0),54);
});
