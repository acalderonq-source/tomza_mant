const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const path=require('node:path');
const pool=require('../src/db');
const routes=require('../src/routes/proveeduria.routes');
const requester={id:71,usuario:'operaciones',nombre:'Solicitante Operaciones',rol:'SUPERVISOR',sede:'Cartago',departamentoActivo:'OPERACIONES',departamentos:['OPERACIONES']};
const manager={id:72,usuario:'compras',rol:'PROVEEDURIA',sede:'Cartago',departamentoActivo:'PROVEEDURIA',departamentos:['PROVEEDURIA']};
test('todos los departamentos solicitan del inventario comun de su sede geografica',async()=>{
  const originalQuery=pool.query,originalConnection=pool.getConnection;
  const guardadas=[];
  async function query(sql,args=[]){
    if(sql.includes('FROM usuarios_sedes'))return [[{sede:'granel_cartago'},{sede:'Tecnicos'},{sede:'Taller'}]];
    if(sql.includes('FROM prov_inventario i')){assert.deepEqual(args,['Cartago']);return [[{sede:'Cartago',codigo:'PAPEL',descripcion:'Papel',unidad:'UND'}]];}
    if(sql.startsWith('SELECT codigo,descripcion,iva,cantidad FROM prov_inventario')){assert.equal(args[0],'Cartago');return [[{codigo:'PAPEL',descripcion:'Papel',iva:13}]];}
    if(sql.startsWith('INSERT INTO prov_documentos')){guardadas.push(args);return [{insertId:guardadas.length}];}
    return [[]];
  }
  pool.query=query;pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}});
  try{
    for(const departamento of ['OPERACIONES','TALLER','CONTABILIDAD','SEGURIDAD_OCUPACIONAL','LOGISTICA','RECURSOS_HUMANOS','CARBURACION','ADMINISTRACION','PROVEEDURIA']){
      await server({...requester,sede:'granel_cartago',departamentoActivo:departamento,departamentos:[departamento]},async base=>{
        const r=await fetch(base+'/mis-solicitudes');assert.equal(r.status,200);const html=await r.text();
        assert.equal((html.match(/<option value="Cartago"/g)||[]).length,1);
        assert.doesNotMatch(html,/<option value="(?:granel_cartago|Taller|Tecnicos)"/);
        assert.match(html,/value="Cartago" selected/);
        const post=await fetch(base+'/solicitudes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sede:'granel_cartago',lineas:[{codigo:'PAPEL',cantidad:1}]})});
        assert.equal(post.status,200);assert.equal(guardadas.at(-1)[1],'Cartago');
        assert.equal(JSON.parse(guardadas.at(-1)[2]).departamento,departamento);
        const ajena=await fetch(base+'/solicitudes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sede:'granel_la_cruz',lineas:[{codigo:'PAPEL',cantidad:1}]})});
        assert.equal(ajena.status,403);
      });
    }
    await server({...requester,sede:'La Cruz'},async base=>{
      const pagina=await fetch(base+'/mis-solicitudes');assert.equal(pagina.status,200);assert.match(await pagina.text(),/Papel/);
      const post=await fetch(base+'/solicitudes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sede:'La Cruz',lineas:[{codigo:'PAPEL',cantidad:1}]})});
      assert.equal(post.status,200);assert.equal(guardadas.at(-1)[1],'La Cruz');
    });
  }finally{pool.query=originalQuery;pool.getConnection=originalConnection;}
});
async function server(user,fn){
  const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));app.use(express.json());app.use(express.urlencoded({extended:true}));app.use((req,res,next)=>{req.session={user};next();});app.use('/proveeduria',routes);
  const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));
  try{await fn(`http://127.0.0.1:${s.address().port}/proveeduria`);}finally{await new Promise(r=>s.close(r));}
}
test('departamento solicitante solo puede consultar sus pedidos y no gestionar compras',async()=>{
  const original=pool.query;pool.query=async(sql,args)=>{
    if(sql.includes('FROM prov_documentos')){assert.match(sql,/usuario_id=\?/);assert.deepEqual(args,[71]);return [[{id:1,tipo:'solicitud',sede:'Cartago',datos:{departamento:'OPERACIONES',estado:'PENDIENTE',lineas:[{descripcion:'Papel',cantidad:2}]}}]];}
    if(sql.includes('FROM prov_inventario i')){assert.deepEqual(args,['Cartago']);assert.match(sql,/WHERE i.sede IN/);assert.doesNotMatch(sql,/cantidad\s*>/);return [[{sede:'Cartago',codigo:'PAPEL',descripcion:'Papel',unidad:'RESMA'}]];}
    if(sql.includes('FROM prov_alertas'))assert.deepEqual(args,[71]);return [[]];
  };
  try{await server(requester,async base=>{
    const r=await fetch(base+'/mis-solicitudes');assert.equal(r.status,200);const html=await r.text();assert.match(html,/Nueva solicitud · Operaciones/);assert.match(html,/Papel/);assert.doesNotMatch(html,/precio_unitario|factura\/conciliar/);assert.doesNotMatch(html,/name="departamento"/);assert.match(html,/Código automático/);assert.match(html,/proveeduria-solicitudes.js/);assert.match(html,/"codigo":"PAPEL"/);assert.equal(r.headers.get('cache-control'),'no-store');
    for(const p of ['/gestion','/solicitudes','/ordenes/nueva'])assert.equal((await fetch(base+p)).status,403);
    assert.equal((await fetch(base+'/ordenes',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  });
  for(const departamento of ['TALLER','CONTABILIDAD','SEGURIDAD_OCUPACIONAL','LOGISTICA','RECURSOS_HUMANOS','CARBURACION'])await server({...requester,departamentoActivo:departamento,departamentos:[departamento]},async base=>assert.equal((await fetch(base+'/mis-solicitudes')).status,200,departamento));
  }finally{pool.query=original;}
});
test('flujo completo: solicitud de otro departamento, cotización, OC, recepción y entrega confirmada',async()=>{
  const originalQuery=pool.query,originalConnection=pool.getConnection;
  const regional={...requester,sede:'La Cruz'};
  const docs=new Map(),stock=new Map(),alerts=[];let nextId=1;
  async function query(sql,args=[]){
    if(sql.includes('FROM prov_proveedores'))return [[]];
    if(sql.startsWith('SELECT * FROM prov_documentos WHERE id')){const d=docs.get(Number(args[0]));return [d&&d.tipo===args[1]?[structuredClone(d)]:[]];}
    if(sql.startsWith('SELECT datos FROM prov_documentos'))return [[...docs.values()].filter(d=>d.tipo==='oc').map(d=>({datos:d.datos}))];
    if(sql.startsWith('SELECT * FROM prov_documentos')){let rows=[...docs.values()];if(sql.includes("tipo='solicitud'"))rows=rows.filter(r=>r.tipo==='solicitud');if(sql.includes('usuario_id=?'))rows=rows.filter(r=>r.usuario_id===args[0]&&['solicitud','salida'].includes(r.tipo));return [structuredClone(rows)];}
    if(sql.includes('FROM usuarios_sedes'))return [[]];
    if(sql.startsWith('SELECT codigo,descripcion,iva,cantidad FROM prov_inventario')){assert.equal(args[0],'Cartago');return [[{codigo:'PAPEL',descripcion:'Papel',iva:13}]];}
    if(sql.includes('FROM prov_inventario i'))return [[{sede:'Cartago',codigo:'PAPEL',descripcion:'Papel',unidad:'UND'}]];
    if(sql.startsWith('SELECT')&&sql.includes('FROM prov_inventario'))return [stock.has(args[1])?[{cantidad:stock.get(args[1])}]:[]];
    if(sql.startsWith('SELECT')&&sql.includes('FROM prov_alertas'))return [alerts.filter(a=>a.usuario_id===args[0])];
    if(sql.startsWith('INSERT INTO prov_documentos')){const tipo=sql.match(/VALUES \('(\w+)'/)[1],id=nextId++;docs.set(id,{id,tipo,usuario_id:args[0],sede:args[1],datos:JSON.parse(args[2]),creado_en:new Date()});return [{insertId:id}];}
    if(sql.startsWith('UPDATE prov_documentos')){docs.get(Number(args[1])).datos=JSON.parse(args[0]);return [{affectedRows:1}];}
    if(sql.startsWith('INSERT INTO prov_inventario (')){assert.equal(args[0],'Cartago');stock.set(args[1],(stock.get(args[1])||0)+args[4]);}
    if(sql.startsWith('UPDATE prov_inventario')){assert.equal(args[1],'Cartago');stock.set(args[2],stock.get(args[2])-args[0]);}
    if(sql.startsWith('INSERT INTO prov_alertas'))alerts.push({id:alerts.length+1,usuario_id:args[0],grupo:args[1],mensaje:args[2],documento_id:args[3]});
    return [{affectedRows:1}];
  }
  pool.query=query;pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}});
  const json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const form=()=>new URLSearchParams({origen_formulario:'taller',cotizacion_data:'data:application/pdf;base64,JVBERi0xLjQK',cotizacion_nombre:'cotizacion.pdf',solicitud_id:'1',proveedor:'Proveedor',email:'proveedor@example.com',empresa_destino:'GAS TOMZA',credito:'30',forma_pago:'Crédito',entrega:'5 días',moneda:'CRC',iva:'13','lineas[0][codigo_producto]':'PAPEL','lineas[0][descripcion]':'Papel','lineas[0][cantidad]':'2','lineas[0][precio_unitario]':'100'});
  try{
    await server(regional,async base=>{
      const r=await fetch(base+'/solicitudes',json({departamento:'PROVEEDURIA',lineas:[{codigo:'PAPEL',descripcion:'Papel',cantidad:2,iva:99}],motivo:'Para la oficina'}));assert.equal(r.status,200);assert.equal(docs.get(1).datos.departamento,'OPERACIONES');assert.equal(docs.get(1).datos.solicitante,requester.nombre);assert.equal(docs.get(1).datos.lineas[0].iva,13);assert.equal(alerts[0].grupo,'PROVEEDURIA');
    });
    await server(manager,async base=>{
      const bandeja=await fetch(base+'/solicitudes');assert.equal(bandeja.status,200);const html=await bandeja.text();assert.match(html,/Solicitante Operaciones/);assert.match(html,/Preparar cotización/);
      const antes=await fetch(base+'/ordenes/nueva?solicitud_id=1',{redirect:'manual'});assert.equal(antes.status,302);assert.equal(antes.headers.get('location'),'/proveeduria/solicitudes/1/cotizacion');
      assert.equal((await fetch(base+'/ordenes',{method:'POST',body:form(),redirect:'manual'})).status,400);
      const sinArchivo=form();sinArchivo.delete('cotizacion_data');const rechazada=await fetch(base+'/solicitudes/1/cotizacion',{method:'POST',body:sinArchivo,redirect:'manual'});assert.equal(rechazada.status,400);assert.match(await rechazada.text(),/Adjunte el archivo de la cotización/);assert.equal(docs.get(1).datos.estado,'PENDIENTE');
      const cotizacion=await fetch(base+'/solicitudes/1/cotizacion');assert.equal(cotizacion.status,200);assert.match(await cotizacion.text(),/Guardar cotización/);
      assert.equal((await fetch(base+'/solicitudes/1/cotizacion',{method:'POST',body:form(),redirect:'manual'})).status,302);assert.equal(docs.get(1).datos.estado,'COTIZADA');assert.equal(docs.size,1);
      const nueva=await fetch(base+'/ordenes/nueva?solicitud_id=1');assert.equal(nueva.status,200);assert.match(await nueva.text(),/proveedor@example.com/);
      assert.equal((await fetch(base+'/ordenes',{method:'POST',body:form(),redirect:'manual'})).status,302);assert.equal(docs.get(1).datos.estado,'ORDENADA');assert.equal(docs.get(2).usuario_id,71);
      assert.equal((await fetch(base+'/salidas',json({solicitud_id:1}))).status,400);
      assert.equal((await fetch(base+'/ordenes/2/recibir',json({token:'a'.repeat(32),version:0,referencia:'Factura 123',lineas:[{codigo:'PAPEL',cantidad:2}]}))).status,200);assert.equal(docs.get(1).datos.estado,'LISTA_PARA_ENTREGA');
      assert.equal((await fetch(base+'/salidas',json({solicitud_id:1}))).status,200);assert.equal(docs.get(1).datos.estado,'ALISTANDO');assert.equal(stock.get('PAPEL'),0);
      assert.equal((await fetch(base+'/salidas/3/enviar',{method:'POST'})).status,200);assert.equal(docs.get(1).datos.estado,'EN_CAMINO');
    });
    await server(regional,async base=>{
      const pedidos=await fetch(base+'/mis-solicitudes');assert.equal(pedidos.status,200);assert.match(await pedidos.text(),/Confirmar que recibí los productos/);
      assert.equal((await fetch(base+'/salidas/3/aceptar',{method:'POST'})).status,200);assert.equal(docs.get(1).datos.estado,'ENTREGADA');assert.equal(docs.get(3).datos.estado,'RECIBIDA');
    });
  }finally{pool.query=originalQuery;pool.getConnection=originalConnection;}
});

test('solicitudes solo admiten artículos existentes de la sede y toman sus datos del inventario y de la sesión',async()=>{
  const originalQuery=pool.query,originalConnection=pool.getConnection;
  const guardadas=[],alertas=[];
  async function query(sql,args=[]){
    if(sql.includes('FROM usuarios_sedes'))return [[]];
    if(sql.startsWith('SELECT codigo,descripcion,iva,cantidad FROM prov_inventario')){
      assert.equal(args[0],'Cartago');
      return [[...args.slice(1).filter(c=>['PAPEL','CAFE'].includes(c)).map(c=>({codigo:c,descripcion:c==='PAPEL'?'Papel oficial':'Café',iva:c==='PAPEL'?13:1}))]];
    }
    if(sql.startsWith('INSERT INTO prov_documentos')){guardadas.push({usuario:args[0],sede:args[1],datos:JSON.parse(args[2])});return [{insertId:guardadas.length}];}
    if(sql.startsWith('INSERT INTO prov_alertas'))alertas.push(args);
    return [[]];
  }
  pool.query=query;pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}});
  const post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{await server(requester,async base=>{
    const r=await fetch(base+'/solicitudes',post({sede:'Cartago',departamento:'CONTABILIDAD',solicitante:'Otro usuario',lineas:[{codigo:'PAPEL',cantidad:2,descripcion:'Texto alterado',iva:99,precio_unitario:999},{codigo:'CAFE',cantidad:1.125}]}));
    assert.equal(r.status,200);assert.equal(guardadas[0].usuario,71);assert.equal(guardadas[0].datos.departamento,'OPERACIONES');assert.equal(guardadas[0].datos.solicitante,requester.nombre);
    assert.deepEqual(guardadas[0].datos.lineas.map(l=>[l.codigo,l.descripcion,l.cantidad,l.iva,l.precio_unitario]),[['PAPEL','Papel oficial',2,13,0],['CAFE','Café',1.125,1,0]]);
    assert.equal(alertas.length,1);
    for(const lineas of [[],[{descripcion:'Producto libre',cantidad:1}],[{codigo:'NO-EXISTE',cantidad:1}],[{codigo:'PAPEL',cantidad:1},{codigo:'PAPEL',cantidad:2}],[{codigo:'PAPEL',cantidad:0}],[{codigo:'PAPEL',cantidad:1.0001}],[null],Array.from({length:201},(_,i)=>({codigo:`A${i}`,cantidad:1}))]){
      const bad=await fetch(base+'/solicitudes',post({sede:'Cartago',lineas}));assert.equal(bad.status,400,JSON.stringify(lineas).slice(0,150));
    }
    const fuera=await fetch(base+'/solicitudes',post({sede:'Liberia',lineas:[{codigo:'PAPEL',cantidad:1}]}));assert.equal(fuera.status,403);
    assert.equal(guardadas.length,1);assert.equal(alertas.length,1);
  });}finally{pool.query=originalQuery;pool.getConnection=originalConnection;}
});


