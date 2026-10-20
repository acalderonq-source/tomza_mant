const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {agregarMarcaTomza}=require('../src/utils/marcaTomza');
test('marca global incluye PNG sin sustituir el texto del titulo ni los datos',()=>{
  const html='<html><head><title>Gas Tomza | Compras</title></head><body><h1>Gas Tomza</h1><input value="GAS TOMZA"></body></html>';
  const result=agregarMarcaTomza(html);
  assert.match(result,/image\/png/);assert.match(result,/\/img\/logo_tomza.png/);
  assert.match(result,/<title>Gas Tomza \| Compras<\/title>/);assert.match(result,/value="GAS TOMZA"/);
  assert.equal(agregarMarcaTomza(result),result);assert.equal(agregarMarcaTomza(null),null);
  const logo=fs.readFileSync(path.join(__dirname,'../public/img/logo_tomza.png'));
  assert.deepEqual([...logo.subarray(0,8)],[137,80,78,71,13,10,26,10]);
});
