const test=require('node:test');
const assert=require('node:assert/strict');
const {filtrosFactura,retornoFacturas}=require('../src/utils/carburacionFiltrosFacturas');
test('los filtros equivalentes a Taller se aplican juntos con parámetros seguros',()=>{
  const f=filtrosFactura({proveedor_id:'2',fecha_desde:'2026-10-01',fecha_hasta:'2026-10-31',pagada:'0',periodo_cierre:'2026-09',vencida:'1',orden:'asc',por_pagina:'50',pagina:'2',origen:'independiente',buscar:'F-1'});
  for(const sql of ['f.proveedor_id=?','f.fecha>=?','f.fecha<=?','f.pagado<f.total','f.periodo_cierre=?','f.vencimiento<?','f.orden_id IS NULL'])assert.ok(f.where.includes(sql));
  assert.deepEqual(f.params.slice(0,4),['2','2026-10-01','2026-10-31','2026-09']);
  assert.equal(f.filtros.orden,'asc');assert.equal(f.filtros.por_pagina,50);assert.equal(f.pagina,2);
});
test('normaliza filtros inválidos y evita retornos fuera de Facturas',()=>{
  const f=filtrosFactura({fecha_desde:'2026-02-30',periodo_cierre:'2026-13',orden:'desc;DROP TABLE',por_pagina:'999',pagina:'-2'});
  assert.equal(f.where,'');assert.equal(f.filtros.orden,'desc');assert.equal(f.filtros.por_pagina,100);assert.equal(f.pagina,1);
  assert.throws(()=>filtrosFactura({fecha_desde:'2026-10-20',fecha_hasta:'2026-10-01'}),/posterior/);
  const retorno='/carburacion/facturas?pagada=0&pagina=2';assert.equal(retornoFacturas(retorno),retorno);
  for(const url of ['https://example.test','//example.test','/compras/facturas','/carburacion/facturas/otro','/carburacion/facturas?x=1\r\n'])assert.equal(retornoFacturas(url),'/carburacion/facturas');
});
