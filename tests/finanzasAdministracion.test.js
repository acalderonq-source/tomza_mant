const {test}=require('node:test');
const assert=require('node:assert/strict');
const ejs=require('ejs'),path=require('node:path');
const guard=require('../src/middleware/finanzasAdministracion');
test('solo ADMIN accede a controles financieros privados',()=>{
  for(const rol of ['CONTABILIDAD','TALLER','PROVEEDURIA']){
    let estado;guard({session:{user:{rol}}},{status(c){estado=c;return this;},send(){}},()=>assert.fail('No debe permitir acceso'));
    assert.equal(estado,403);
  }
  let permitido=false;guard({session:{user:{rol:'ADMIN'}}},{},()=>permitido=true);assert.ok(permitido);
});
test('Contabilidad no muestra módulos privados ni siquiera al administrador',async()=>{
  for(const rol of ['ADMIN','CONTABILIDAD'])for(const vista of ['contabilidad_inicio','contabilidad_navegacion']){
    const html=await ejs.renderFile(path.resolve('src/views/partials/'+vista+'.ejs'),{user:{rol}});
    assert.doesNotMatch(html,/href="\/contabilidad\/planilla|href="\/contabilidad\/presupuestos\/modulos|Operación y gastos|Capital y obligaciones/);
  }
});
test('Administración presenta Planilla y los nueve controles únicamente a ADMIN',async()=>{
  const render=rol=>ejs.renderFile(path.resolve('src/views/partials/administracion_finanzas.ejs'),{user:{rol}});
  const html=await render('ADMIN');assert.match(html,/Planilla/);assert.match(html,/Operación y gastos/);assert.match(html,/Capital y obligaciones/);
  assert.equal((html.match(/presupuestos\/modulos\//g)||[]).length,9);
  assert.equal((await render('CONTABILIDAD')).trim(),'');
});
