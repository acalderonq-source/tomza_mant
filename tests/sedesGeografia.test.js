const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('Geografia local contiene siete provincias reales de Costa Rica',()=>{
  const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/mapa-sedes/costa-rica-provincias.geojson'),'utf8'));
  assert.equal(data.type,'FeatureCollection');assert.equal(data.features.length,7);
  assert.equal(new Set(data.features.map(f=>f.properties.shapeISO)).size,7);
  for(const f of data.features){assert.equal(f.properties.shapeGroup,'CRI');assert.ok(['Polygon','MultiPolygon'].includes(f.geometry.type));assert.ok(f.geometry.coordinates.length);}
});
