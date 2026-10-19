const {test}=require('node:test');
const assert=require('node:assert/strict');
const cola=require('../src/utils/ordenesCorreo');
test('Orden guarda destinatario exclusivo y copia original en la misma conexion',async()=>{
  const calls=[];
  const db={query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql.startsWith('SELECT * FROM ordenes_compra WHERE')) return [[{id:7,proveedor_id:3,po_numero:'2026-7'}]];
    if(sql.startsWith('SELECT * FROM proveedores')) return [[{id:3,nombre:'Proveedor',email:'DESTINO@example.com'}]];
    if(sql.startsWith('SELECT * FROM ordenes_compra_detalle')) return [[{descripcion:'Llanta'}]];
    return [{affectedRows:1}];
  }};
  await cola.encolar(db,7);
  const insert=calls.at(-1);
  assert.equal(insert.args[2],'destino@example.com');
  assert.equal(insert.args[4],'PENDIENTE');
  assert.equal(JSON.parse(insert.args[3]).lineas[0].descripcion,'Llanta');
  assert.equal(cola.destino('a@example.com,b@example.com'),null);
});
test('Worker adjunta PDF y no marca como enviado si Microsoft falla',async()=>{
  process.env.MS_SEGURIDAD_CLIENT_ID='test';process.env.MS_SEGURIDAD_CLIENT_SECRET='test';
  const row={orden_id:7,correo:'proveedor@example.com',estado:'PENDIENTE',intentos:0,
    datos:JSON.stringify({orden:{po_numero:'2026-7'},proveedor:{nombre:'<script>'},lineas:[]})};
  try {
    const queries=[];
    const db={query:async(sql,args)=>{queries.push({sql,args});return sql.startsWith('SELECT *')?[[row]]:[{affectedRows:1}];}};
    let enviado;
    await cola.procesar(db,async(...args)=>{enviado=args;},async()=>Buffer.from('%PDF'),{});
    assert.equal(enviado[1],'proveedor@example.com');
    assert.ok(enviado[3].includes('&lt;script&gt;'));
    assert.equal(enviado[5][0].content.toString(),'%PDF');
    assert.ok(queries.some(q=>q.sql.includes("estado='ENVIADO'")));
    queries.length=0;
    await cola.procesar(db,async()=>{throw Object.assign(Error('timeout'),{name:'TimeoutError'});},async()=>Buffer.from('%PDF'),{});
    assert.equal(queries.at(-1).args[0],'REVISION');
    assert.equal(queries.some(q=>q.sql.includes("estado='ENVIADO'")),false);
    queries.length=0;
    await cola.procesar(db,async()=>assert.fail('staging no envia'),async()=>Buffer.from(''),{APP_ENV:'staging'});
    assert.equal(queries.length,0);
  } finally {delete process.env.MS_SEGURIDAD_CLIENT_ID;delete process.env.MS_SEGURIDAD_CLIENT_SECRET;}
});
test('Claim perdido no envia duplicado y sin proveedor no se inventa destinatario',async()=>{
  process.env.MS_SEGURIDAD_CLIENT_ID='test';process.env.MS_SEGURIDAD_CLIENT_SECRET='test';
  try {
    const db={query:async(sql)=>sql.startsWith('SELECT *')?[[{orden_id:1,estado:'PENDIENTE',intentos:0}]]:[{affectedRows:0}]};
    await cola.procesar(db,async()=>assert.fail('otro worker ya reclamo'),async()=>Buffer.from(''),{});
    await assert.rejects(cola.encolar({query:async()=>[[]]},1),/Orden inexistente/);
  } finally {delete process.env.MS_SEGURIDAD_CLIENT_ID;delete process.env.MS_SEGURIDAD_CLIENT_SECRET;}
});
