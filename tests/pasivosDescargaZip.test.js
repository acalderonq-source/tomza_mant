const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Writable}=require('node:stream');
const {once}=require('node:events');
const JSZip=require('jszip');
test('ZIP entrega originales PDF y XML con el mismo nombre e incluye XML sin PDF',async()=>{
  const servicio=require('../src/utils/pasivosPdfOutlook');
  const original=servicio.cargar;
  const xml=Buffer.from('<FacturaElectronica>original</FacturaElectronica>');
  servicio.cargar=async()=>[
    {proveedor_nombre:'Proveedor',numero_factura:'001',disponible:true,xmlBuffer:xml,respuestasHacienda:[{buffer:Buffer.from('<MensajeHacienda>original</MensajeHacienda>')}],obtenerContenido:async()=>Buffer.from('%PDF-1.7 original')},
    {proveedor_nombre:'Proveedor',numero_factura:'002',disponible:false,xmlBuffer:xml},
    {proveedor_nombre:'Proveedor',numero_factura:'003',disponible:true,obtenerContenido:async()=>Buffer.from('%PDF-1.7 solo PDF')}
  ];
  try{
    const router=require('../src/routes/contabilidadDocumentos.routes');
    const handler=router.stack.find(l=>l.route?.path==='/descargas-pdf').route.stack[0].handle;
    const chunks=[];
    const res=new Writable({write(chunk,encoding,callback){chunks.push(chunk);callback();}});
    res.type=()=>res;res.attachment=()=>res;res.render=()=>assert.fail('Debe descargar el ZIP');
    const terminado=once(res,'finish');
    await handler({query:{desde:'2026-10-17',hasta:'2026-10-20',descargar:'1'}},res,e=>{throw e;});
    await terminado;
    const zip=await JSZip.loadAsync(Buffer.concat(chunks));
    assert.deepEqual(Object.keys(zip.files).sort(),['Proveedor_001.pdf','Proveedor_001.xml','Proveedor_001_Hacienda.xml','Proveedor_002.xml','Proveedor_003.pdf']);
    assert.equal(await zip.file('Proveedor_001_Hacienda.xml').async('string'),'<MensajeHacienda>original</MensajeHacienda>');
    assert.ok((await zip.file('Proveedor_001.xml').async('nodebuffer')).equals(xml));
  }finally{servicio.cargar=original;}
});
