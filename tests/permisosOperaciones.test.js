const test=require('node:test');
const assert=require('node:assert/strict');
const {MODULOS,validarAcceso,puedeAcceder}=require('../src/utils/accesosTrabajador');
const {separarPermisos}=require('../src/utils/permisosOperaciones');
const {configDepartamento}=require('../src/utils/permisosPorDepartamento');

test('los tres módulos se asignan individualmente sin heredar permisos al guardar',()=>{
  assert.deepEqual(MODULOS.filter(m=>['OPERACIONES','REPORTES_TALLER','SUMINISTROS'].includes(m.id)).map(m=>m.nombre),['Operaciones','Reportes a Taller','Solicitud de suministros']);
  const rutas={OPERACIONES:['/revision-ruta','GET'],REPORTES_TALLER:['/reportes-supervisores','POST'],SUMINISTROS:['/proveeduria/solicitudes','POST']};
  for(const departamento of ['OPERACIONES','TALLER'])for(const modulo of Object.keys(rutas)){
    const config=validarAcceso({departamento,sede_asignada:'Cartago',[`permiso_${modulo}`]:'GESTION'});
    assert.equal(config.permisosOperacionesSeparados,true);
    for(const [id,[ruta,metodo]] of Object.entries(rutas))assert.equal(puedeAcceder(config,ruta,metodo),id===modulo,`${departamento}: ${modulo} -> ${id}`);
  }
  const combinado=validarAcceso({departamento:'OPERACIONES',sede_asignada:'Cartago',permiso_OPERACIONES:'GESTION',permiso_REPORTES_TALLER:'LECTURA',permiso_SUMINISTROS:'NINGUNO'});
  assert.equal(puedeAcceder(combinado,'/reportes-supervisores','GET'),true);
  assert.equal(puedeAcceder(combinado,'/reportes-supervisores','POST'),false);
  assert.equal(puedeAcceder(combinado,'/proveeduria/mis-solicitudes','GET'),false);
  assert.equal(puedeAcceder(combinado,'/proveeduria/salidas/3/aceptar','POST'),false);
  const suministros=validarAcceso({departamento:'OPERACIONES',sede_asignada:'Cartago',permiso_SUMINISTROS:'LECTURA'});
  assert.equal(puedeAcceder(suministros,'/proveeduria/mis-solicitudes','GET'),true);
  assert.equal(puedeAcceder(suministros,'/proveeduria/solicitudes','POST'),false);
  for(const ruta of ['/proveeduria/ordenes','/proveeduria/inventario','/proveeduria/solicitudes','/proveeduria/salidas'])assert.equal(puedeAcceder(suministros,ruta,'GET'),false);
});

test('perfiles anteriores muestran controles separados con su alcance anterior y luego permiten revocar cada uno',()=>{
  const original={departamento:'OPERACIONES',sede:'Cartago',permisos:{OPERACIONES:'GESTION'}};
  const copia=JSON.stringify(original),config=separarPermisos(original);
  assert.equal(JSON.stringify(original),copia);
  assert.deepEqual(config.permisos,{OPERACIONES:'GESTION',REPORTES_TALLER:'GESTION',SUMINISTROS:'GESTION'});
  assert.equal(separarPermisos(config),config);
  const adicional=configDepartamento({departamento:'PROVEEDURIA',sede:'TODAS',permisos:{},adicionales:{OPERACIONES:original}},'OPERACIONES');
  assert.equal(adicional.permisos.REPORTES_TALLER,'GESTION');
  const taller=separarPermisos({...original,departamento:'TALLER'});
  assert.equal(taller.permisos.SUMINISTROS,undefined,'no ampliar los suministros de perfiles de Taller anteriores');
  const guardado=validarAcceso({departamento:'OPERACIONES',sede_asignada:'Cartago',permiso_OPERACIONES:'GESTION',permiso_REPORTES_TALLER:'NINGUNO',permiso_SUMINISTROS:'NINGUNO'});
  const recargado=configDepartamento(JSON.parse(JSON.stringify(guardado)),'OPERACIONES');
  assert.equal(recargado.permisos.REPORTES_TALLER,undefined);
  assert.equal(puedeAcceder(recargado,'/reportes-supervisores','GET'),false);
  assert.equal(puedeAcceder(recargado,'/proveeduria/mis-solicitudes','GET'),false);
});
