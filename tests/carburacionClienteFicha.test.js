const test=require('node:test');const assert=require('node:assert/strict');
const pool=require('../src/db');
const {validarFicha,puedeEditarClientes}=require('../src/utils/carburacionClienteFicha');
test('ficha permite información pendiente y normaliza los datos de notificación',()=>{
  const ficha=validarFicha({nombre:' Gasolinera ',correo_notificacion:'Contacto@Ejemplo.com',telefono_notificacion:'+506 2294-7000',cedula_juridica:'3-101-895580',ignorado:'no guardar'});
  assert.equal(ficha.nombre,'Gasolinera');assert.equal(ficha.correo_notificacion,'contacto@ejemplo.com');assert.equal(ficha.razon_social,null);assert.equal(ficha.ignorado,undefined);
});
test('ficha rechaza datos inválidos',()=>{
  for(const body of [{nombre:''},{nombre:'X',correo_notificacion:'incorrecto'},{nombre:'X',cedula_juridica:'abc'},{nombre:'X',telefono_notificacion:'correo'},{nombre:['X']}])assert.throws(()=>validarFicha(body),e=>e.status===400);
});
test('edición exige Carburación activa y autorización individual de Emily',async()=>{
  const original=pool.query;pool.query=async(_sql,args)=>[args[0]===34?[{usuario_id:34}]:[]];
  try {
    const user={id:34,rol:'PROVEEDURIA_TALLER',departamentoActivo:'CARBURACION',departamentos:['CARBURACION','TALLER']};
    assert.equal(await puedeEditarClientes(user),true);
    assert.equal(await puedeEditarClientes({...user,id:2}),false);
    assert.equal(await puedeEditarClientes({...user,departamentoActivo:'TALLER'}),false);
    assert.equal(await puedeEditarClientes({...user,departamentos:['TALLER']}),false);
    assert.equal(await puedeEditarClientes({...user,id:1,rol:'ADMIN'}),true);
  }finally{pool.query=original;}
});
