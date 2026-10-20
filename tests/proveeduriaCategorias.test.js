const test=require('node:test');
const assert=require('node:assert/strict');
const {CATEGORIAS_SOLICITUD,categoriaArticulo,agruparArticulos}=require('../src/utils/proveeduriaCategorias');
const {articulosSolicitud}=require('../src/utils/proveeduriaSolicitable');

test('solicitudes usan exactamente las nueve categorías indicadas sin cambiar códigos ni crear inventario',()=>{
  assert.deepEqual(CATEGORIAS_SOLICITUD,['Limpieza','Oficina','Operaciones','Otros','Papelería','Salud ocupacional','Servicios ambientales','Técnicos','Uniformes']);
  assert.equal(categoriaArticulo({descripcion:'Pintura',categoria:'Ventas'}),'Operaciones');
  assert.equal(categoriaArticulo({descripcion:'Adaptador',categoria:'TI'}),'Oficina');
  for(const [descripcion,categoria] of [['Guantes para lavar','Limpieza'],['Guantes nitrilo','Salud ocupacional'],['3M - 501 Retenedor','Salud ocupacional'],['Spay Azul','Técnicos'],['Calca TOMZA','Técnicos'],['Café','Otros'],['Camisa polo','Uniformes'],['Gasa estéril','Salud ocupacional'],['Servicio de recolección de residuos','Servicios ambientales'],['Recarga de extintores','Salud ocupacional'],['Resmas de papel','Papelería'],['Computadora sin clasificar','Otros']])assert.equal(categoriaArticulo({descripcion}),categoria,descripcion);
  assert.equal(articulosSolicitud.length,238);
  assert.ok(articulosSolicitud.every(a=>CATEGORIAS_SOLICITUD.includes(a.categoria)&&a.codigo.startsWith('SOL-')&&a.inventariable===false));
  assert.deepEqual(agruparArticulos([{descripcion:'Café',cantidad:1},{descripcion:'Papel',categoria:'Oficina',cantidad:2},{descripcion:'Azúcar',cantidad:3}]).map(([c,ls])=>[c,ls.length]),[['Otros',2],['Papelería',1]]);
});

test('categorías históricas y desconocidas se normalizan sin ofrecer categorías nuevas',()=>{
  for(const categoria of CATEGORIAS_SOLICITUD)assert.equal(categoriaArticulo({categoria,descripcion:'Artículo'}),categoria);
  assert.equal(categoriaArticulo({categoria:'OFICINA',descripcion:'Lapicero azul'}),'Papelería');
  assert.equal(categoriaArticulo({categoria:'Otra categoría libre',descripcion:'Guantes nitrilo'}),'Salud ocupacional');
  assert.equal(categoriaArticulo({categoria:'Otra categoría libre',descripcion:'Artículo sin clasificar'}),'Otros');
  assert.equal(categoriaArticulo({categoria:'Servicios',descripcion:'Servicios ambientales peligrosos'}),'Servicios ambientales');
  for(const categoria of ['Equipo de protección personal','Salud y primeros auxilios','Tecnología','Cafetería','Cilindros y tanques','Sellos y empaques','Otros suministros','__proto__'])assert.ok(CATEGORIAS_SOLICITUD.includes(categoriaArticulo({categoria,descripcion:'Artículo'})));
});
