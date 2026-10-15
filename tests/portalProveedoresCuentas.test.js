const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),session=require('express-session'),bcrypt=require('bcryptjs'),path=require('node:path');
const pool=require('../src/db');
const {externo,interno}=require('../src/routes/portalProveedores.routes');
const {ensureCsrfToken}=require('../src/middleware/security');
const {saldo}=require('../src/utils/proveeduria');
const ejs=require('ejs');
const password='ProveedorTest123!';
let hash;
test.before(async()=>{hash=await bcrypt.hash(password,4);});
const account={id:5,proveedor_id:1,email:'proveedor@example.com',cedula:'3101123456',nombre:'Proveedor',activo:1,version_acceso:1,plazo_dias:30};
async function server(user,fn){
  const app=express();app.set('views',path.join(__dirname,'../src/views'));app.set('view engine','ejs');app.use(express.json());app.use(express.urlencoded({extended:true}));app.use(session({secret:'secret-for-tests-only',resave:false,saveUninitialized:false}));app.use(ensureCsrfToken);
  app.get('/token',(req,res)=>res.json({token:res.locals.csrfToken}));
  app.use((req,res,next)=>{if(user)req.session.user=user;next();});app.use('/portal-proveedores',externo);app.use('/proveeduria/portal-proveedores',interno);
  const listener=app.listen(0,'127.0.0.1');await new Promise(r=>listener.once('listening',r));
  const base=`http://127.0.0.1:${listener.address().port}`;let cookie='',token;
  const client={async get(url,options={}){const r=await fetch(base+url,{redirect:'manual',...options,headers:{cookie,...options.headers}});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return r;},async csrf(){token=(await(await this.get('/token')).json()).token;},async post(url,body={}){return this.get(url,{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':token},body:JSON.stringify(body)});}};
  try{await client.csrf();await fn(client);}finally{await new Promise(r=>listener.close(r));}
}
const doc=()=>({id:11,tipo:'factura_portal',datos:{cuenta_id:5,proveedor:'Proveedor',razon_social:'Tomza',moneda:'CRC',pagos:[],factura:{numero:'00100001010000000001',total:113,estado:'PENDIENTE',fecha_vencimiento:'2026-11-13',subida_en:'2026-10-14T10:00:00Z',archivo:{id:1},electronica:{clave:'50614102600310112345600100001010000000001112345678',fecha:'2026-10-14T10:00:00-06:00',emisor:'3101123456',receptor:'3101654321',total:113,moneda:'CRC',archivo:{id:2},hacienda:{estado:'ACEPTADA',ambiente:'produccion'}}}}});
async function login(c){const r=await c.post('/portal-proveedores/login',{email:account.email,password});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/portal-proveedores');await c.csrf();}

test('asignación valida rol del responsable y limita comentarios; registra cambios auditados',async()=>{
  const connection=pool.getConnection;let asignable=false,guardado,acciones=0;
  pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql,args)=>{
    if(sql.includes('SELECT * FROM prov_documentos'))return [[doc()]];
    if(sql.includes('FROM usuarios')){assert.match(sql,/usuario AS username/);return [asignable?[{id:3,username:'conta'}]:[]];}
    if(sql.startsWith('UPDATE prov_documentos'))guardado=JSON.parse(args[0]);
    if(sql.includes('INSERT INTO prov_auditoria'))acciones++;return [{affectedRows:1}];
  }});
  try{await server({id:1,rol:'CONTABILIDAD'},async c=>{
    assert.equal((await c.post('/proveeduria/portal-proveedores/facturas/11/asignar',{responsable_id:3,fecha_limite:'2026-10-20'})).status,400);
    asignable=true;assert.equal((await c.post('/proveeduria/portal-proveedores/facturas/11/asignar',{responsable_id:3,fecha_limite:'2026-10-20'})).status,200);
    assert.equal(guardado.gestion.responsable_nombre,'conta');assert.equal(acciones,1);
    assert.equal((await c.post('/proveeduria/portal-proveedores/facturas/11/comentar',{mensaje:'x'.repeat(2001)})).status,400);
    assert.equal(acciones,1);
  });}finally{pool.getConnection=connection;}
});

test('proveedor solo responde devoluciones propias y no modifica XML ni aprueba el saldo',async()=>{
  const original=pool.query,connection=pool.getConnection;let row=doc(),guardado;
  row.datos.factura.estado='RECHAZADA_INTERNA';
  pool.query=async()=>[[{...account,password_hash:hash}]];
  pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql,args)=>{
    if(sql.includes('SELECT * FROM prov_documentos'))return [[row]];
    if(sql.startsWith('UPDATE prov_documentos'))guardado=JSON.parse(args[0]);return [{affectedRows:1}];
  }});
  try{await server(null,async c=>{
    await login(c);assert.equal((await c.post('/portal-proveedores/facturas/11/responder',{mensaje:'Ya aclaré el número de orden'})).status,200);
    assert.equal(guardado.factura.estado,'PENDIENTE');assert.equal(guardado.factura.cuenta_por_pagar,undefined);assert.equal(guardado.factura.electronica.clave,row.datos.factura.electronica.clave);
    row=doc();row.datos.cuenta_id=9;row.datos.factura.estado='RECHAZADA_INTERNA';guardado=null;
    assert.equal((await c.post('/portal-proveedores/facturas/11/responder',{mensaje:'Intento sobre factura ajena'})).status,400);assert.equal(guardado,null);
  });}finally{pool.query=original;pool.getConnection=connection;}
});
test('cuenta externa entra sin usuario interno, mantiene sesión y solo ve sus documentos',async()=>{
  const original=pool.query;let enabled=true;
  pool.query=async(sql,args)=>{
    if(sql.includes('FROM prov_portal_cuentas')){if(!enabled)return [[]];return [[{...account,password_hash:hash}]];}
    if(sql.includes("FROM prov_documentos WHERE tipo='factura_portal'")){assert.deepEqual(args,['5']);return [[doc()]];}
    if(sql.includes("FROM prov_documentos WHERE id="))return [[{...doc(),datos:{...doc().datos,cuenta_id:9}}]];
    if(sql.includes('FROM prov_portal_receptores'))return [[{cedula:'3101654321',nombre:'Tomza'}]];
    throw Error('Consulta inesperada');
  };
  try{await server(null,async c=>{
    assert.equal((await c.get('/portal-proveedores')).status,302);
    assert.equal((await c.post('/portal-proveedores/login',{email:account.email,password:'incorrecta'})).status,401);
    await login(c);
    const home=await c.get('/portal-proveedores');assert.equal(home.status,200);const html=await home.text();assert.match(html,/Mis facturas/);assert.match(html,/Suba únicamente el XML y el PDF/);assert.doesNotMatch(html,/data-ordenes-proveedor|Mis órdenes disponibles|name="orden"/);assert.doesNotMatch(html,/password_hash/);
    assert.equal((await c.get('/portal-proveedores/facturas/12/archivo/pdf')).status,404);
    enabled=false;assert.equal((await c.get('/portal-proveedores')).status,302);
  });}finally{pool.query=original;}
});
test('proveedor carga varias facturas propias sin OC; bloquea emisor ajeno y duplicados',async()=>{
  const original=pool.query,connection=pool.getConnection;let saved=[],duplicate=false;
  pool.query=async sql=>sql.includes('FROM prov_portal_cuentas')?[[{...account,password_hash:hash}]]:sql.includes('FROM prov_portal_receptores')?[[{cedula:'3101654321'}]]:[[]];
  pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql,args)=>{
    if(sql.includes('FROM prov_portal_cuentas'))return [[{id:5}]];
    if(sql.includes('SELECT documento_id'))return [duplicate?[{documento_id:11}]:[]];
    if(sql.includes("VALUES ('factura_portal'"))saved.push(JSON.parse(args[0]));
    return [{insertId:11}];
  }});
  const factura=emisor=>`<FacturaElectronica><Clave>${doc().datos.factura.electronica.clave}</Clave><NumeroConsecutivo>00100001010000000001</NumeroConsecutivo><FechaEmision>2026-10-14T10:00:00-06:00</FechaEmision><Emisor><Nombre>Proveedor</Nombre><Identificacion><Numero>${emisor}</Numero></Identificacion></Emisor><Receptor><Nombre>Tomza</Nombre><Identificacion><Numero>3101654321</Numero></Identificacion></Receptor><ResumenFactura><TotalComprobante>113</TotalComprobante></ResumenFactura></FacturaElectronica>`;
  const body=emisor=>({xml:{nombre:'f.xml',base64:Buffer.from(factura(emisor)).toString('base64')},archivo:{nombre:'f.pdf',base64:Buffer.from('%PDF-1.7').toString('base64')}});
  try{await server(null,async c=>{
    await login(c);
    assert.equal((await c.post('/portal-proveedores/facturas',body('3101000000'))).status,400);assert.equal(saved.length,0);
    assert.equal((await c.post('/portal-proveedores/facturas',{...body(account.cedula),orden:'COMPRAS:999999'})).status,200);assert.equal(saved[0].cuenta_id,5);assert.equal(saved[0].factura.fecha_vencimiento,'2026-11-13');assert.equal(saved[0].solicitud_id,undefined);
    const segunda=body(account.cedula);segunda.xml.base64=Buffer.from(factura(account.cedula).replaceAll('00100001010000000001','00100001010000000002')).toString('base64');
    assert.equal((await c.post('/portal-proveedores/facturas',segunda)).status,200);assert.equal(saved.length,2);
    duplicate=true;assert.equal((await c.post('/portal-proveedores/facturas',body(account.cedula))).status,400);assert.equal(saved.length,2);
  });}finally{pool.query=original;pool.getConnection=connection;}
});
test('aprobación interna exige aceptación Hacienda y pago no supera saldo',async()=>{
  const original=pool.query,connection=pool.getConnection;let row=doc(),writes=0;
  const linea={codigo:'A',cantidad:1,precio_unitario:100,iva:13};row.datos.factura.electronica.lineas=[linea];row.datos.orden_compra={origen:'PROVEEDURIA',id:7};
  pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql,args)=>{
    if(sql.includes("tipo='oc'"))return [[{datos:{proveedor:'Proveedor',moneda:'CRC',total:113,estado:'EMITIDA',lineas:[linea]}}]];
    if(sql.includes('SELECT d.id,d.datos FROM prov_portal_factura_orden'))return [[]];
    if(sql.includes('AS total FROM prov_documentos'))return [[{total:113}]];
    if(sql.includes('FROM prov_documentos'))return [[structuredClone(row)]];
    if(sql.startsWith('UPDATE prov_documentos')){row.datos=JSON.parse(args[0]);writes++;}
    return [{insertId:1}];
  }});
  const accountant={id:1,rol:'CONTABILIDAD',departamentoActivo:'CONTABILIDAD'};
  try{await server(accountant,async c=>{
    row.datos.factura.electronica.hacienda.estado='PENDIENTE';assert.equal((await c.post('/proveeduria/portal-proveedores/facturas/11/aprobar')).status,400);assert.equal(writes,0);
    row.datos.factura.electronica.hacienda.estado='ACEPTADA';assert.equal((await c.post('/proveeduria/portal-proveedores/facturas/11/aprobar')).status,200);assert.equal(row.datos.factura.cuenta_por_pagar,true);
    const pago={referencia:'P1',monto:114,fecha:'2026-10-14',archivo:{nombre:'p.pdf',base64:Buffer.from('%PDF-1.7').toString('base64')}};
    assert.equal((await c.post('/proveeduria/portal-proveedores/facturas/11/pago',pago)).status,400);assert.equal(row.datos.pagos.length,0);
    pago.monto=50;assert.equal((await c.post('/proveeduria/portal-proveedores/facturas/11/pago',pago)).status,200);assert.equal(saldo(row.datos).saldo,63);
    assert.equal((await c.post('/proveeduria/portal-proveedores/facturas/11/pago',pago)).status,400);
    assert.equal((await c.post('/proveeduria/portal-proveedores/facturas/11/programar',{monto:63,fecha:'2026-10-20'})).status,200);assert.equal(saldo(row.datos).saldo,63);assert.equal(row.datos.programacion.monto,63);
    assert.equal((await c.post('/proveeduria/portal-proveedores/facturas/11/recepcion',{referencia:'Entrega'})).status,400);
    row.datos.notas_credito=[{clave:'NC1',total:20,hacienda:{estado:'PENDIENTE',ambiente:'produccion'}}];
    assert.equal((await c.post('/proveeduria/portal-proveedores/facturas/11/aplicar-nota',{clave:'NC1'})).status,400);
    row.datos.notas_credito[0].hacienda.estado='ACEPTADA';assert.equal((await c.post('/proveeduria/portal-proveedores/facturas/11/aplicar-nota',{clave:'NC1'})).status,200);assert.equal(saldo(row.datos).saldo,43);assert.equal(row.datos.programacion,undefined);
    assert.equal((await c.post('/proveeduria/portal-proveedores/facturas/11/aplicar-nota',{clave:'NC1'})).status,400);assert.equal(saldo(row.datos).saldo,43);
    row.datos.notas_credito.push({clave:'NC2',total:44,hacienda:{estado:'ACEPTADA',ambiente:'produccion'}});assert.equal((await c.post('/proveeduria/portal-proveedores/facturas/11/aplicar-nota',{clave:'NC2'})).status,400);
  });await server({id:2,rol:'PROVEEDURIA'},async c=>assert.equal((await c.post('/proveeduria/portal-proveedores/facturas/11/aprobar')).status,403));}finally{pool.query=original;pool.getConnection=connection;}
});
test('pantallas de cuentas y bandeja renderizan estados y permisos',async()=>{
  const dir=path.join(__dirname,'../src/views/portal_proveedores');
  const admin=await ejs.renderFile(path.join(dir,'cuentas.ejs'),{proveedores:[{id:1,nombre:'Proveedor'}],cuentas:[account],receptores:[],puedeGestion:true});assert.match(admin,/Crear acceso de proveedor/);assert.match(admin,/Restablecer contraseña/);
  const page=await ejs.renderFile(path.join(dir,'bandeja.ejs'),{docs:[doc()],saldo,excepciones:require('../src/utils/portalControlFactura').excepciones,puedeContabilidad:true});assert.match(page,/Aprobar cuenta por pagar/);assert.match(page,/Consultar Hacienda/);assert.doesNotMatch(page,/Confirmar cantidades recibidas|Registrar recepción|Mercadería:/);
});
