const ExcelJS=require('exceljs');
const {fechas}=require('./pasivosPdf');
function generar(filas,{desde,hasta,fechaEntrega,persona}){
  fechas({desde,hasta});fechas({desde:fechaEntrega,hasta:fechaEntrega});
  if(!String(persona||'').trim()||String(persona).length>120)throw Object.assign(new Error('Indicá la persona responsable (máximo 120 caracteres).'),{status:400});
  if(!filas.length)throw Object.assign(new Error('No hay documentos de los proveedores seleccionados para generar el listado.'),{status:400});
  if(filas.some(r=>!Number.isFinite(r.monto)||!Number.isSafeInteger(Math.round(Math.abs(r.monto)*100))||!['CRC','USD'].includes(r.moneda)))throw Object.assign(new Error('Hay documentos sin monto o moneda válidos en el XML. Revisalos antes de generar los totales.'),{status:400});
  const libro=new ExcelJS.Workbook();libro.creator='Gas Tomza';libro.calcProperties.fullCalcOnLoad=true;
  const mes=new Date(hasta+'T12:00:00-06:00').toLocaleDateString('es-CR',{month:'long',year:'numeric',timeZone:'America/Costa_Rica'}).toUpperCase();
  for(const moneda of ['CRC','USD'].filter(m=>filas.some(r=>r.moneda===m))){
    const hoja=libro.addWorksheet('Pasivos '+moneda,{pageSetup:{paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0},views:[{state:'frozen',ySplit:5}]});
    hoja.columns=[{width:23},{width:65},{width:22},{width:40},{width:25}];
    for(const titulo of ['PASIVOS LISTOS','LISTADO DE PROVEEDORES','MES '+mes,`Correos del ${desde} al ${hasta} · Moneda: ${moneda}`]){
      const row=hoja.addRow([titulo]);hoja.mergeCells(row.number,1,row.number,5);row.height=23;row.font={bold:row.number<4,size:row.number===1?16:11,color:{argb:'FF17365D'}};
    }
    hoja.addRow(['FECHA DE ENTREGA','PROVEEDOR','MONTO','# FACTURA','PERSONA']);
    hoja.getRow(5).font={bold:true,color:{argb:'FFFFFFFF'}};hoja.getRow(5).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17365D'}};
    for(const empresa of ['SUPER GAS','GAS TOMZA']){
      const grupo=filas.filter(r=>r.empresa===empresa&&r.moneda===moneda).sort((a,b)=>a.proveedor_nombre.localeCompare(b.proveedor_nombre,'es')||a.numero_factura.localeCompare(b.numero_factura));
      if(!grupo.length)continue;
      const inicio=hoja.rowCount+1;let centavos=0;
      for(const r of grupo){
        const cents=Math.round(Math.abs(r.monto)*100)*Math.sign(r.monto);centavos+=cents;
        const factura=r.tipoDocumento==='nota_credito'?`NC ${r.numero_factura}${r.referenciaFactura?' AP FACT '+r.referenciaFactura:''}`:r.numero_factura;
        const row=hoja.addRow([new Date(fechaEntrega+'T12:00:00Z'),r.proveedor_nombre,cents/100,String(factura),String(persona).trim()]);
        row.getCell(1).numFmt='dd/mm/yyyy';row.getCell(3).numFmt='#,##0.00;[Red]-#,##0.00';row.getCell(4).numFmt='@';
      }
      const fin=hoja.rowCount,total=hoja.addRow(['','TOTAL '+empresa,{formula:`SUM(C${inicio}:C${fin})`,result:centavos/100}]);
      total.font={bold:true};total.getCell(3).numFmt='#,##0.00;[Red]-#,##0.00';total.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDCE6F1'}};hoja.addRow([]);
    }
    hoja.getColumn(3).alignment={horizontal:'right'};hoja.pageSetup.printTitlesRow='1:5';
  }
  return libro;
}
module.exports={generar};
