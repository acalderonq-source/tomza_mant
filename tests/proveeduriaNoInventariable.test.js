const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('node:path');
const pool=require('../src/db'),router=require('../src/routes/proveeduria.routes');
const {articulosSolicitud,articuloSolicitudDescripcion,esNoInventariable}=require('../src/utils/proveeduriaSolicitable');
const {lineasCompra}=require('../src/utils/proveeduria');
const {versionOrden}=require('../src/utils/proveeduriaOrdenEdicion');
const solicitante={id:71,usuario:'operaciones',rol:'SUPERVISOR',sede:'Cartago',departamentoActivo:'OPERACIONES',departamentos:['OPERACIONES']};
const gestor={id:72,usuario:'compras',rol:'PROVEEDURIA',sede:'Cartago',departamentoActivo:'PROVEEDURIA',departamentos:['PROVEEDURIA']};
const calca=articuloSolicitudDescripcion('Calca TOMZA para tanque estacionario.'),sello=articuloSolicitudDescripcion('Sellos azules (pequeño - presión)'),cilindro=articuloSolicitudDescripcion('CILINDRO DE MONTACARGAS DE 10 LBS PARA GAS LICUADO');
async function servidor(user,run){
  const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));app.use(express.json());app.use(express.urlencoded({extended:true}));app.use((req,res,next)=>{req.session={user};next();});app.use('/proveeduria',router);
  const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));try{await run(`http://127.0.0.1:${s.address().port}/proveeduria`);}finally{await new Promise(r=>s.close(r));}
}
const json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('catálogo separado conserva los datos aportados, precios vacíos y decimales, e impide falsear artículos de stock',()=>{
  assert.equal(articulosSolicitud.length,238);assert.equal(new Set(articulosSolicitud.map(a=>a.codigo)).size,238);
  assert.equal(articulosSolicitud.filter(a=>a.precio_unitario!==null).length,68);
  assert.equal(calca.precio_unitario,null);assert.equal(sello.precio_unitario,0.026);assert.equal(cilindro.iva,0);
  assert.equal(articuloSolicitudDescripcion('TANQUE DE 500 GLS PARA GAS LICUADO').precio_unitario,1200);
  assert.equal(articuloSolicitudDescripcion('Pintura Azul Tomza').precio_unitario,37611);
  assert.equal(articulosSolicitud.filter(a=>a.descripcion.toLowerCase()==='calca litraje configurable.').length,1);
  assert(articulosSolicitud.every(a=>a.codigo.startsWith('SOL-')));assert.equal(articulosSolicitud.filter(a=>a.inventariable).length,15);assert.equal(articulosSolicitud.filter(a=>!a.inventariable).length,223);
  const l=lineasCompra([{codigo:cilindro.codigo,descripcion:cilindro.descripcion,cantidad:1,iva:99,inventariable:true},{codigo:'STOCK',descripcion:'Papel',cantidad:1,iva:1,inventariable:false}]);
  assert.equal(l[0].iva,0);assert.equal(l[0].inventariable,false);assert.equal(l[1].inventariable,undefined);assert.equal(esNoInventariable(l[1]),false);
});

test('cualquier departamento puede solicitar solo del catálogo separado aunque no exista inventario',async()=>{
  const oq=pool.query,oc=pool.getConnection,guardadas=[];
  const query=async(sql,args=[])=>{
    assert.doesNotMatch(sql,/prov_inventario/);
    if(sql.startsWith('INSERT INTO prov_documentos')){guardadas.push(JSON.parse(args[2]));return [{insertId:guardadas.length}];}
    return [[]];
  };
  pool.query=query;pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}});
  try{
    for(const departamento of ['OPERACIONES','TALLER','CONTABILIDAD','SEGURIDAD_OCUPACIONAL','LOGISTICA','RECURSOS_HUMANOS','CARBURACION','PROVEEDURIA'])await servidor({...solicitante,departamentoActivo:departamento,departamentos:[departamento]},async base=>{
      const r=await fetch(base+'/solicitudes',json({sede:'Cartago',departamento:'OTRO',lineas:[{codigo:calca.codigo,cantidad:2,descripcion:'Descripción falsa',iva:99,inventariable:true}]}));
      assert.equal(r.status,200);const d=guardadas.at(-1);assert.equal(d.departamento,departamento);assert.equal(d.lineas[0].descripcion,calca.descripcion);assert.equal(d.lineas[0].inventariable,false);assert.equal(d.lineas[0].iva,13);
    });
  }finally{pool.query=oq;pool.getConnection=oc;}
});

