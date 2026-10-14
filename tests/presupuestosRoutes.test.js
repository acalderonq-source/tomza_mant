const test=require('node:test');const assert=require('node:assert/strict');
const express=require('express');const path=require('path');const pool=require('../src/db');
const router=require('../src/routes/presupuestos.routes');
const {leerPresupuestoExcel}=require('../src/utils/presupuestoImportacion');
const ExcelJS=require('exceljs');
async function servidor(user,query,run,extra={}){
  const originalQuery=pool.query,originalConnection=pool.getConnection;pool.query=query;
  let commits=0,rollbacks=0;
  pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{commits++;},rollback:async()=>{rollbacks++;},release(){}});
  const session={user,...extra};const app=express();app.set('views',path.resolve(__dirname,'../src/views'));app.set('view engine','ejs');app.use(express.urlencoded({extended:true,limit:'10mb'}));app.use((req,_res,next)=>{req.session=session;next();});app.use('/contabilidad/presupuestos',router);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{await run('http://127.0.0.1:'+server.address().port+'/contabilidad/presupuestos',session,()=>({commits,rollbacks}));}finally{await new Promise(r=>server.close(r));pool.query=originalQuery;pool.getConnection=originalConnection;}
}
const user={id:10,rol:'CONTABILIDAD',usuario:'Conta',departamentoActivo:'CONTABILIDAD'};
test('acceso requiere sesión y rol de Contabilidad, antes de consultar datos',async()=>{
  for(const [u,status] of [[null,302],[{rol:'TALLER'},403],[{rol:'CARBURACION_GESTOR'},403]])await servidor(u,()=>{throw new Error('No debe consultar');},async base=>assert.equal((await fetch(base,{redirect:'manual'})).status,status));
});
test('Contabilidad abre la pantalla, exporta y valida filtros sin cambiar de área',async()=>{
  await servidor(user,async()=>[[]],async base=>{
    const r=await fetch(base+'?periodo=2026-10');assert.equal(r.status,200);const html=await r.text();assert.match(html,/Presupuesto y ejecución mensual/);assert.match(html,/Registrar o ajustar presupuesto/);assert.match(html,/Importar presupuesto de Excel/);assert.doesNotMatch(html,/Cambie el area activa/);
    assert.equal((await fetch(base+'?periodo=2026-99')).status,400);assert.equal((await fetch(base+'?moneda=EUR')).status,400);
    const csv=await fetch(base+'/reporte.csv?periodo=2026-10');assert.equal(csv.status,200);assert.match(csv.headers.get('content-type'),/text\/csv/);assert.match(await csv.text(),/Disponible/);
  });
});
test('guarda y audita dentro de una transacción; rechaza montos inválidos y versiones antiguas',async()=>{
  let cambios=[];
  const b={periodo:'2026-10',empresa:'GAS TOMZA',sede:'Cartago',departamento:'TALLER',moneda:'CRC',rubro:'MANTENIMIENTO',monto:'100.50',version:'0'};
  await servidor(user,async(sql,params)=>{cambios.push({sql,params});return [[]];},async(base,_s,estado)=>{
    const r=await fetch(base+'/guardar',{method:'POST',body:new URLSearchParams(b),redirect:'manual'});assert.equal(r.status,302);assert.equal(estado().commits,1);assert.ok(cambios.some(c=>c.sql.startsWith('INSERT INTO cont_presupuestos ')));assert.ok(cambios.some(c=>c.sql.startsWith('INSERT INTO cont_presupuesto_auditoria')));
    cambios=[];assert.equal((await fetch(base+'/guardar',{method:'POST',body:new URLSearchParams({...b,monto:'-1'}),redirect:'manual'})).status,400);assert.equal(cambios.length,0);
  });
  cambios=[];
  await servidor(user,async(sql,params)=>{cambios.push(sql);return sql.startsWith('SELECT * FROM cont_presupuestos')?[[{id:1,version:2}]]:[[]];},async(base,_s,estado)=>{
    assert.equal((await fetch(base+'/guardar',{method:'POST',body:new URLSearchParams({...b,version:'1'}),redirect:'manual'})).status,409);assert.equal(estado().rollbacks,1);assert.ok(!cambios.some(s=>s.startsWith('UPDATE cont_presupuestos')));
  });
});
test('clasificar valida el documento de origen y su moneda',async()=>{
  const b={periodo:'2026-10',empresa:'GAS TOMZA',sede:'Cartago',departamento:'TALLER',moneda:'CRC',rubro:'MANTENIMIENTO',fuente:'TALLER_ORDEN',documento_id:'1'};
  let escrituras=0;
  await servidor(user,async sql=>{
    if(sql.includes('FROM ordenes_compra'))return [[{id:1,po_numero:'PO-1',fecha:'2026-10-01',total:100,moneda:'USD'}]];
    if(sql.startsWith('INSERT'))escrituras++;
    return [[]];
  },async base=>{
    assert.equal((await fetch(base+'/clasificar',{method:'POST',body:new URLSearchParams(b)})).status,400);
    assert.equal((await fetch(base+'/clasificar',{method:'POST',body:new URLSearchParams({...b,documento_id:'999'})})).status,400);
    assert.equal(escrituras,0);
  });
});
async function excel({error=false,sinResultado=false,subtotal=30}={}){
  const w=new ExcelJS.Workbook();const s=w.addWorksheet('Ordinarios Prueba');s.getCell('B13').value='Planilla';s.getCell('B14').value='Tiendas';s.getCell('D14').value=10;s.getCell('B15').value='Horas Extras';s.getCell('D15').value=20;s.getCell('B16').value='Otro';s.getCell('D16').value=error?{formula:'1/0',result:{error:'#DIV/0!'}}:sinResultado?{formula:'1+2'}:{formula:'0+0',result:0};s.getCell('B20').value='Total Planilla';s.getCell('D20').value=subtotal;s.getCell('B80').value='GRAN TOTAL PRESUPUESTO - Colones';s.getCell('D80').value=subtotal;return Buffer.from(await w.xlsx.writeBuffer());
}
test('importador preserva ceros de fórmulas y evita sumar subtotales',async()=>{
  const r=await leerPresupuestoExcel(await excel());assert.equal(r.totalImportado,30);assert.equal(r.filas.length,3);assert.deepEqual(r.errores,[]);assert.equal(r.filas.find(f=>f.celda==='D16').monto,0);
});
test('importador detecta fórmulas rotas, resultados ausentes y descuadres',async()=>{
  assert.ok((await leerPresupuestoExcel(await excel({error:true}))).errores.some(e=>e.includes('#DIV/0!')));
  assert.ok((await leerPresupuestoExcel(await excel({sinResultado:true}))).errores.some(e=>e.includes('sin resultado')));
  assert.ok((await leerPresupuestoExcel(await excel({subtotal:50}))).errores.some(e=>e.includes('no coinciden')));
});
test('vista previa no escribe presupuestos; confirmar importa y consume el token',async()=>{
  const archivo=(await excel()).toString('base64');let escrituras=0;
  await servidor(user,async sql=>{if(sql.startsWith('INSERT INTO cont_presupuestos '))escrituras++;return [[]];},async(base,s,estado)=>{
    const body=new URLSearchParams({periodo:'2026-10',empresa:'GAS TOMZA',sede:'Cartago',departamento:'TALLER',moneda:'CRC',archivo});
    assert.equal((await fetch(base+'/importar/preview',{method:'POST',body,redirect:'manual'})).status,302);assert.equal(escrituras,0);assert.equal(s.presupuestoImportacion.filas.length,3);
    const token=s.presupuestoImportacion.token;
    assert.equal((await fetch(base+'/importar/confirmar',{method:'POST',body:new URLSearchParams({token:'incorrecto'}),redirect:'manual'})).status,400);assert.equal(escrituras,0);
    assert.equal((await fetch(base+'/importar/confirmar',{method:'POST',body:new URLSearchParams({token}),redirect:'manual'})).status,302);assert.equal(escrituras,1);assert.equal(estado().commits,1);assert.equal(s.presupuestoImportacion,undefined);
  });
});
test('una importación con errores queda bloqueada sin escribir',async()=>{
  await servidor(user,async()=>{throw new Error('No debe consultar');},async base=>{
    const r=await fetch(base+'/importar/confirmar',{method:'POST',body:new URLSearchParams({token:'uno'}),redirect:'manual'});assert.equal(r.status,400);
  },{presupuestoImportacion:{token:'uno',errores:['#REF!']}});
});
test('guardar exige empresa y la incluye en la clave, auditoría y redirección',async()=>{
  const body={periodo:'2026-10',empresa:'SUPER GAS',sede:'Cartago',departamento:'TALLER',moneda:'CRC',rubro:'MANTENIMIENTO',monto:'10',version:'0'};
  let inserts=[];
  await servidor(user,async(sql,params)=>{if(sql.startsWith('INSERT INTO cont_presupuestos '))inserts.push(params);return [[]];},async base=>{
    const r=await fetch(base+'/guardar',{method:'POST',body:new URLSearchParams(body),redirect:'manual'});assert.equal(r.status,302);assert.equal(new URL(r.headers.get('location'),'http://localhost').searchParams.get('empresa'),'SUPER GAS');assert.equal(inserts[0][1],'SUPER GAS');
    assert.equal((await fetch(base+'/guardar',{method:'POST',body:new URLSearchParams({...body,empresa:''}),redirect:'manual'})).status,400);assert.equal(inserts.length,1);
  });
});
test('la clasificación no permite cambiar la empresa confirmada en la orden',async()=>{
  let escrituras=0;
  await servidor(user,async sql=>{if(sql.includes('FROM ordenes_compra'))return [[{id:1,empresa_destino:'SUPER GAS',moneda:'CRC',fecha:'2026-10-01',total:100}]];if(sql.startsWith('INSERT'))escrituras++;return [[]];},async base=>{
    const body={periodo:'2026-10',empresa:'GAS TOMZA',sede:'Cartago',departamento:'TALLER',moneda:'CRC',rubro:'MANTENIMIENTO',fuente:'TALLER_ORDEN',documento_id:'1'};
    assert.equal((await fetch(base+'/clasificar',{method:'POST',body:new URLSearchParams(body),redirect:'manual'})).status,400);assert.equal(escrituras,0);
  });
});
test('una partida antigua puede asignarse a una empresa conservando su identidad e historial',async()=>{
  const antes={id:9,periodo:'2026-10',empresa:'',sede:'Cartago',departamento:'TALLER',moneda:'CRC',rubro:'MANTENIMIENTO',version:1,monto:100};let update;
  await servidor(user,async(sql,params)=>{if(sql.includes('FROM cont_presupuestos WHERE id='))return [[antes]];if(sql.startsWith('UPDATE cont_presupuestos'))update=params;return [[]];},async base=>{
    const body={...antes,empresa:'SUPER GAS',observacion:'Empresa confirmada'};
    assert.equal((await fetch(base+'/guardar',{method:'POST',body:new URLSearchParams(body),redirect:'manual'})).status,302);assert.equal(update[0],'SUPER GAS');assert.equal(update.at(-1),9);
  });
});
test('importación verifica la empresa identificada en el encabezado del Excel',async()=>{
  const buffer=await excel(),w=new ExcelJS.Workbook();await w.xlsx.load(buffer);w.worksheets[0].getCell('A1').value='ENVASADORA SUPER GAS GLP S.A.';
  const archivo=Buffer.from(await w.xlsx.writeBuffer());assert.equal((await leerPresupuestoExcel(archivo)).empresaArchivo,'SUPER GAS');
  await servidor(user,async()=>[[]],async(base,s)=>{
    const body={periodo:'2026-10',empresa:'GAS TOMZA',sede:'Cartago',departamento:'TALLER',moneda:'CRC',archivo:archivo.toString('base64')};
    assert.equal((await fetch(base+'/importar/preview',{method:'POST',body:new URLSearchParams(body),redirect:'manual'})).status,400);assert.equal(s.presupuestoImportacion,undefined);
    assert.equal((await fetch(base+'/importar/preview',{method:'POST',body:new URLSearchParams({...body,empresa:'SUPER GAS'}),redirect:'manual'})).status,302);assert.equal(s.presupuestoImportacion.empresa,'SUPER GAS');
  });
});


