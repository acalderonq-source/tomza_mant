const test=require('node:test');const assert=require('node:assert/strict');const pool=require('../src/db');
const {leerArchivo,guardarIncidencia,MAX_ARCHIVO}=require('../src/utils/carburacionExpediente');
const {guardarRegistro}=require('../src/utils/carburacionEstacionesStore');
const pdf=()=>`data:application/pdf;base64,${Buffer.from('%PDF-1.4\nDocumento de prueba').toString('base64')}`;
test('expediente comprueba formato real, tamaño y nombre de archivos',()=>{
 assert.equal(leerArchivo(pdf(),'documento.pdf').mime,'application/pdf');
 assert.equal(leerArchivo(pdf(),'C:\\carpeta\\documento.pdf').nombre,'documento.pdf');
 assert.equal(leerArchivo(null),null);
 for(const [data,name] of [['data:application/pdf;base64,YWJj','falso.pdf'],['data:image/svg+xml;base64,PHN2Zz4=','x.svg'],[pdf(),''],['data:application/pdf;base64,'+Buffer.alloc(MAX_ARCHIVO+1).toString('base64'),'grande.pdf']])assert.throws(()=>leerArchivo(data,name),e=>e.status===400);
});
test('incidencias valida datos y no permite estados heredados del prototipo',async()=>{
 for(const body of [{},{titulo:'Incidencia',descripcion:'Detalle',fecha:'2026-02-30',estado:'ABIERTA'},{titulo:'Incidencia',descripcion:'Detalle',fecha:'2026-10-19',estado:'toString'}])await assert.rejects(guardarIncidencia(1,body,{id:34}),e=>e.status===400);
});
test('estaciones rechaza escritura libre y usa el nombre del cliente seleccionado',async()=>{
 const original=pool.getConnection;let insert;
 pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql,args)=>{
  if(sql.startsWith('SELECT id,nombre FROM carburacion_clientes'))return [[{id:3,nombre:'Estación del catálogo'}]];
  if(sql.includes('INSERT INTO carburacion_estaciones_registros'))insert=args;
  return [{insertId:7}];
 }});
 try{
  const body={categoria:'seguimiento',estacion:'No usar texto libre',estado:'PENDIENTE',prioridad:'MEDIA'};
  await assert.rejects(guardarRegistro(null,body,{id:34}),/Seleccione una estación/);
  await guardarRegistro(null,{...body,cliente_id:'3'},{id:34});assert.equal(insert[1],'Estación del catálogo');assert.equal(insert[2],3);
  await assert.rejects(guardarRegistro(null,{...body,cliente_id:'3',categoria:'mejoras'},{id:34}),e=>e.status===404);
 }finally{pool.getConnection=original;}
});
