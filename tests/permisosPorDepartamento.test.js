const test=require('node:test'),assert=require('node:assert/strict'),ejs=require('ejs'),path=require('node:path');
const {puedeAcceder,controlarAccesosPersonales}=require('../src/utils/accesosTrabajador');
const {configDepartamento}=require('../src/utils/permisosPorDepartamento');
const raiz={departamento:'PROVEEDURIA',sede:'TODAS',permisos:{PROVEEDURIA:'GESTION'},conservarPerfil:true,adicionales:{TALLER:{perfil:'TALLER_COMPRAS_LECTURA',permisos:{ORDENES:'LECTURA',FACTURAS:'LECTURA',DOCUMENTOS:'LECTURA'}},CARBURACION:{perfil:'CARBURACION_SIN_FINANZAS',permisos:{CARBURACION:'GESTION'}}}};
test('consulta de Taller permite solo documentos y rechaza escrituras, formularios y otros modulos',()=>{
 const config=configDepartamento(raiz,'TALLER');
 for(const ruta of ['/compras/ordenes','/compras/ordenes/12/pdf','/compras/ordenes/12/detalle','/compras/facturas','/compras/facturas/reporte/excel','/uploads/facturas/adjunto.pdf'])assert.equal(puedeAcceder(config,ruta,'GET'),true,ruta);
 for(const ruta of ['/compras/ordenes/nueva','/compras/ordenes/12/editar','/compras/facturas/asientos','/compras/facturas/correo','/mantenimientos','/bodega','/carburacion/clientes','/uploads/facturas/../archivo.pdf'])assert.equal(puedeAcceder(config,ruta,'GET'),false,ruta);
 for(const method of ['POST','PATCH','PUT','DELETE'])for(const ruta of ['/compras/ordenes','/compras/facturas/12/pagar','/compras/facturas/12/editar'])assert.equal(puedeAcceder(config,ruta,method),false);
});
test('Carburacion operativa bloquea ordenes, facturas, pagos y exportaciones por cualquier metodo',()=>{
 const config=configDepartamento(raiz,'CARBURACION');
 for(const method of ['GET','HEAD','POST','PUT','PATCH','DELETE']){
  for(const ruta of ['/carburacion/ordenes','/carburacion/ordenes/12/pdf','/carburacion/facturas','/carburacion/facturas/historial-pagos','/carburacion/facturas/configuracion-correo','/carburacion/facturas/colillas/1/descargar','/compras/facturas'])assert.equal(puedeAcceder(config,ruta,method),false,ruta);
  for(const ruta of ['/carburacion/clientes','/carburacion/clientes/12/editar','/carburacion/estaciones','/carburacion/proveedores'])assert.equal(puedeAcceder(config,ruta,method),true,ruta);
 }
 assert.equal(puedeAcceder(config,'/proveeduria/mis-solicitudes','GET'),true);
});
test('los permisos frescos siguen el departamento activo sin cambiar el rol ni ampliar el acceso previo',async()=>{
 const db={query:async()=>[[{config_json:JSON.stringify(raiz)}]]};
 for(const [area,ruta,perfil] of [['PROVEEDURIA','/proveeduria',undefined],['TALLER','/compras/facturas','TALLER_COMPRAS_LECTURA'],['CARBURACION','/carburacion/clientes','CARBURACION_SIN_FINANZAS']]){
  const user={id:61,usuario:'prueba',rol:'PROVEEDURIA',departamentoActivo:area};let allowed=false;
  await controlarAccesosPersonales(db)({session:{user},path:ruta,method:'GET'},{status(){throw Error('Denegado');}},()=>{allowed=true;});
  assert.equal(allowed,true);assert.equal(user.rol,'PROVEEDURIA');assert.equal(user.accesoPersonal?.perfil,perfil);assert.deepEqual(user.departamentos,['PROVEEDURIA','TALLER','CARBURACION']);
 }
});
test('Carburacion no expone enlaces, montos ni ordenes recientes en dashboard o navegacion',async()=>{
 const user={nombre:'Persona',rol:'PROVEEDURIA',departamentoActivo:'CARBURACION',accesoPersonal:configDepartamento(raiz,'CARBURACION')};
 const html=await ejs.renderFile(path.join(__dirname,'../src/views/carburacion/dashboard.ejs'),{user,hoy:'2026-10-20',resumen:{total:999},cantidadProveedores:1,montos:[{moneda:'CRC',total:99999}],recientes:[]});
 assert.ok(html.includes('/carburacion/clientes'));assert.ok(html.includes('/carburacion/estaciones'));assert.ok(html.includes('/carburacion/proveedores'));
 assert.doesNotMatch(html,/href="\/carburacion\/(ordenes|facturas)|Monto ordenado|Órdenes recientes|99999/);
 const header=await ejs.renderFile(path.join(__dirname,'../src/views/carburacion/header.ejs'),{user,carburacionPath:'/carburacion/clientes'});
 assert.doesNotMatch(header,/href="\/carburacion\/(ordenes|facturas)/);
});
test('las rutas de compras y adjuntos aceptan consulta granular sin convertirla en gestion',()=>{
 const compras=require('../src/routes/compras.routes'),uploads=require('../src/routes/uploads.routes');
 const user={rol:'PROVEEDURIA',departamentoActivo:'TALLER',accesoPersonal:configDepartamento(raiz,'TALLER')};
 for(const ruta of ['/ordenes','/facturas','/ordenes/:id/pdf']){
  const layer=compras.stack.find(l=>l.route?.path===ruta&&l.route.methods.get);assert.ok(layer);let allowed=false;
  layer.route.stack[1].handle({session:{user},method:'GET',originalUrl:'/compras'+ruta.replace(':id','12')},{status(){throw Error('No debe denegar');}},()=>{allowed=true;});assert.equal(allowed,true);
 }
 assert.equal(uploads.canViewUploads(user,'/facturas/archivo.pdf'),true);
});