test('solicitud mixta llega hasta recepción confirmada sin crear stock, fichas ni movimientos para compra por solicitud',async()=>{
  const oq=pool.query,oc=pool.getConnection;
  const state={docs:new Map(),stock:2,movimientos:[],stockWrites:[],alertas:[]};let id=0;
  async function query(sql,args=[]){
    sql=sql.trim();
    if(sql.includes('FROM usuarios_sedes'))return [[]];
    if(sql.startsWith('SELECT * FROM prov_documentos WHERE id')){const d=state.docs.get(Number(args[0]));return [d&&d.tipo===args[1]?[structuredClone(d)]:[]];}
    if(sql.startsWith('SELECT * FROM prov_documentos'))return [[...state.docs.values()].map(d=>structuredClone(d))];
    if(sql.includes('SELECT factura_id FROM prov_portal_factura_orden'))return [[]];
    if(sql.includes('FROM prov_inventario i'))return [[{sede:'Cartago',codigo:'STOCK',descripcion:'Papel',iva:1,cantidad:state.stock,unidad:'UND',grupo:'SUMINISTRO',tipo:'CONSUMIBLE',stock_minimo:0,stock_maximo:0}]];
    if(sql.startsWith('SELECT codigo,descripcion,iva FROM prov_inventario')){assert.deepEqual(args,['Cartago','STOCK']);return [[{codigo:'STOCK',descripcion:'Papel',iva:1}]];}
    if(sql.startsWith('SELECT * FROM prov_inventario WHERE')){assert.equal(args[1],'STOCK');return [[{codigo:'STOCK',cantidad:state.stock}]];}
    if(sql.startsWith('SELECT'))return [[]];
    if(sql.startsWith('INSERT INTO prov_documentos')){const tipo=sql.match(/VALUES \('(\w+)'/)[1];const next=++id;state.docs.set(next,{id:next,tipo,usuario_id:args[0],sede:args[1],creado_en:new Date(),datos:JSON.parse(args[2])});return [{insertId:next}];}
    if(sql.startsWith('UPDATE prov_documentos SET datos'))state.docs.get(Number(args[1])).datos=JSON.parse(args[0]);
    if(sql.includes('INTO prov_inventario')||sql.startsWith('UPDATE prov_inventario')){
      state.stockWrites.push(sql);assert(args.includes('STOCK'),'Nunca se escribe stock para el catálogo SOL');
      if(sql.startsWith('INSERT INTO prov_inventario (')){assert.equal(args[1],'STOCK');state.stock+=args[4];}
      if(sql.startsWith('UPDATE prov_inventario SET cantidad=cantidad-'))state.stock-=args[0];
      if(sql.startsWith('INSERT INTO prov_inventario_movimientos'))state.movimientos.push({tipo:args[0],cantidad:args[1],codigo:args.at(-1)});
    }
    if(sql.startsWith('INSERT INTO prov_alertas'))state.alertas.push(args);
    return [{affectedRows:1}];
  }
  pool.query=query;pool.getConnection=async()=>{let before;return {query,beginTransaction:async()=>{before=structuredClone(state);},commit:async()=>{},rollback:async()=>{Object.assign(state,before);},release(){}};};
  const pedidas=[{codigo:calca.codigo,cantidad:1},{codigo:sello.codigo,cantidad:2},{codigo:cilindro.codigo,cantidad:1},{codigo:'STOCK',cantidad:2,inventariable:false}];
  function formulario(){const f=new URLSearchParams({origen_formulario:'taller',solicitud_id:'1',proveedor:'Proveedor',email:'p@example.com',empresa_destino:'GAS TOMZA',credito:'30',entrega:'5 días',moneda:'CRC'});state.docs.get(1).datos.lineas.forEach((l,i)=>{for(const [k,v]of Object.entries({codigo_producto:l.codigo,descripcion:l.descripcion,cantidad:l.cantidad,precio_unitario:[100,0.026,28,20][i]}))f.set(`lineas[${i}][${k}]`,String(v));});return f;}
  try{
    await servidor(solicitante,async base=>{
      const r=await fetch(base+'/solicitudes',json({sede:'Cartago',departamento:'PROVEEDURIA',lineas:pedidas}));assert.equal(r.status,200);
      assert.equal(state.docs.get(1).datos.departamento,'OPERACIONES');assert.equal(state.stockWrites.length,0);
      assert.deepEqual(state.docs.get(1).datos.lineas.map(l=>l.inventariable),[false,false,false,undefined]);
      const pagina=await fetch(base+'/mis-solicitudes');assert.equal(pagina.status,200);const html=await pagina.text();assert.match(html,/Compra por solicitud/);assert.match(html,new RegExp(calca.codigo));assert.doesNotMatch(html,/precio_unitario/);
      assert.equal((await fetch(base+'/inventario')).status,403);
    });
    await servidor(gestor,async base=>{
      const inventario=await (await fetch(base+'/inventario')).text();assert.doesNotMatch(inventario,new RegExp(calca.codigo));assert.doesNotMatch(inventario,/Calca TOMZA para tanque estacionario/);
      const cotizar=await fetch(base+'/solicitudes/1/cotizacion');assert.equal(cotizar.status,200);assert.match(await cotizar.text(),/precio_unitario":0.026/);
      assert.equal((await fetch(base+'/solicitudes/1/cotizacion',{method:'POST',body:formulario(),redirect:'manual'})).status,302);
      assert.equal((await fetch(base+'/ordenes',{method:'POST',body:formulario(),redirect:'manual'})).status,302);
      let orden=state.docs.get(2);assert.equal(orden.datos.lineas[2].iva,0);assert(orden.datos.lineas.slice(0,3).every(esNoInventariable));
      const edicion=formulario();edicion.set('version',versionOrden(orden));edicion.set('sede','Cartago');assert.equal((await fetch(base+'/ordenes/2/editar',{method:'POST',body:edicion,redirect:'manual'})).status,302);
      assert(state.docs.get(2).datos.lineas.slice(0,3).every(esNoInventariable));
      const antes=await fetch(base+'/salidas',json({solicitud_id:1}));assert.equal(antes.status,400);
      const parcial={token:'a'.repeat(32),version:0,referencia:'Entrega 1',lineas:[{codigo:calca.codigo,cantidad:1},{codigo:sello.codigo,cantidad:1}]};
      assert.equal((await fetch(base+'/ordenes/2/recibir',json(parcial))).status,200);assert.equal(state.stockWrites.length,0);assert.equal(state.docs.get(2).datos.estado,'PARCIAL');
      assert.equal((await fetch(base+'/salidas',json({solicitud_id:1}))).status,400);
      const detalle=await fetch(base+'/ordenes/2/recepcion');assert.equal(detalle.status,200);assert.match(await detalle.text(),/No ingresa a inventario/);
      const final={token:'b'.repeat(32),version:1,referencia:'Entrega 2',lineas:[{codigo:sello.codigo,cantidad:1},{codigo:cilindro.codigo,cantidad:1},{codigo:'STOCK',cantidad:2}]};
      assert.equal((await fetch(base+'/ordenes/2/recibir',json(final))).status,200);assert.equal(state.stock,4);assert.equal(state.docs.get(2).datos.estado,'RECIBIDA');assert.equal(state.movimientos.length,1);
      const repetida=await fetch(base+'/ordenes/2/recibir',json(final));assert.equal((await repetida.json()).repetida,true);assert.equal(state.stock,4);
      assert.equal((await fetch(base+'/salidas',json({solicitud_id:1}))).status,200);assert.equal(state.stock,2);assert.equal(state.movimientos.length,2);
      const salida=state.docs.get(3);assert.equal(salida.datos.lineas.length,4);assert(salida.datos.lineas.filter(esNoInventariable).length===3);
      assert.equal((await fetch(base+'/salidas/3/enviar',{method:'POST'})).status,200);
      const imprimir=await fetch(base+'/salidas/3/imprimir');assert.equal(imprimir.status,200);assert.match(await imprimir.text(),/Calca TOMZA para tanque estacionario/);
      const crear=await fetch(base+'/inventario/articulos',json({codigo:calca.codigo,descripcion:calca.descripcion}));assert.equal(crear.status,400);
    });
    await servidor(solicitante,async base=>assert.equal((await fetch(base+'/salidas/3/aceptar',{method:'POST'})).status,200));
    assert.equal(state.docs.get(1).datos.estado,'ENTREGADA');assert.equal(state.stock,2);assert.equal(state.movimientos.length,2);
  }finally{pool.query=oq;pool.getConnection=oc;}
});
