const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const path=require('node:path');
const pool=require('../src/db');
const router=require('../src/routes/proveeduria.routes');
const {hash}=require('../src/utils/proveeduria');
const token='a'.repeat(64);
const consecutive='00100001010000000001';
const clave='506141026003101123456'+consecutive+'112345678';
const lines=[{codigo:'P1',descripcion:'Papel',cantidad:1,precio_unitario:100,iva:13,subtotal:100,impuesto:13}];
const invoiceXML=`<FacturaElectronica><Clave>${clave}</Clave><NumeroConsecutivo>${consecutive}</NumeroConsecutivo><FechaEmision>2026-10-14T10:00:00-06:00</FechaEmision><Emisor><Nombre>Proveedor</Nombre><Identificacion><Numero>3101123456</Numero></Identificacion></Emisor><Receptor><Nombre>Tomza</Nombre><Identificacion><Numero>3101654321</Numero></Identificacion></Receptor><ResumenFactura><TotalComprobante>113</TotalComprobante></ResumenFactura></FacturaElectronica>`;
const user={id:1,usuario:'contador',rol:'CONTABILIDAD',departamentoActivo:'CONTABILIDAD'};
const row=()=>({id:7,tipo:'oc',sede:'Cartago',datos:{portal_hash:hash(token),portal_vence:Date.now()+60000,proveedor:'Proveedor',razon_social:'Tomza',lineas:lines,total:113,moneda:'CRC',credito:30,pagos:[]}});
async function server(u,run){
  const app=express();app.set('views',path.join(__dirname,'../src/views'));app.set('view engine','ejs');app.use(express.json());app.use((req,res,next)=>{req.session={user:u};next();});app.use('/proveeduria',router);
  const listener=app.listen(0,'127.0.0.1');await new Promise(r=>listener.once('listening',r));
  try{await run(`http://127.0.0.1:${listener.address().port}/proveeduria`);}finally{await new Promise(r=>listener.close(r));}
}
test('proveedor carga XML por enlace privado; se reserva clave y calcula vencimiento',async()=>{
  const original=pool.query,connection=pool.getConnection;let saved,commits=0;
  pool.query=async()=>[[row()]];
  pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{commits++;},rollback:async()=>{},release(){},query:async(sql,args)=>{
    if(sql.includes('FROM prov_documentos'))return [[row()]];
    if(sql.includes('SELECT documento_id'))return [[]];
    if(sql.startsWith('UPDATE prov_documentos'))saved=JSON.parse(args[0]);
    return [{insertId:9,affectedRows:1}];
  }});
  try{await server(null,async base=>{
    const body={numero:consecutive,proveedor:'Proveedor',moneda:'CRC',total:113,lineas:lines,archivo:{nombre:'factura.pdf',base64:Buffer.from('%PDF-1.7 ejemplo').toString('base64')},xml:{nombre:'factura.xml',base64:Buffer.from(invoiceXML).toString('base64')}};
    const r=await fetch(base+'/portal/'+token+'/factura',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(r.status,200,await r.text());assert.equal(commits,1);assert.equal(saved.factura.fecha_vencimiento,'2026-11-13');assert.equal(saved.factura.electronica.clave,clave);assert.equal(saved.factura.electronica.archivo.mime,'application/xml');assert.equal(saved.factura.cuenta_por_pagar,undefined);
  });}finally{pool.query=original;pool.getConnection=connection;}
});
test('solo contabilidad consulta cuentas y pagos no exceden el saldo ni aprueban sin Hacienda',async()=>{
  const original=pool.query,connection=pool.getConnection;let writes=0;
  const r=row();r.datos.factura={numero:consecutive,total:113,estado:'CONCILIADA',cuenta_por_pagar:true,fecha_vencimiento:'2026-11-13',electronica:{hacienda:{estado:'ACEPTADA',ambiente:'produccion'}}};
  pool.query=async()=>[[r]];
  pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql)=>{
    if(sql.includes('FROM prov_documentos'))return [[structuredClone(r)]];
    if(sql.startsWith('UPDATE'))writes++;
    return [{insertId:9}];
  }});
  try{
    await server(user,async base=>{
      const page=await fetch(base+'/cuentas-por-pagar');assert.equal(page.status,200);assert.match(await page.text(),/Por pagar/);
      const payment={referencia:'P1',monto:114,fecha:'2026-10-14',archivo:{nombre:'pago.pdf',base64:Buffer.from('%PDF-1.7').toString('base64')}};
      assert.equal((await fetch(base+'/ordenes/7/pagos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payment)})).status,400);assert.equal(writes,0);
      r.datos.factura.estado='CONTABILIDAD';r.datos.factura.electronica.hacienda.estado='PENDIENTE';
      assert.equal((await fetch(base+'/ordenes/7/factura/conciliar',{method:'POST'})).status,400);assert.equal(writes,0);
    });
    await server({...user,rol:'PROVEEDURIA',departamentoActivo:'PROVEEDURIA'},async base=>assert.equal((await fetch(base+'/cuentas-por-pagar')).status,403));
  }finally{pool.query=original;pool.getConnection=connection;}
});
