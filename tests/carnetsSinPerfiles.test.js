const test=require('node:test'),assert=require('node:assert/strict'),ejs=require('ejs'),path=require('node:path');
test('carnets no ofrece copiar perfiles de otras personas y conserva el flujo por cedula',async()=>{
 const html=await ejs.renderFile(path.join(__dirname,'../src/views/carnets_trabajadores.ejs'),{
  mensajeAcceso:'',errorAcceso:'',buscar:'',trabajadores:[],
  perfilesAcceso:[{id:1,nombre:'PERFIL_NO_VISIBLE',usuario:'privado',rol:'ADMIN'}]
 });
 assert.doesNotMatch(html,/usuario_ids|PERFIL_NO_VISIBLE|Crear acceso y carnet|Puede asignar varios perfiles/);
 assert.match(html,/cedula-existente/);assert.match(html,/Crear carnet con acceso existente/);
 assert.match(html,/href="\/admin\/solicitudes-trabajadores"/);
 assert.match(html,/Carnets registrados/);
});
