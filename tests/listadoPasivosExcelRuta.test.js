const {test}=require('node:test'),assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
test('botón listado descarga Excel y aprovecha XML sin descargar PDF',async()=>{
  const servicio=require('../src/utils/pasivosPdfOutlook'),original=servicio.cargar;
  servicio.cargar=async(_db,f)=>{
    assert.equal(f.incluirNotas,true);
    return [{empresa:'GAS TOMZA',proveedor_nombre:'Proveedor',numero_factura:'00000000000000000001',monto:2538.71,moneda:'CRC',disponible:true,obtenerContenido:()=>assert.fail('No necesita PDF')}];
  };
  try{
    const router=require('../src/routes/contabilidadDocumentos.routes');
    const handler=router.stack.find(l=>l.route?.path==='/descargas-pdf').route.stack[0].handle;
    let buffer,nombre;
    const res={type(v){assert.match(v,/spreadsheetml/);return this;},attachment(v){nombre=v;return this;},send(v){buffer=v;},render(){assert.fail('Debe descargar Excel');}};
    await handler({query:{desde:'2026-10-17',hasta:'2026-10-21',fecha_entrega:'2026-10-21',persona:'Alex',listado:'1'},session:{user:{usuario:'contabilidad'}}},res,e=>{throw e;});
    assert.match(nombre,/Pasivos_listos_.*\.xlsx$/);assert.ok(Buffer.isBuffer(buffer));
    const libro=new ExcelJS.Workbook();await libro.xlsx.load(buffer);
    assert.equal(libro.getWorksheet('Pasivos CRC').getCell('D6').value,'00000000000000000001');
    assert.equal(libro.getWorksheet('Pasivos CRC').getCell('E6').value,'Alex');
  }finally{servicio.cargar=original;}
});
