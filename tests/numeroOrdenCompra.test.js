const test=require('node:test');const assert=require('node:assert/strict');
const {bloquearNumeroOrden}=require('../src/utils/numeroOrdenCompra');
test('bloqueo se adquiere en la misma conexion y se libera solo una vez',async()=>{
 const llamadas=[];const db={async query(sql,p){llamadas.push({sql,p});return [[{adquirido:1}]];}};
 const liberar=await bloquearNumeroOrden(db);await liberar();await liberar();
 assert.equal(llamadas.length,2);assert.match(llamadas[0].sql,/GET_LOCK/);assert.match(llamadas[1].sql,/RELEASE_LOCK/);assert.deepEqual(llamadas[0].p,llamadas[1].p);
});
test('timeout del bloqueo rechaza sin guardar ni dejar una peticion esperando indefinidamente',async()=>{
 await assert.rejects(bloquearNumeroOrden({async query(){return [[{adquirido:0}]];}}),e=>e.status===503);
});
test('conexion con error de liberacion se destruye para no devolver bloqueo al pool',async()=>{
 let destruida=false;const db={destroy(){destruida=true;},async query(sql){if(sql.includes('RELEASE'))throw Error('red');return [[{adquirido:1}]];}};
 const liberar=await bloquearNumeroOrden(db);await liberar();assert.equal(destruida,true);
});
