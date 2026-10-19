const {test}=require('node:test');
const assert=require('node:assert/strict');
const bcrypt=require('bcryptjs');
const {departamentosInicialesPorRol,departamentosPermitidosPorRol,puedeAbrirRutaPorDepartamento}=require('../src/utils/departamentos');
const {crearPerfil}=require('../src/scripts/crearPerfilSeguridadOcupacional');
test('Perfil Seguridad Ocupacional tiene solo su departamento y bloquea enlaces directos ajenos',()=>{
  assert.deepEqual(departamentosInicialesPorRol('SEGURIDAD_OCUP'),['SEGURIDAD_OCUPACIONAL']);
  assert.deepEqual(departamentosPermitidosPorRol('SEGURIDAD_OCUP',['TALLER','SEGURIDAD_OCUPACIONAL','ADMINISTRACION']),['SEGURIDAD_OCUPACIONAL']);
  for(const ruta of ['/inicio','/dashboard','/seguridad-ocupacional','/seguridad-ocupacional/futuro','/cambiar-clave'])assert.equal(puedeAbrirRutaPorDepartamento('SEGURIDAD_OCUPACIONAL',ruta,'SEGURIDAD_OCUP'),true);
  for(const ruta of ['/administracion','/admin/ingresos','/compras','/taller','/carburacion','/control-empresa','/contabilidad/planilla'])assert.equal(puedeAbrirRutaPorDepartamento('SEGURIDAD_OCUPACIONAL',ruta,'SEGURIDAD_OCUP'),false);
});
test('Alta genera clave temporal cifrada, exige cambio y no modifica perfiles existentes',async()=>{
  let created,committed=false,rolled=false;
  const connection={beginTransaction:async()=>{},query:async(sql,args)=>{
    if(sql.startsWith('SELECT'))return [[]];
    if(sql.includes('INSERT INTO usuarios')){created=args;return [{insertId:400}];}
    assert.deepEqual(args,[400,'SEGURIDAD_OCUPACIONAL']);return [{affectedRows:1}];
  },commit:async()=>{committed=true;},rollback:async()=>{rolled=true;},release:()=>{}};
  const result=await crearPerfil({getConnection:async()=>connection});
  assert.equal(committed,true);assert.equal(rolled,false);assert.equal(created[3],'SEGURIDAD_OCUP');
  assert.equal(await bcrypt.compare(result.temporal,created[2]),true);
  connection.query=async()=>[[{id:400,rol:'SEGURIDAD_OCUP'}]];
  await assert.rejects(crearPerfil({getConnection:async()=>connection}),{code:'PERFIL_EXISTENTE'});
  assert.equal(rolled,true);
});
