const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('path');
const pool=require('../src/db'),P=require('../src/utils/presupuestosContabilidad');
const {extraerConceptos,sincronizarConceptos,saldo,etiquetaRegistro}=require('../src/utils/controlesRubros');
const router=require('../src/routes/presupuestos.routes');
const user={id:1,rol:'ADMIN',usuario:'Admin'};
const concepto={id:7,periodo:'2026-09',empresa:'GAS TOMZA',rubro:'SERVICIOS',moneda:'CRC',sede:'General de la empresa',departamento:'GENERAL',concepto:'Electricidad',presupuesto:1000,version:1};
async function servidor(query,run,usuario=user){
 const old=pool.query,conn=pool.getConnection;pool.query=query;let commits=0,rollbacks=0;
 pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{commits++;},rollback:async()=>{rollbacks++;},release(){}});
 const app=express();app.set('views',path.resolve(__dirname,'../src/views'));app.set('view engine','ejs');app.use(express.urlencoded({extended:true}));app.use((req,_r,n)=>{req.session={user:usuario};n()});app.use('/contabilidad/presupuestos',router);
 const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));
 try{await run('http://127.0.0.1:'+s.address().port+'/contabilidad/presupuestos',()=>({commits,rollbacks}));}finally{await new Promise(r=>s.close(r));pool.query=old;pool.getConnection=conn;}
}
test('extrae detalle sin subtotales y separa combustible y alquileres de mantenimiento',()=>{
 const c=(dir,valor,tipo='texto')=>({direccion:dir,valor,tipo});
 const datos={hojas:[{nombre:'Gastos Generales',filas:[{numero:8,celdas:[c('B8','Gastos generales')]},{numero:10,celdas:[c('I10','COLONES')]},{numero:11,celdas:[c('C11','Papelería'),c('I11',100,'numero')]},{numero:20,celdas:[c('B20','Diesel:')]},{numero:22,celdas:[c('B22','Viaje desde:'),c('G22','LITROS'),c('I22','COLONES')]},{numero:23,celdas:[c('C23','Ruta 1'),c('I23',500,'numero')]},{numero:24,celdas:[c('C24','Total Diesel'),c('I24',500,'numero')]}]},{nombre:'Mantenimientos',filas:[{numero:8,celdas:[c('B8','Tanques')]},{numero:10,celdas:[c('I10','COLONES')]},{numero:11,celdas:[c('C11','Aceite'),c('I11',200,'numero')]},{numero:12,celdas:[c('C12','Alquiler de equipo'),c('I12',300,'numero')]}]}]};
 assert.equal(extraerConceptos(datos,'GASTOS_GENERALES')[0].monto,100);
 assert.equal(extraerConceptos(datos,'COMBUSTIBLE').length,1);assert.equal(extraerConceptos(datos,'COMBUSTIBLE')[0].monto,500);
 assert.equal(extraerConceptos(datos,'MANTENIMIENTO').length,1);assert.equal(extraerConceptos(datos,'SERVICIOS')[0].monto,300);
});
test('respaldo del resumen y sincronización conservan referencias ya existentes sin gastos reales',async()=>{
 const datos={partidas:[{rubro:'IMPUESTOS',concepto:'Impuesto',monto:100,celda:'D77'}]};assert.equal(extraerConceptos(datos,'IMPUESTOS').length,1);let inserts=0;
 const db={query:async sql=>{if(sql.startsWith('SELECT archivo_id'))return [[{archivo_id:2,celda_origen:'D77'}]];if(sql.startsWith('SELECT id,empresa'))return [[{id:2,empresa:'GAS TOMZA',datos}]];if(sql.startsWith('INSERT'))inserts++;return [[]];}};
 await sincronizarConceptos(db,'2026-09','IMPUESTOS');assert.equal(inserts,0);
});
test('cuotas, inversiones y extraordinarios conservan referencias del flujo sin convertir errores en cero',()=>{
 const c=(direccion,valor,tipo='texto')=>({direccion,valor,tipo});
 const datos={hojas:[{nombre:'Principal',filas:[{numero:1,celdas:[c('B1','Pasivos Bancarios:')]},{numero:2,celdas:[c('B2','Compra de unidades'),c('D2',100,'numero')]},{numero:3,celdas:[c('B3','Total Pasivos'),c('D3',100,'numero')]},{numero:4,celdas:[c('B4','Extraordinarios:')]},{numero:5,celdas:[c('B5','Reparación'),c('E5','#REF!','error')]},{numero:6,celdas:[c('B6','Total Extraordinarios')]},{numero:7,celdas:[c('B7','Inversiones:')]},{numero:8,celdas:[c('B8','Equipo'),c('D8',200,'numero')]}]}]};
 assert.equal(extraerConceptos(datos,'PRESTAMOS').length,1);assert.equal(extraerConceptos(datos,'PRESTAMOS')[0].monto,100);
 assert.equal(extraerConceptos(datos,'EXTRAORDINARIOS')[0].monto,null);assert.equal(extraerConceptos(datos,'INVERSIONES')[0].monto,200);assert.equal(extraerConceptos(datos,'PROVISIONES').length,0);
});
test('saldo conserva céntimos y distingue reservas, cuotas e inversiones',()=>{
 assert.deepEqual(saldo('100.50','40.25'),{registrado:10050,pagado:4025,pendiente:6025});assert.throws(()=>saldo(10,11));
 assert.match(etiquetaRegistro('PROVISIONES'),/Reserva/);assert.match(etiquetaRegistro('PRESTAMOS'),/obligación/);assert.match(etiquetaRegistro('INVERSIONES'),/Inversión/);
});
test('los nueve rubros abren su pantalla propia; Planilla mantiene su control especializado',async()=>{
 await servidor(async(sql,params)=>{
  if(sql.startsWith('SELECT c.*,r.id'))return [[{...concepto,rubro:params[1],registro_id:null,pagado:0}]];
  return [[]];
 },async base=>{
  for(const rubro of P.RUBROS.filter(r=>r.key!=='PLANILLA')){const r=await fetch(base+'/rubros/'+rubro.key+'?periodo=2026-09&empresa=GAS+TOMZA');assert.equal(r.status,200,rubro.key);const html=await r.text();assert.ok(html.includes(rubro.nombre));assert.match(html,/Electricidad/);assert.match(html,/Registrar importe real/);assert.match(html,/Sin registrar/);}
  assert.equal((await fetch(base+'/rubros/PLANILLA')).status,404);assert.equal((await fetch(base+'/rubros/INVALIDO')).status,404);
 });
});
test('solo ADMIN abre los controles; Contabilidad y Taller reciben 403 antes de consultar',async()=>{
 for(const rol of ['TALLER','CONTABILIDAD'])await servidor(()=>{throw new Error('No debe consultar');},async base=>{for(const ruta of ['/rubros/SERVICIOS','/modulos/INVERSIONES','/planilla','/archivos/1'])assert.equal((await fetch(base+ruta)).status,403);},{rol});
});
test('registro real valida rubro y mes y guarda su proveedor y comprobante con auditoría',async()=>{
 let inserts=[];
 await servidor(async(sql,params)=>{if(sql.startsWith('SELECT * FROM cont_rubro_conceptos'))return [[concepto]];if(sql.startsWith('INSERT'))inserts.push({sql,params});return [[]];},async(base,estado)=>{
  const body={periodo:'2026-09',empresa:'GAS TOMZA',moneda:'CRC',fecha:'2026-09-20',monto:'1200',proveedor:'Proveedor',documento:'F-1',vencimiento:'2026-10-01',version:'0'};
  assert.equal((await fetch(base+'/rubros/SERVICIOS/7/registrar',{method:'POST',body:new URLSearchParams(body),redirect:'manual'})).status,302);assert.equal(estado().commits,1);
  const r=inserts.find(x=>x.sql.startsWith('INSERT INTO cont_rubro_registros'));assert.equal(r.params[3],'Proveedor');assert.equal(r.params[4],'F-1');assert.ok(inserts.some(x=>x.sql.includes('cont_presupuesto_auditoria')));
  inserts=[];assert.equal((await fetch(base+'/rubros/IMPUESTOS/7/registrar',{method:'POST',body:new URLSearchParams(body),redirect:'manual'})).status,400);assert.equal(inserts.length,0);
  assert.equal((await fetch(base+'/rubros/SERVICIOS/7/registrar',{method:'POST',body:new URLSearchParams({...body,fecha:'2026-10-01'}),redirect:'manual'})).status,400);assert.equal(inserts.length,0);
 });
});
test('ediciones antiguas y reducciones por debajo de lo pagado no escriben',async()=>{
 let writes=0;
 await servidor(async sql=>{
  if(sql.startsWith('SELECT * FROM cont_rubro_conceptos'))return [[concepto]];
  if(sql.startsWith('SELECT * FROM cont_rubro_registros'))return [[{id:9,version:2,monto:1000}]];
  if(sql.includes('SUM(monto)'))return [[{pagado:900}]];
  if(sql.startsWith('INSERT')||sql.startsWith('UPDATE'))writes++;return [[]];
 },async base=>{
  const b={periodo:'2026-09',empresa:'GAS TOMZA',moneda:'CRC',fecha:'2026-09-30',monto:'800',version:'2'};
  assert.equal((await fetch(base+'/rubros/SERVICIOS/7/registrar',{method:'POST',body:new URLSearchParams(b),redirect:'manual'})).status,400);
  assert.equal((await fetch(base+'/rubros/SERVICIOS/7/registrar',{method:'POST',body:new URLSearchParams({...b,version:'1'}),redirect:'manual'})).status,409);assert.equal(writes,0);
 });
});
test('pagos parciales respetan el saldo; referencias repetidas revierten la transacción',async()=>{
 let duplicado=false;
 await servidor(async sql=>{
  if(sql.startsWith('SELECT * FROM cont_rubro_conceptos'))return [[concepto]];
  if(sql.startsWith('SELECT * FROM cont_rubro_registros'))return [[{id:9,monto:1000}]];
  if(sql.includes('SUM(monto)'))return [[{pagado:400}]];
  if(sql.startsWith('INSERT INTO cont_rubro_pagos')&&duplicado)throw Object.assign(new Error('Referencia repetida'),{code:'ER_DUP_ENTRY'});return [[]];
 },async(base,estado)=>{
  const b={periodo:'2026-09',empresa:'GAS TOMZA',moneda:'CRC',fecha:'2026-10-01',referencia:'P-1',monto:'601'};
  assert.equal((await fetch(base+'/rubros/SERVICIOS/7/pago',{method:'POST',body:new URLSearchParams(b),redirect:'manual'})).status,400);assert.equal(estado().commits,0);
  assert.equal((await fetch(base+'/rubros/SERVICIOS/7/pago',{method:'POST',body:new URLSearchParams({...b,monto:'600'}),redirect:'manual'})).status,302);assert.equal(estado().commits,1);
  duplicado=true;assert.equal((await fetch(base+'/rubros/SERVICIOS/7/pago',{method:'POST',body:new URLSearchParams({...b,monto:'500'}),redirect:'manual'})).status,409);assert.equal(estado().commits,1);
 });
});
test('ejecución se integra por empresa, moneda y rubro; pagos de otro mes no duplican ejecución',async()=>{
 const db={query:async sql=>{
  if(sql.includes('FROM cont_rubro_registros r JOIN'))return [[{...concepto,id:9,fecha:'2026-09-20',monto:1000}]];
  if(sql.includes('FROM cont_rubro_pagos'))return [[{registro_id:9,fecha:'2026-10-01',monto:400}]];
  return [[]];
 }};
 const {docs}=await P.cargarDocumentos(db);
 const sum=(periodo,empresa='GAS TOMZA',moneda='CRC')=>P.resumen({docs,clasificaciones:[],presupuestos:[],periodo,empresa,moneda}).filas.find(r=>r.key==='SERVICIOS');
 assert.equal(sum('2026-09').facturado,100000);assert.equal(sum('2026-09').pagado,0);assert.equal(sum('2026-10').facturado,0);assert.equal(sum('2026-10').pagado,40000);assert.equal(sum('2026-09','SUPER GAS').facturado,0);assert.equal(sum('2026-09','GAS TOMZA','USD').facturado,0);
});
