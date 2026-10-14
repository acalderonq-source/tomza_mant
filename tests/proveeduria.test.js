const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const path=require('node:path');
const pool=require('../src/db');
const routes=require('../src/routes/proveeduria.routes');
const {lineasCompra,totales,totalesConAjustes,compararFactura,saldo,adjunto,conciliarEstado}=require('../src/utils/proveeduria');
const gestor={id:10,usuario:'compras',rol:'PROVEEDURIA',departamentoActivo:'PROVEEDURIA',departamentos:['PROVEEDURIA'],sede:'Cartago'};
const lines=lineasCompra([{codigo:'P1',descripcion:'Papel',cantidad:3,precio_unitario:10.15,iva:13},{codigo:'P2',descripcion:'Exento',cantidad:2,precio_unitario:5,iva:0}],true);
test('calcula IVA por artículo, redondea centavos y distingue saldo a favor',()=>{
  assert.deepEqual(totales(lines),{subtotal:40.45,impuesto:3.96,total:44.41});
  assert.deepEqual(saldo({factura:{total:44.41},pagos:[{monto:40},{monto:10}]}),{facturado:44.41,pagos:50,saldo:-5.59});
  assert.throws(()=>lineasCompra([{codigo:'x',descripcion:'x',cantidad:-1}]));
  assert.throws(()=>lineasCompra([{codigo:'x',descripcion:'x',cantidad:1},{codigo:'x',descripcion:'x',cantidad:1}]));
  assert.throws(()=>adjunto({nombre:'mal.pdf',base64:Buffer.from('<script>bad</script>').toString('base64')}));
});
test('detecta diferencias aunque el total de factura sea igual',()=>{
  const oc={proveedor:'Proveedor',moneda:'CRC',lineas:lines,...totales(lines)};
  assert.deepEqual(compararFactura(oc,oc),[]);
  const f={...oc,lineas:lines.map(l=>({...l,precio_unitario:1})),moneda:'USD',proveedor:'Otro'};
  assert.ok(compararFactura(oc,f).length>=4);
});
test('estado general concilia depósitos y saldo por OC sin cruzar proveedores ni monedas',()=>{
  const estado={email:'proveedor@example.com',moneda:'CRC',partidas:[{oc_id:1,factura:'F1',depositos:30,saldo:70},{oc_id:2,factura:'F2',depositos:20,saldo:40},{oc_id:3,factura:'F3',depositos:0,saldo:1}]};
  const ordenes=[{id:1,datos:{email:estado.email,moneda:'CRC',factura:{numero:'F1',total:100},pagos:[{monto:30}]}},{id:2,datos:{email:estado.email,moneda:'CRC',factura:{numero:'F2',total:50},pagos:[{monto:10}]}},{id:3,datos:{email:estado.email,moneda:'USD',factura:{numero:'F3',total:1},pagos:[]}}];
  const r=conciliarEstado(estado,ordenes);assert.equal(r[0].error,'');assert.equal(r[1].diferencia,0);assert.equal(r[1].diferenciaDepositos,10);assert.ok(r[1].error);assert.equal(r[2].sistema,undefined);
  ordenes[0].datos.email='otro@example.com';assert.equal(conciliarEstado(estado,ordenes)[0].sistema,undefined);
});
async function servidor(user,run){
  const app=express();app.set('views',path.join(__dirname,'../src/views'));app.set('view engine','ejs');app.use(express.json());app.use(express.urlencoded({extended:true}));app.use((req,res,next)=>{req.session={user};next();});app.use('/proveeduria',routes);
  const listener=app.listen(0,'127.0.0.1');await new Promise(r=>listener.once('listening',r));
  try{await run(`http://127.0.0.1:${listener.address().port}/proveeduria`);}finally{await new Promise(r=>listener.close(r));}
}
test('pantalla separada reutiliza estilos de Taller y no consulta sus tablas',async()=>{
  const original=pool.query;pool.query=async sql=>{assert.match(sql,/prov_/);assert.doesNotMatch(sql,/ordenes_compra|repuestos|bodega_items/);return [[]];};
  try{await servidor(gestor,async base=>{const r=await fetch(base);assert.equal(r.status,200);const html=await r.text();for(const s of ['Solicitudes','Órdenes de compra','Inventario de Proveeduría','Conciliación','topbar','simple-hero','--bg:'])assert.ok(html.includes(s),s);});}finally{pool.query=original;}
});
test('órdenes de Proveeduría usan el formulario real de Taller y el listado conserva filtros propios',async()=>{
  const original=pool.query;pool.query=async sql=>{assert.match(sql,/prov_proveedores|prov_documentos|usuarios_sedes/);return [[]];};
  try{await servidor(gestor,async base=>{
    const r=await fetch(base+'/ordenes/nueva');assert.equal(r.status,200);const html=await r.text();
    for(const text of ['id="ordenForm"','order-lines-table','Descuento monto','Transporte','Observaciones','Plazo de entrega','Departamento de Proveeduría','action="/proveeduria/ordenes"'])assert.ok(html.includes(text),text);
    assert.doesNotMatch(html,/\/compras\/cotizacion\/analizar|\/js\/tipo-mantenimiento.js|data-placa-autocomplete/);
    const lista=await fetch(base+'/ordenes?buscar=Proveedor');assert.equal(lista.status,200);assert.match(await lista.text(),/table-ordenes/);
  });}finally{pool.query=original;}
});
test('OC directa guarda detalle y ajustes en Proveeduría y recalcula el total sin confiar en el formulario',async()=>{
  const original=pool.getConnection,originalQuery=pool.query;let orden,solicitudes=0,commit=false;
  pool.query=async()=>[[]];
  pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{commit=true;},rollback:async()=>{},release(){},query:async(sql,args)=>{
    assert.match(sql,/prov_/);assert.doesNotMatch(sql,/ordenes_compra/);
    if(sql.includes("VALUES ('solicitud'")){assert.equal(args[1],'Cartago');solicitudes++;return [{insertId:101}];}
    if(sql.includes("VALUES ('oc'")){orden=JSON.parse(args[2]);return [{insertId:102}];}
    return [{affectedRows:1}];
  }});
  try{await servidor({...gestor,rol:'ADMIN',sede:'TODAS'},async base=>{
    const body=new URLSearchParams({origen_formulario:'taller',sede:'Cartago',proveedor:'Proveedor',email:'proveedor@example.com, segundo@example.com',proveedor_telefono:'2200-1000',proveedor_direccion:'Dirección del proveedor',empresa_destino:'SUPER GAS',forma_pago:'Contado',credito:'0',entrega:'5 días',moneda:'CRC',iva:'13',descuento:'10',transporte:'5',total:'1','lineas[0][codigo_producto]':'P1','lineas[0][descripcion]':'Suministro','lineas[0][cantidad]':'2','lineas[0][precio_unitario]':'50'});
    const r=await fetch(base+'/ordenes',{method:'POST',body,redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/proveeduria/ordenes');assert.equal(solicitudes,1);assert.ok(commit);assert.equal(orden.total,107.35);assert.equal(orden.impuesto,12.35);assert.equal(orden.empresa_destino,'SUPER GAS');assert.equal(orden.lineas[0].codigo,'P1');
    assert.equal(orden.email,'proveedor@example.com, segundo@example.com');assert.equal(orden.proveedor_telefono,'2200-1000');assert.equal(orden.proveedor_direccion,'Dirección del proveedor');
  });}finally{pool.getConnection=original;pool.query=originalQuery;}
  assert.throws(()=>totalesConAjustes(lines,{descuento:1000}));
  const pequenas=lineasCompra([{codigo:'A',descripcion:'A',cantidad:1,precio_unitario:0.05,iva:13},{codigo:'B',descripcion:'B',cantidad:1,precio_unitario:0.05,iva:13}],true);
  assert.equal(totalesConAjustes(pequenas,{iva:13,iva_global:true}).total,0.11);
});
test('nueva OC abre con sede TODAS y rechaza una sede ajena a los permisos',async()=>{
  const original=pool.query;pool.query=async()=>[[]];
  try{
    await servidor({...gestor,rol:'ADMIN',sede:'TODAS'},async base=>{
      const r=await fetch(base+'/ordenes/nueva');assert.equal(r.status,200);const html=await r.text();assert.match(html,/name="sede"/);assert.match(html,/Seleccione la sede/);assert.match(html,/value="Cartago"/);
    });
    await servidor(gestor,async base=>{
      const r=await fetch(base+'/ordenes',{method:'POST',body:new URLSearchParams({origen_formulario:'taller',empresa_destino:'GAS TOMZA',sede:'NO_AUTORIZADA'})});assert.equal(r.status,403);
    });
  }finally{pool.query=original;}
});
test('recepción usa bloqueo y no repite el ingreso de mercadería',async()=>{
  const original=pool.getConnection,originalQuery=pool.query;let oc={estado:'GENERADA',lineas:lines},ingresos=0,commit=0,rollback=0;
  pool.query=async()=>[[]];
  pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{commit++;},rollback:async()=>{rollback++;},release(){},query:async(sql,args)=>{
    if(sql.startsWith('SELECT')){assert.match(sql,/FOR UPDATE/);return [[{id:1,tipo:'oc',sede:'Cartago',usuario_id:10,datos:structuredClone(oc)}]];}
    if(sql.startsWith('INSERT INTO prov_inventario ('))ingresos++;
    if(sql.startsWith('UPDATE prov_documentos'))oc=JSON.parse(args[0]);
    return [{affectedRows:1}];
  }});
  const post=token=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,version:0,referencia:'Remisión 1',lineas:lines.map(l=>({codigo:l.codigo,cantidad:l.cantidad}))})});
  try{await servidor(gestor,async base=>{
    assert.equal((await fetch(base+'/ordenes/1/recibir',post('a'.repeat(32)))).status,200);assert.equal(ingresos,2);assert.equal(commit,1);
    const repetida=await fetch(base+'/ordenes/1/recibir',post('a'.repeat(32)));assert.equal(repetida.status,200);assert.equal((await repetida.json()).repetida,true);assert.equal(ingresos,2);
    assert.equal((await fetch(base+'/ordenes/1/recibir',post('b'.repeat(32)))).status,400);assert.equal(ingresos,2);assert.equal(rollback,1);
  });}finally{pool.getConnection=original;pool.query=originalQuery;}
});
test('rechaza salida sin existencia y exige confirmación del solicitante',async()=>{
  const original=pool.getConnection;let mutaciones=0;
  pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql,args)=>{
    if(sql.startsWith('SELECT * FROM prov_documentos'))return [[{id:1,usuario_id:99,sede:'Cartago',datos:{estado:'EN_CAMINO',lineas:lines}}]];
    if(sql.startsWith('SELECT * FROM prov_inventario'))return [[{cantidad:0}]];
    mutaciones++;return [{affectedRows:1}];
  }});
  try{await servidor(gestor,async base=>{assert.equal((await fetch(base+'/salidas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({solicitud_id:1})})).status,400);assert.equal((await fetch(base+'/salidas/1/aceptar',{method:'POST'})).status,403);assert.equal(mutaciones,0);});}finally{pool.getConnection=original;}
});
test('Taller sin asignación y proveedor sin token válido no acceden',async()=>{
  await servidor({...gestor,rol:'TALLER',departamentos:['TALLER'],departamentoActivo:'TALLER'},async base=>{
    assert.equal((await fetch(base)).status,403);
    assert.equal((await fetch(base+'/portal/invalido')).status,404);
  });
});
test('facturas con diferencias no pasan a Contabilidad y un gestor no concilia',async()=>{
  const original=pool.getConnection;let estado='PENDIENTE';let diferencias=['Total diferente'];let cambios=0;
  pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql,args)=>{
    if(sql.startsWith('SELECT'))return [[{id:1,usuario_id:99,sede:'Cartago',datos:{factura:{estado,diferencias,electronica:{hacienda:{estado:'ACEPTADA',ambiente:'produccion'}}}}}]];
    if(sql.startsWith('UPDATE')){estado=JSON.parse(args[0]).factura.estado;cambios++;}return [{affectedRows:1}];
  }});
  try{await servidor(gestor,async base=>{
    assert.equal((await fetch(base+'/ordenes/1/factura/aceptar',{method:'POST'})).status,400);assert.equal(cambios,0);
    diferencias=[];assert.equal((await fetch(base+'/ordenes/1/factura/aceptar',{method:'POST'})).status,200);assert.equal(estado,'CONTABILIDAD');
    assert.equal((await fetch(base+'/ordenes/1/factura/conciliar',{method:'POST'})).status,403);assert.equal(cambios,1);
  });}finally{pool.getConnection=original;}
});
test('pantallas con facturas y pagos renderizan sin exponer bytes de adjuntos',async()=>{
  const original=pool.query;
  const o={id:7,tipo:'oc',usuario_id:10,sede:'Cartago',creado_en:new Date(),datos:{proveedor:'Proveedor',razon_social:'Tomza',moneda:'CRC',total:44.41,lineas:lines,pagos:[{referencia:'DEP1',monto:10,fecha:'2026-10-13',archivo:{id:1}}],factura:{numero:'F1',estado:'CONTABILIDAD',total:44.41,diferencias:[]},estado_cuenta:{fecha:'2026-10-13',saldo:34.41}}};
  pool.query=async sql=>[sql.includes('FROM prov_documentos')?[o]:[]];
  try{await servidor({...gestor,rol:'CONTABILIDAD',departamentoActivo:'CONTABILIDAD'},async base=>{const r=await fetch(base+'/ordenes/7');assert.equal(r.status,200);const html=await r.text();assert.match(html,/Conciliar factura/);assert.match(html,/DEP1/);assert.doesNotMatch(html,/base64/);});}finally{pool.query=original;}
});

test('gestión antigua redirige al listado y cada módulo abre su propia pantalla',async()=>{
  const original=pool.query;pool.query=async()=>[[]];
  try{await servidor(gestor,async base=>{
    const antigua=await fetch(base+'/gestion',{redirect:'manual'});assert.equal(antigua.status,302);assert.equal(antigua.headers.get('location'),'/proveeduria/ordenes');
    const inicio=await fetch(base);assert.doesNotMatch(await inicio.text(),/\/proveeduria\/gestion/);
    for(const [ruta,titulo] of [['salidas','Salidas de inventario'],['facturas','Facturas'],['pagos','Pagos y comprobantes'],['conciliacion','Conciliación'],['avisos','Alertas']]){
      const r=await fetch(base+'/'+ruta);assert.equal(r.status,200,ruta);const html=await r.text();assert.match(html,new RegExp('<h1 class="page-title">'+titulo));assert.doesNotMatch(html,/Abrir listado de órdenes|Abrir centro de inventario|Solicitudes de los departamentos/);
    }
  });}finally{pool.query=original;}
});
