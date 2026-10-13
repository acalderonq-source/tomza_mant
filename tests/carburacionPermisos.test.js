const test=require('node:test');const assert=require('node:assert/strict');const express=require('express');const path=require('node:path');
const {controlarFinanzas}=require('../src/utils/carburacionPermisos');
const user={id:50,rol:'CARBURACION_GESTOR',departamentoActivo:'CARBURACION',departamentos:['CARBURACION']};
test('gestor consulta documentos y administra otras secciones, sin modificar órdenes, facturas ni pagos',async()=>{
 const app=express();app.use((req,res,next)=>{req.session={user};next();});app.use(controlarFinanzas);app.use((_req,res)=>res.sendStatus(200));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  for(const url of ['/ordenes','/ordenes/1/pdf','/facturas','/facturas/1/archivo','/facturas/historial-pagos','/facturas/colillas/1/descargar','/facturas/colillas/1/comprobante'])assert.equal((await fetch(base+url)).status,200,url);
  for(const url of ['/ordenes/nueva','/ordenes/1/editar','/ordenes/1/factura','/facturas/nueva','/facturas/pago'])assert.equal((await fetch(base+url)).status,403,url);
  for(const method of ['POST','PUT','PATCH','DELETE'])for(const url of ['/ordenes','/ordenes/1/editar','/ordenes/1/eliminar','/ordenes/1/factura','/facturas/agregar','/facturas/pagar','/facturas/colillas/1/enviar'])assert.equal((await fetch(base+url,{method})).status,403,method+url);
  for(const url of ['/clientes','/clientes/1/editar','/proveedores','/estaciones/1/editar','/facturas/configuracion-correo'])assert.equal((await fetch(base+url,{method:'POST'})).status,200,url);
 }finally{await new Promise(r=>server.close(r));}
});
test('vistas de consulta no ofrecen crear, editar, eliminar ni pagar',async()=>{
 const ejs=require('ejs');const common={user,puedeModificarFinanzas:false,success:null,carburacionPath:'/carburacion/ordenes',volverUrl:'/carburacion/facturas'};
 const html=await ejs.renderFile(path.join(__dirname,'../src/views/carburacion/ordenes.ejs'),{...common,ordenes:[{id:1,po_numero:'CAR-1',fecha:'2026-10-13',proveedor:'Proveedor',moneda:'CRC',total:100,factura_id:null}]});
 assert.match(html,/Solo consulta/);assert.match(html,/\/1\/pdf/);assert.doesNotMatch(html,/Nueva orden|>Editar<|>Eliminar<|Colocar factura/);
 const header=await ejs.renderFile(path.join(__dirname,'../src/views/carburacion/finanzas_header.ejs'),{...common,titulo:'Gestión de facturas',agregarUrl:'/carburacion/facturas/nueva'});
 assert.doesNotMatch(header,/Agregar factura sin orden/);
});