test('categorías: admite pedidos mixtos y rechaza productos inventados o categorías ajenas sin guardar ni alertar',async()=>{
  const {articulosSolicitud}=require('../src/utils/proveeduriaSolicitable');
  const externo=articulosSolicitud.find(a=>a.categoria==='Uniformes');
  const originalQuery=pool.query,originalConnection=pool.getConnection;
  const guardadas=[],alertas=[];
  async function query(sql,args=[]){
    if(sql.startsWith('SELECT codigo,descripcion,iva,cantidad FROM prov_inventario'))return [[...args.slice(1).filter(c=>c==='PAPEL').map(c=>({codigo:c,descripcion:'Papel oficial',iva:13}))]];
    if(sql.startsWith('SELECT codigo,categoria FROM prov_inventario_fichas'))return [[{codigo:'PAPEL',categoria:'Oficina'}]];
    if(sql.startsWith('INSERT INTO prov_documentos')){guardadas.push(JSON.parse(args[2]));return [{insertId:guardadas.length}];}
    if(sql.startsWith('INSERT INTO prov_alertas'))alertas.push(args);
    return [[]];
  }
  pool.query=query;pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}});
  const post=lineas=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sede:'Cartago',lineas})});
  try{await server(requester,async base=>{
    const lineas=[{codigo:'PAPEL',categoria:'Oficina',cantidad:1,descripcion:'Inventado'},{codigo:externo.codigo,categoria:externo.categoria,cantidad:2}];
    assert.equal((await fetch(base+'/solicitudes',post(lineas))).status,200);
    assert.deepEqual(guardadas[0].lineas.map(l=>[l.codigo,l.categoria]),[['PAPEL','Oficina'],[externo.codigo,'Uniformes']]);
    assert.equal(guardadas[0].lineas[0].descripcion,'Papel oficial');
    assert.equal(guardadas[0].lineas[1].inventariable,false);
    for(const incorrectas of [[{codigo:'PAPEL',categoria:'Limpieza',cantidad:1}],[{codigo:externo.codigo,categoria:'Oficina',cantidad:1}],[{codigo:'PAPEL',categoria:'Nueva categoría',cantidad:1}],[{codigo:'PAPEL',categoria:'',cantidad:1}],[{codigo:'INVENTADO',categoria:'Oficina',cantidad:1}]]){
      assert.equal((await fetch(base+'/solicitudes',post(incorrectas))).status,400);
    }
    assert.equal(guardadas.length,1);assert.equal(alertas.length,1);
  });}finally{pool.query=originalQuery;pool.getConnection=originalConnection;}
});

