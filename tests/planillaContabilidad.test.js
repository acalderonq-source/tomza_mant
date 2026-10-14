const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('path');
const pool=require('../src/db');
const P=require('../src/utils/presupuestosContabilidad');
const {extraerPersonas,calcular,validarFecha}=require('../src/utils/planillaContabilidad');
const parent=require('../src/routes/presupuestos.routes');
const user={id:1,rol:'CONTABILIDAD',usuario:'Conta'};
const persona={id:7,periodo:'2026-09',empresa:'GAS TOMZA',moneda:'CRC',sede:'General de la empresa',departamento:'GENERAL',nombre:'Persona de prueba',puesto:'Chofer',grupo:'Operaciones',presupuesto:1000,periodo_origen:'AGOSTO 2026',version:1};
async function servidor(query,run,usuario=user){
 const original=pool.query,connection=pool.getConnection;pool.query=query;let commits=0,rollbacks=0;
 pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{commits++;},rollback:async()=>{rollbacks++;},release(){}});
 const app=express();app.set('views',path.resolve(__dirname,'../src/views'));app.set('view engine','ejs');app.use(express.urlencoded({extended:true}));app.use((req,_r,n)=>{req.session={user:usuario};n();});app.use('/contabilidad/presupuestos',parent);
 const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));
 try{await run('http://127.0.0.1:'+s.address().port+'/contabilidad/presupuestos',()=>({commits,rollbacks}));}finally{await new Promise(r=>s.close(r));pool.query=original;pool.getConnection=connection;}
}
test('el control salarial conserva referencias, descarta cabeceras y subtotales y no importa gasto real',()=>{
 const c=(col,n,valor,tipo='texto')=>({direccion:col+n,valor,tipo});
 const datos={hojas:[{nombre:'Planilla',filas:[{numero:3,celdas:[c('A',3,'AGOSTO 2026')]},{numero:7,celdas:[c('D',7,'NOMBRE'),c('E',7,'PUESTO')]},{numero:10,celdas:[c('D',10,'Choferes')]},{numero:11,celdas:[c('D',11,'Persona A'),c('E',11,'Chofer'),c('F',11,1000,'numero')]},{numero:12,celdas:[c('D',12,'Total Choferes'),c('F',12,1000,'numero')]},{numero:13,celdas:[c('D',13,'Persona B'),c('E',13,'Chofer'),c('F',13,'#REF!','error')]}]}]};
 const r=extraerPersonas(datos);assert.equal(r.length,2);assert.equal(r[0].grupo,'Choferes');assert.equal(r[0].presupuesto,1000);assert.equal(r[0].periodoOrigen,'AGOSTO 2026');assert.equal(r[1].presupuesto,null);assert.equal(r[0].salario,undefined);
});
test('costo, neto y pagos se calculan por separado y respetan centavos',()=>{
 assert.deepEqual(calcular(1000,100,200,400),{bruto:110000,rebajos:20000,neto:90000,pagado:40000,saldo:50000});
 assert.equal(calcular('0.10','0.20',0).neto,30);assert.throws(()=>calcular(100,0,101));assert.throws(()=>calcular(100,0,20,81));
 assert.equal(validarFecha('2026-09-30'),'2026-09-30');assert.throws(()=>validarFecha('2026-09-31'));
});
test('roles ajenos no acceden al control de planilla',async()=>{
 await servidor(()=>{throw new Error('No debe consultar datos');},async base=>assert.equal((await fetch(base+'/planilla')).status,403),{rol:'TALLER'});
});
test('Planilla abre como pantalla nativa con salarios reales vacíos, sin cabeceras de Excel',async()=>{
 await servidor(async sql=>{
  if(sql.startsWith('SELECT p.*,r.id'))return [[{...persona,registro_id:null,pagado:0}]];
  if(sql.includes("rubro='PLANILLA'"))return [[{...persona,rubro:'PLANILLA',monto:2000}]];
  return [[]];
 },async base=>{
  const r=await fetch(base+'/planilla?periodo=2026-09&empresa=GAS+TOMZA');assert.equal(r.status,200);const html=await r.text();for(const s of ['Control de planilla','Persona de prueba','Salario real','Registrar gasto real','Sin registrar','AGOSTO 2026'])assert.ok(html.includes(s),s);assert.doesNotMatch(html,/<th>A<\/th>|<th>B<\/th>/);
 });
});
test('registrar gasto exige fecha del mes y audita dentro de la transacción',async()=>{
 let inserts=[];
 await servidor(async(sql,params)=>{if(sql.startsWith('SELECT * FROM cont_planilla_personas'))return [[persona]];if(sql.startsWith('INSERT'))inserts.push({sql,params});return [[]];},async(base,estado)=>{
  const body={periodo:'2026-09',empresa:'GAS TOMZA',moneda:'CRC',version:'0',fecha:'2026-09-30',salario:'1000',extras:'100',rebajos:'200'};
  assert.equal((await fetch(base+'/planilla/7/gasto',{method:'POST',body:new URLSearchParams(body),redirect:'manual'})).status,302);assert.equal(estado().commits,1);assert.ok(inserts.some(x=>x.sql.startsWith('INSERT INTO cont_planilla_registros')));assert.ok(inserts.some(x=>x.sql.includes('cont_presupuesto_auditoria')));
  inserts=[];assert.equal((await fetch(base+'/planilla/7/gasto',{method:'POST',body:new URLSearchParams({...body,fecha:'2026-10-01'}),redirect:'manual'})).status,400);assert.equal(inserts.length,0);assert.equal(estado().rollbacks,1);
 });
});
test('no se puede reducir el neto por debajo de lo pagado ni sobrescribir una edición más reciente',async()=>{
 let writes=0;
 await servidor(async sql=>{
  if(sql.startsWith('SELECT * FROM cont_planilla_personas'))return [[persona]];
  if(sql.startsWith('SELECT * FROM cont_planilla_registros'))return [[{id:9,version:2}]];
  if(sql.includes('SUM(monto)'))return [[{pagado:900}]];
  if(sql.startsWith('INSERT')||sql.startsWith('UPDATE'))writes++;
  return [[]];
 },async base=>{
  const body={periodo:'2026-09',empresa:'GAS TOMZA',moneda:'CRC',version:'2',fecha:'2026-09-30',salario:'800',extras:'0',rebajos:'0'};
  assert.equal((await fetch(base+'/planilla/7/gasto',{method:'POST',body:new URLSearchParams(body),redirect:'manual'})).status,400);
  assert.equal((await fetch(base+'/planilla/7/gasto',{method:'POST',body:new URLSearchParams({...body,version:'1'}),redirect:'manual'})).status,409);assert.equal(writes,0);
 });
});
test('pagos parciales no pueden superar el neto pendiente',async()=>{
 let pagos=0;
 await servidor(async sql=>{
  if(sql.startsWith('SELECT * FROM cont_planilla_personas'))return [[persona]];
  if(sql.startsWith('SELECT * FROM cont_planilla_registros'))return [[{id:9,salario:1000,extras:100,rebajos:200}]];
  if(sql.includes('SUM(monto)'))return [[{pagado:400}]];
  if(sql.startsWith('INSERT INTO cont_planilla_pagos'))pagos++;
  return [[]];
 },async base=>{
  const body={periodo:'2026-09',empresa:'GAS TOMZA',moneda:'CRC',fecha:'2026-10-01',referencia:'PAGO-1',monto:'501'};
  assert.equal((await fetch(base+'/planilla/7/pago',{method:'POST',body:new URLSearchParams(body),redirect:'manual'})).status,400);assert.equal(pagos,0);
  assert.equal((await fetch(base+'/planilla/7/pago',{method:'POST',body:new URLSearchParams({...body,monto:'500'}),redirect:'manual'})).status,302);assert.equal(pagos,1);
 });
});
test('gasto de planilla se refleja automáticamente en presupuesto y pagos sin duplicar',async()=>{
 const db={query:async sql=>{
  if(sql.includes('FROM cont_planilla_registros r'))return [[{...persona,id:9,fecha:'2026-09-30',salario:1000,extras:100}]];
  if(sql.includes('FROM cont_planilla_pagos'))return [[{registro_id:9,fecha:'2026-09-30',monto:400}]];
  return [[]];
 }};
 const {docs}=await P.cargarDocumentos(db),r=P.resumen({docs,clasificaciones:[],presupuestos:[],periodo:'2026-09',empresa:'GAS TOMZA',moneda:'CRC'}).filas.find(r=>r.key==='PLANILLA');
 assert.equal(r.facturado,110000);assert.equal(r.pagado,40000);assert.equal(r.compromiso,0);
});
test('editar la referencia actualiza la persona, sin modificar el presupuesto general ni el gasto real',async()=>{
 const writes=[];
 await servidor(async(sql,params)=>{if(sql.startsWith('SELECT * FROM cont_planilla_personas'))return [[persona]];if(sql.startsWith('UPDATE'))writes.push({sql,params});return [[]];},async base=>{
  const body={periodo:'2026-09',empresa:'GAS TOMZA',moneda:'CRC',version:'1',nombre:'Nombre corregido',puesto:'Chofer',presupuesto:'1200'};
  assert.equal((await fetch(base+'/planilla/persona/7/editar',{method:'POST',body:new URLSearchParams(body),redirect:'manual'})).status,302);assert.equal(writes.length,1);assert.match(writes[0].sql,/UPDATE cont_planilla_personas/);assert.equal(writes[0].params[0],'Nombre corregido');
 });
});
test('tocar la hoja Planilla del archivo también abre el control nativo',async()=>{
 await servidor(async sql=>sql.startsWith('SELECT id,periodo,empresa,nombre,datos')?[[{id:1,periodo:'2026-09',empresa:'GAS TOMZA',datos:{hojas:[{nombre:'Planilla',filas:[]}]}}]]:[[]],async base=>{
  const r=await fetch(base+'/archivos/1?hoja=0',{redirect:'manual'});assert.equal(r.status,302);assert.match(r.headers.get('location'),/\/planilla\?/);assert.equal(new URL(r.headers.get('location'),'http://localhost').searchParams.get('periodo'),'2026-09');
 });
});
test('una referencia de pago repetida revierte la transacción',async()=>{
 await servidor(async sql=>{
  if(sql.startsWith('SELECT * FROM cont_planilla_personas'))return [[persona]];
  if(sql.startsWith('SELECT * FROM cont_planilla_registros'))return [[{id:9,salario:1000,extras:0,rebajos:0}]];
  if(sql.includes('SUM(monto)'))return [[{pagado:0}]];
  if(sql.startsWith('INSERT INTO cont_planilla_pagos'))throw Object.assign(new Error('Referencia ya registrada'),{code:'ER_DUP_ENTRY'});
  return [[]];
 },async(base,estado)=>{
  const body={periodo:'2026-09',empresa:'GAS TOMZA',moneda:'CRC',fecha:'2026-09-30',referencia:'REF-1',monto:'100'};
  assert.equal((await fetch(base+'/planilla/7/pago',{method:'POST',body:new URLSearchParams(body),redirect:'manual'})).status,409);assert.equal(estado().commits,0);assert.equal(estado().rollbacks,1);
 });
});


test('el historial de pagos respeta empresa, sede y departamento',async()=>{
 await servidor(async sql=>{
  if(sql.startsWith('SELECT pa.*'))return [[{nombre:'Pago visible',empresa:'GAS TOMZA',sede:'Cartago',departamento:'TALLER',fecha:'2026-09-30',referencia:'VISIBLE-1',monto:100},{nombre:'Otra sede',empresa:'GAS TOMZA',sede:'Liberia',departamento:'TALLER',fecha:'2026-09-30',referencia:'OCULTO-SEDE',monto:100},{nombre:'Otra área',empresa:'GAS TOMZA',sede:'Cartago',departamento:'GENERAL',fecha:'2026-09-30',referencia:'OCULTO-AREA',monto:100}]];
  return [[]];
 },async base=>{const r=await fetch(base+'/planilla?periodo=2026-09&empresa=GAS%20TOMZA&sede=Cartago&departamento=TALLER');assert.equal(r.status,200);const html=await r.text();assert.match(html,/VISIBLE-1/);assert.doesNotMatch(html,/OCULTO-SEDE|OCULTO-AREA/);});
});
