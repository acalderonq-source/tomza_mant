const test=require('node:test'),assert=require('node:assert/strict');
const {actualizarNotasAPI}=require('../src/utils/portalNotasCorreo');
test('actualización automática de notas conserva pagos y no aplica créditos',async()=>{
  let datos={factura:{estado:'CONCILIADA'},pagos:[{monto:20}],notas_credito:[{clave:'nota',total:10,aplicada:false,hacienda:{estado:'PENDIENTE'}}]},writes=0;
  const pool={query:async()=>[[{id:5,datos:structuredClone(datos)}]],getConnection:async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql,args)=>{
    if(sql.startsWith('SELECT'))return [[{datos:structuredClone(datos)}]];
    if(sql.startsWith('UPDATE')){writes++;datos=JSON.parse(args[0]);}return [{affectedRows:1}];
  }})};
  await actualizarNotasAPI(pool,async()=>({estado:'ACEPTADA',ambiente:'produccion'}));
  assert.equal(writes,1);assert.equal(datos.notas_credito[0].hacienda.estado,'ACEPTADA');assert.equal(datos.notas_credito[0].aplicada,false);assert.equal(datos.pagos[0].monto,20);assert.equal(datos.factura.estado,'CONCILIADA');
  datos.notas_credito[0].hacienda={estado:'PENDIENTE'};
  await actualizarNotasAPI(pool,async()=>{datos.notas_credito[0].hacienda={estado:'ACEPTADA',fuente:'CORREO_XML_FIRMADO'};return {estado:'PENDIENTE'};});
  assert.equal(writes,1);assert.equal(datos.notas_credito[0].hacienda.fuente,'CORREO_XML_FIRMADO');
});