test('la solicitud con existencias pasa a entrega directa y se vuelve a comprobar al despachar', async () => {
  const originalQuery=pool.query, originalConnection=pool.getConnection;
  const docs=new Map(); let stock=5, siguiente=1;
  async function query(sql,args=[]){
    if(sql.startsWith('SELECT codigo,descripcion,iva,cantidad FROM prov_inventario'))return [[{codigo:'PAPEL',descripcion:'Papel',iva:13,cantidad:stock}]];
    if(sql.startsWith('SELECT * FROM prov_documentos WHERE id')){const d=docs.get(Number(args[0]));return [d&&d.tipo===args[1]?[structuredClone(d)]:[]];}
    if(sql.startsWith('SELECT * FROM prov_inventario'))return [[{codigo:'PAPEL',cantidad:stock}]];
    if(sql.startsWith('INSERT INTO prov_documentos')){const id=siguiente++,tipo=sql.match(/VALUES \('(\w+)'/)[1];docs.set(id,{id,tipo,usuario_id:args[0],sede:args[1],datos:JSON.parse(args[2])});return [{insertId:id}];}
    if(sql.startsWith('UPDATE prov_inventario SET cantidad=cantidad-'))stock-=args[0];
    if(sql.startsWith('UPDATE prov_documentos'))docs.get(Number(args[1])).datos=JSON.parse(args[0]);
    if(sql.startsWith('SELECT'))return [[]];
    return [{affectedRows:1}];
  }
  pool.query=query;pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}});
  try{
    await server(requester,async base=>{
      const r=await fetch(base+'/solicitudes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sede:'Cartago',lineas:[{codigo:'PAPEL',cantidad:3,existencia:999}]})});
      assert.equal(r.status,200);assert.equal(docs.get(1).datos.estado,'LISTA_PARA_ENTREGA');
      assert.equal(docs.get(1).datos.existencias.lineas[0].existencia,5);assert.equal(stock,5);
    });
    await server(manager,async base=>{
      const crear=()=>fetch(base+'/salidas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({solicitud_id:1})});
      stock=1;assert.equal((await crear()).status,400);assert.equal(docs.size,1);assert.equal(stock,1);
      stock=5;assert.equal((await crear()).status,200);assert.equal(stock,2);assert.equal(docs.get(1).datos.estado,'ALISTANDO');
    });
  }finally{pool.query=originalQuery;pool.getConnection=originalConnection;}
});
