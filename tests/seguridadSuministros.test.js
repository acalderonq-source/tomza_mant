const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const path=require('node:path');
const pool=require('../src/db');
const {controlarAccesoPorDepartamento,puedeAbrirRutaPorDepartamento}=require('../src/utils/departamentos');
const {puedeAcceder}=require('../src/utils/accesosTrabajador');

test('el permiso Seguridad permite pedidos propios y conserva restricciones de lectura y gestión',()=>{
  for(const [ruta,metodo] of [['/proveeduria/mis-solicitudes','GET'],['/proveeduria/alertas','GET'],['/proveeduria/solicitudes','POST'],['/proveeduria/salidas/9/aceptar','POST']]){
    assert.equal(puedeAbrirRutaPorDepartamento('SEGURIDAD_OCUPACIONAL',ruta,'SEGURIDAD_OCUP',metodo),true);
    assert.equal(puedeAcceder({departamento:'SEGURIDAD_OCUPACIONAL',permisos:{SEGURIDAD:'GESTION'}},ruta,metodo),true);
    assert.equal(puedeAcceder({departamento:'SEGURIDAD_OCUPACIONAL',permisos:{SEGURIDAD:'LECTURA'}},ruta,metodo),metodo==='GET');
    assert.equal(puedeAcceder({departamento:'SEGURIDAD_OCUPACIONAL',permisos:{}},ruta,metodo),false);
  }
  for(const ruta of ['/proveeduria/solicitudes','/proveeduria/inventario','/proveeduria/ordenes','/compras','/administracion'])assert.equal(puedeAbrirRutaPorDepartamento('SEGURIDAD_OCUPACIONAL',ruta,'SEGURIDAD_OCUP'),false);
});

test('entrada real de Seguridad muestra el módulo y permite enviar una solicitud a Proveeduría',async()=>{
 const original=pool.query,originalConnection=pool.getConnection;let guardada;
 const user={id:91,usuario:'seguridad',nombre:'Seguridad',rol:'SEGURIDAD_OCUP',sede:'Cartago',departamentoActivo:'SEGURIDAD_OCUPACIONAL',departamentos:['SEGURIDAD_OCUPACIONAL']};
 const query=async(sql,args)=>{
   if(sql.includes('FROM prov_inventario'))return [[{sede:'Cartago',codigo:'EPP',descripcion:'Guantes',iva:13,unidad:'UND'}]];
   if(sql.startsWith('INSERT INTO prov_documentos')){guardada=JSON.parse(args[2]);return [{insertId:101}];}
   return [[]];
 };
 pool.query=query;pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}});
 const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));app.use(express.json());app.use((req,res,next)=>{req.session={user};next();});app.use(controlarAccesoPorDepartamento);
 app.use('/seguridad-ocupacional',require('../src/routes/seguridadOcupacional.routes'));
 app.use('/proveeduria',require('../src/routes/proveeduria.routes'));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const inicio=await fetch(base+'/seguridad-ocupacional');assert.equal(inicio.status,200);const html=await inicio.text();assert.match(html,/module-grid/);assert.match(html,/Solicitud de suministros/);assert.doesNotMatch(html,/Todavía no hay procesos/);
  const form=await fetch(base+'/proveeduria/mis-solicitudes');assert.equal(form.status,200);assert.match(await form.text(),/Solicitud de suministros/);
  const enviado=await fetch(base+'/proveeduria/solicitudes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sede:'Cartago',lineas:[{codigo:'EPP',cantidad:2}],motivo:'Protección'})});assert.equal(enviado.status,200);assert.equal(guardada.departamento,'SEGURIDAD_OCUPACIONAL');assert.equal(guardada.lineas[0].descripcion,'Guantes');
  assert.equal((await fetch(base+'/proveeduria/inventario')).status,403);
 }finally{pool.query=original;pool.getConnection=originalConnection;await new Promise(r=>server.close(r));}
});
