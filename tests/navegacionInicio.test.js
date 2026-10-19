const {test}=require('node:test');
const assert=require('node:assert/strict');
const {agregarNavegacionInicio}=require('../src/utils/navegacionInicio');
test('Ir a inicio se agrega solo a sesiones internas normales, sin duplicar assets',()=>{
  const html='<html><head></head><body><a href="/logout">Salir</a></body></html>';
  for(const user of [null,undefined,{rol:'PANTALLA_MECANICOS'},{rol:'PANTALLA_PESADOS'}])assert.equal(agregarNavegacionInicio(html,user),html);
  for(const rol of ['ADMIN','TALLER','CONTABILIDAD','PROVEEDURIA','MECANICO','CARBURACION_GESTOR']){
    const result=agregarNavegacionInicio(html,{rol});
    assert.ok(result.includes('/js/ir-inicio.js'));
    assert.ok(result.includes('/css/ir-inicio.css'));
    assert.equal(agregarNavegacionInicio(result,{rol}),result);
  }
});
