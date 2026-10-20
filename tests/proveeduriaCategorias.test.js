const test=require('node:test');
const assert=require('node:assert/strict');
const {categoriaArticulo,agruparArticulos}=require('../src/utils/proveeduriaCategorias');
const {articulosSolicitud}=require('../src/utils/proveeduriaSolicitable');

test('categorías existentes prevalecen y el catálogo separado recibe categorías sin cambiar sus códigos',()=>{
  assert.equal(categoriaArticulo({descripcion:'Pintura',categoria:'Ventas'}),'Ventas');
  assert.equal(categoriaArticulo({descripcion:'Adaptador',categoria:'TI'}),'Tecnología');
  for(const [descripcion,categoria] of [['Guantes para lavar','Limpieza'],['Guantes nitrilo','Equipo de protección personal'],['3M - 501 Retenedor','Equipo de protección personal'],['Spay Azul','Técnicos'],['Calca TOMZA','Técnicos'],['Café','Cafetería'],['Camisa polo','Uniformes'],['Gasa estéril','Salud y primeros auxilios']])assert.equal(categoriaArticulo({descripcion}),categoria,descripcion);
  assert.equal(articulosSolicitud.length,238);
  assert.ok(articulosSolicitud.every(a=>a.categoria&&a.codigo.startsWith('SOL-')&&a.inventariable===false));
  assert.deepEqual(agruparArticulos([{descripcion:'Café',cantidad:1},{descripcion:'Papel',categoria:'Oficina',cantidad:2},{descripcion:'Azúcar',cantidad:3}]).map(([c,ls])=>[c,ls.length]),[['Cafetería',2],['Oficina',1]]);
});
