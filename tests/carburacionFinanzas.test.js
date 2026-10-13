const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const path=require('node:path');
const pool=require('../src/db');
const rutas=require('../src/routes/carburacion.routes');
const f=require('../src/utils/carburacionFinanzas');
const {construirCorreoPago}=require('../src/utils/pagoProveedorCorreo');
const user={id:34,nombre:'Emily',departamentoActivo:'CARBURACION',departamentos:['CARBURACION'],rol:'PROVEEDURIA_TALLER'};
async function withServer(run,usuario=user) {
  const app=express();app.set('views',path.join(__dirname,'../src/views'));app.set('view engine','ejs');
  app.use(express.urlencoded({extended:true}));
  app.use((req,res,next)=>{req.session={user:usuario};next();});app.use('/carburacion',rutas);
  const listener=app.listen(0,'127.0.0.1');await new Promise(resolve=>listener.once('listening',resolve));
  try {await run(`http://127.0.0.1:${listener.address().port}`);} finally {await new Promise(resolve=>listener.close(resolve));}
}
test('valida fechas reales, decimales monetarios, selección y adjuntos',()=>{
  assert.equal(f.fechaValida('2026-02-30'),false);assert.equal(f.fechaValida('2026-10-13'),true);
  assert.equal(f.centavos('10.01'),1001);assert.equal(f.centavos('0.10'),10);
  for(const monto of ['NaN','-1','1.001','1e4','Infinity','999999999999999999'])assert.throws(()=>f.centavos(monto));
  assert.deepEqual(f.idsFacturas(['2','1']),[1,2]);
  assert.throws(()=>f.idsFacturas(['1','1']));assert.throws(()=>f.idsFacturas(['1 OR 1=1']));
  assert.throws(()=>f.adjunto('data:application/pdf;base64,'+Buffer.from('<script>').toString('base64'),'x.pdf'));
  const archivo=f.adjunto('data:application/pdf;base64,'+Buffer.from('%PDF-1.4\n').toString('base64'),'../../factura.pdf');
  assert.equal(archivo.tipo,'application/pdf');assert.ok(!archivo.nombre.includes('/'));
});
test('correos de USD no usan el símbolo de colones y conservan el detalle del pago',()=>{
  const correo=construirCorreoPago({proveedor:'Tecno',facturas:[{factura:'F-1',monto_pago:12}],reciboNumero:'CAR-RP-000001',fechaPago:'2026-10-13',totalPagado:12,moneda:'USD'});
  assert.match(correo.html,/USD /);assert.doesNotMatch(correo.html,/₡/);
});
test('facturas, historial, configuración y descargas rechazan una sesión de Taller',async()=>{
  await withServer(async base=>{
    for(const ruta of ['facturas','facturas/pagos-proveedor','facturas/historial-pagos','facturas/configuracion-correo','facturas/1/archivo','facturas/colillas/1/descargar','facturas/colillas/1/comprobante','ordenes/1/factura']) {
      assert.equal((await fetch(`${base}/carburacion/${ruta}`)).status,403);
    }
    for(const ruta of ['facturas/pagar','facturas/configuracion-correo','facturas/colillas/1/enviar','ordenes/1/factura'])assert.equal((await fetch(`${base}/carburacion/${ruta}`,{method:'POST'})).status,403);
  },{...user,departamentoActivo:'TALLER'});
});
test('las pantallas financieras consultan exclusivamente Carburación y renderizan vacíos',async()=>{
  const original=pool.query;
  pool.query=async sql=>{assert.match(sql,/carburacion_/);assert.doesNotMatch(sql,/\b(?:ordenes_compra|colillas_pago_proveedor|configuracion_correo_pagos)\b/);return [[]];};
  try {await withServer(async base=>{
    for(const ruta of ['facturas','facturas/nueva','facturas/historial-pagos','facturas/configuracion-correo']){
      const res=await fetch(`${base}/carburacion/${ruta}`);assert.equal(res.status,200);
      const html=await res.text();assert.match(html,/Carburación/);assert.doesNotMatch(html,/href="\/compras|action="\/compras|PROVEEDURIA_TALLER/);
    }
  });}finally{pool.query=original;}
});
test('el pago no acepta facturas de distinto proveedor o moneda',async()=>{
  const original=pool.query;
  pool.query=async()=>[[{id:1,proveedor_id:1,moneda:'CRC',total:'100.00',pagado:'0.00'},{id:2,proveedor_id:1,moneda:'USD',total:'100.00',pagado:'0.00'}]];
  try {await assert.rejects(f.seleccionFacturas([1,2]),/misma moneda/);}finally{pool.query=original;}
});
test('la factura se registra de forma atómica y bloquea la orden para evitar duplicados',async()=>{
  const original=pool.getConnection;const writes=[];let committed=false;
  pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{},release(){},query:async(sql,params)=>{
    writes.push({sql,params});
    if(sql.includes('FROM carburacion_ordenes'))return [[{id:1,proveedor_id:1,total:'113.00',moneda:'CRC',placa_unidad:'Cliente'}]];
    if(sql.startsWith('SELECT'))return [[]];return [{insertId:1}];
  }});
  try {await f.registrarFactura(1,{numero:'F-1',fecha:'2026-10-13',vencimiento:'2026-11-13'},user);
    assert.ok(committed);assert.match(writes[0].sql,/FOR UPDATE/);assert.equal(writes[2].params[6],113);
    writes.forEach(w=>assert.match(w.sql,/carburacion_/));
  }finally{pool.getConnection=original;}
});
test('permite guardar una sola copia interna sin modificar configuración de Taller',async()=>{
  const original=pool.query;const writes=[];
  pool.query=async(sql,params)=>{writes.push({sql,params});return [{affectedRows:1}];};
  try {await withServer(async base=>{
    const response=await fetch(`${base}/carburacion/facturas/configuracion-correo`,{
      method:'POST',redirect:'manual',body:new URLSearchParams({copia_1:'ESegura.P@tomza.com',copia_2:'',copia_3:''})
    });
    assert.equal(response.status,302);assert.equal(writes.length,1);
    assert.match(writes[0].sql,/UPDATE carburacion_correo_config/);
    assert.deepEqual(writes[0].params.slice(0,4),['esegura.p@tomza.com','','',null]);
  });}finally{pool.query=original;}
});
test('registra una factura sin crear una orden y conserva cliente, proveedor e importe',async()=>{
  const original=pool.getConnection;const writes=[];let committed=false;
  pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{},release(){},query:async(sql,params)=>{
    writes.push({sql,params});
    if(sql.includes('FROM carburacion_proveedores'))return [[{id:1}]];
    if(sql.includes('FROM carburacion_clientes'))return [[{id:2,nombre:'Cliente de catálogo'}]];
    return [{insertId:10}];
  }});
  try {
    await f.registrarFactura(null,{numero:'SIN-1',fecha:'2026-10-13',vencimiento:'2026-11-13',proveedor_id:'1',cliente_id:'2',moneda:'USD',total:'25.50'},user);
    assert.ok(committed);const insert=writes.find(w=>w.sql.startsWith('INSERT'));
    assert.equal(insert.params[0],null);assert.equal(insert.params[1],1);assert.equal(insert.params[6],25.5);assert.equal(insert.params[7],'Cliente de catálogo');assert.equal(insert.params[13],2);
    assert.ok(writes.every(w=>!w.sql.includes('carburacion_ordenes')));
  }finally{pool.getConnection=original;}
});
test('paginación y navegación conservan filtros y no muestran Pago de proveedor',async()=>{
  const original=pool.query;const queries=[];
  pool.query=async(sql,params)=>{
    queries.push({sql,params});
    if(sql.includes('COUNT(*) cantidad'))return [[{moneda:'CRC',cantidad:101,total:101,pagado:0,saldo:101}]];
    if(sql.includes('SELECT f.id'))return [[{id:1,numero:'SIN-1',po_numero:null,proveedor_nombre:'Proveedor',cliente:'Cliente',fecha:'2026-10-01',vencimiento:'2026-11-01',moneda:'CRC',total:1,pagado:0}]];
    return [[]];
  };
  try {await withServer(async base=>{
    const response=await fetch(`${base}/carburacion/facturas?pagada=0&por_pagina=50&pagina=2&orden=asc&fecha_desde=2026-10-01`);
    assert.equal(response.status,200);const html=await response.text();
    for(const campo of ['proveedor_id','fecha_desde','fecha_hasta','pagada','periodo_cierre','vencida','orden','por_pagina'])assert.ok(html.includes(`name="${campo}"`));
    assert.match(html,/Página 2 de 3/);assert.match(html,/Sin orden/);assert.match(html,/Agregar factura sin orden/);assert.doesNotMatch(html,/Pago de proveedor|pagos-proveedor/);
    const lista=queries.find(q=>q.sql.includes('SELECT f.id'));assert.match(lista.sql,/ORDER BY f.fecha ASC,f.id ASC/);assert.deepEqual(lista.params.slice(-2),[50,50]);
    const nueva=await fetch(`${base}/carburacion/facturas/nueva?return_to=${encodeURIComponent('/carburacion/facturas?pagada=0&pagina=2')}`);
    assert.equal(nueva.status,200);const form=await nueva.text();assert.match(form,/Volver a facturas/);assert.match(form,/pagada=0&amp;pagina=2/);
    assert.equal((await fetch(`${base}/carburacion/facturas/pagos-proveedor`)).status,404);
  });}finally{pool.query=original;}
});