test('entrar por módulo conserva el mes y la empresa elegidos',async()=>{
 await servidor(user,async()=>[[]],async base=>{const r=await fetch(base+'/modulos/SERVICIOS?periodo=2026-09&empresa=SUPER%20GAS&moneda=USD&sede=Cartago',{redirect:'manual'});assert.equal(r.status,302);const dest=new URL(r.headers.get('location'),'http://localhost');assert.equal(dest.searchParams.get('periodo'),'2026-09');assert.equal(dest.searchParams.get('empresa'),'SUPER GAS');assert.equal(dest.searchParams.get('moneda'),'USD');assert.equal(dest.searchParams.get('sede'),'Cartago');assert.equal((await fetch(base+'/modulos/SERVICIOS?periodo=2026-99',{redirect:'manual'})).status,400);});
});
test('lista de pendientes muestra el motivo sin cambiar el presupuesto total',async()=>{
 await servidor(user,async sql=>{
  if(sql.includes('FROM ordenes_compra o'))return [[{id:1,po_numero:'PENDIENTE-1',fecha:'2026-09-01',empresa_destino:'GAS TOMZA',moneda:'CRC',total:100}]];
  if(sql.startsWith('SELECT * FROM cont_presupuestos'))return [[{periodo:'2026-09',empresa:'GAS TOMZA',moneda:'CRC',sede:'General',departamento:'GENERAL',rubro:'SERVICIOS',monto:1000}]];
  return [[]];
 },async base=>{
  const pending=await fetch(base+'?periodo=2026-09&estado_documento=pendientes');assert.equal(pending.status,200);const html=await pending.text();assert.match(html,/PENDIENTE-1/);assert.match(html,/Documento sin clasificar/);
  const included=await (await fetch(base+'?periodo=2026-09&estado_documento=incluidos')).text();assert.doesNotMatch(included,/PENDIENTE-1/);assert.match(included,/No hay documentos para estos filtros/);
  const csv=await (await fetch(base+'/reporte.csv?periodo=2026-09')).text();assert.match(csv,/Motivo de exclusión/);assert.match(csv,/Documento sin clasificar/);
 });
});
