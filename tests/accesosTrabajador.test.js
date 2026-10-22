const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validarAcceso,puedeAcceder,controlarAccesosPersonales}=require('../src/utils/accesosTrabajador');
test('Aprobacion exige area, sede laboral y permisos conocidos sin Administracion',()=>{
  const body={departamento:'TALLER',sede_asignada:'Cartago',permiso_MANTENIMIENTOS:'LECTURA'};
  const config=validarAcceso(body);
  assert.equal(puedeAcceder(config,'/mantenimientos','GET'),true);
  assert.equal(puedeAcceder(config,'/mantenimientos/1','POST'),false);
  assert.equal(puedeAcceder(config,'/compras/facturas','GET'),false);
  assert.equal(puedeAcceder(config,'/administracion','GET'),false);
  assert.equal(puedeAcceder(config,'/admin/solicitudes-trabajadores','POST'),false);
  assert.equal(puedeAcceder(config,'/mantenimientos-otro','GET'),false);
  config.permisos.MANTENIMIENTOS='GESTION';assert.equal(puedeAcceder(config,'/mantenimientos/1','POST'),true);
  for(const extra of [{departamento:'ADMINISTRACION'},{sede_asignada:'inventada'},{permiso_CARBURACION:'GESTION'},{permiso_MANTENIMIENTOS:'ADMIN'},{permiso_MANTENIMIENTOS:'NINGUNO'}])assert.throws(()=>validarAcceso({...body,...extra}));
  const finanzas=validarAcceso({departamento:'CONTABILIDAD',sede_asignada:'Cartago',permiso_FACTURAS:'GESTION'});
  assert.equal(puedeAcceder(finanzas,'/compras/facturas/asientos','GET'),false,'el submodulo mas especifico tiene permiso separado');
  const guard=require('../src/utils/departamentos').controlarAccesoPorDepartamento;
  let allowed=false;
  const user={usuario:'acceso_123456789',rol:'SUPERVISOR',departamentoActivo:'OPERACIONES',accesoPersonal:{departamento:'OPERACIONES',permisos:{OPERACIONES:'LECTURA'}}};
  const res={status(n){assert.equal(n,403);return this;},send(){}};
  guard({session:{user},path:'/revision-ruta',method:'GET'},res,()=>{allowed=true;});assert.equal(allowed,true);
  guard({session:{user},path:'/revision-ruta',method:'POST'},res,()=>assert.fail());
});
test('Permisos personales se verifican frescos, deniegan faltantes y no afectan perfiles previos',async()=>{
  let reads=0,config={departamento:'TALLER',sede:'Cartago',permisos:{MANTENIMIENTOS:'LECTURA'}};
  const db={query:async(sql,args)=>{reads++;return args[0]===7?[[]]:config?[[{config_json:JSON.stringify(config)}]]:[[]];}};
  const guard=controlarAccesosPersonales(db);
  const res=()=>({code:200,status(n){this.code=n;return this;},send(){}});
  let next=false;
  await guard({session:{user:{id:7,usuario:'taller'}},path:'/compras',method:'GET'},res(),()=>{next=true;});assert.equal(next,true);assert.equal(reads,1);
  const req={session:{user:{id:100,usuario:'acceso_123456789',departamentoActivo:'TALLER'}},path:'/mantenimientos',method:'GET'};
  next=false;await guard(req,res(),()=>{next=true;});assert.equal(next,true);
  req.method='POST';let r=res();await guard(req,r,()=>assert.fail());assert.equal(r.code,403);
  config=null;r=res();await guard(req,r,()=>assert.fail());assert.equal(r.code,403);
  const broken=controlarAccesosPersonales({query:async()=>{throw Error('offline');}});
  r=res();await broken(req,r,()=>assert.fail());assert.equal(r.code,503);
});

test('el permiso de suministros permite consultar boletas pero no registrar entregas',()=>{
  const config={departamento:'OPERACIONES',permisos:{SUMINISTROS:'GESTION'}};
  assert.equal(puedeAcceder(config,'/proveeduria/salidas/2/imprimir','GET'),true);
  assert.equal(puedeAcceder(config,'/proveeduria/salidas/2/enviar','POST'),false);
  assert.equal(puedeAcceder(config,'/proveeduria/salidas/2/imprimir','POST'),false);
});

test('Bodega puede tramitar faltantes y entregar; suministros conserva solo sus propias operaciones',()=>{
  const config={departamento:'TALLER',permisos:{BODEGA:'GESTION'}};
  assert.equal(puedeAcceder(config,'/proveeduria/solicitudes','GET'),true);
  assert.equal(puedeAcceder(config,'/proveeduria/inventario','GET'),true);
  for(const ruta of ['/proveeduria/solicitudes/2/aceptar','/proveeduria/solicitudes/2/rechazar','/proveeduria/inventario/agrupar','/proveeduria/agrupaciones/2/cancelar'])assert.equal(puedeAcceder(config,ruta,'POST'),true);
  assert.equal(puedeAcceder(config,'/proveeduria/solicitudes/2/solicitar-compra','POST'),true);
  assert.equal(puedeAcceder(config,'/proveeduria/salidas/2/imprimir','GET'),true);
  assert.equal(puedeAcceder(config,'/proveeduria/salidas/2/enviar','POST'),true);
  assert.equal(puedeAcceder(config,'/proveeduria/ordenes','POST'),false);
  const consulta={departamento:'TALLER',permisos:{BODEGA:'LECTURA'}};
  assert.equal(puedeAcceder(consulta,'/proveeduria/solicitudes','GET'),true);
  assert.equal(puedeAcceder(consulta,'/proveeduria/solicitudes/2/solicitar-compra','POST'),false);
});
