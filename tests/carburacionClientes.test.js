const test=require('node:test');
const assert=require('node:assert/strict');
const {resolverClientesOrden}=require('../src/utils/carburacionClientes');
const source=require('../src/data/carburacion_clientes.json');
test('conserva los 66 clientes y su fila de origen sin duplicados',()=>{
  assert.equal(source.clientes.length,66);
  assert.equal(new Set(source.clientes.map(c=>c.nombre.toLocaleLowerCase('es-CR'))).size,66);
  assert.equal(source.clientes[0].nombre,'Tike Tibás');
  assert.equal(source.clientes[65].nombre,'Eusse Barranca');
  assert.deepEqual(source.clientes.map(c=>c.fila),Array.from({length:66},(_,i)=>i+2));
});
test('guarda la identidad del cliente y su nombre canónico en orden y líneas',()=>{
  const clientes=[{id:1,nombre:'Tike Tibás'},{id:2,nombre:'Trova Alajuelita'}];
  const datos=resolverClientesOrden({cliente_id:'1',lineas:[{descripcion:'Servicio'},{codigo:'trova alajuelita'}]},clientes);
  assert.equal(datos.cliente_id,1);assert.equal(datos.placa_unidad,'Tike Tibás');
  assert.equal(datos.lineas[0].codigo,'Tike Tibás');assert.equal(datos.lineas[0].cliente_id,1);
  assert.equal(datos.lineas[1].codigo,'Trova Alajuelita');assert.equal(datos.lineas[1].cliente_id,2);
  assert.throws(()=>resolverClientesOrden({cliente_id:'999'},clientes),/catálogo/);
  assert.throws(()=>resolverClientesOrden({lineas:[{codigo:'Cliente ajeno'}]},clientes),/catálogo/);
});
