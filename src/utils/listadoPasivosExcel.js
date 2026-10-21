const ExcelJS=require('exceljs');
const {fechas}=require('./pasivosPdf');
function generar(filas,{desde,hasta,fechaEntrega,persona}){
  fechas({desde,hasta});fechas({desde:fechaEntrega,hasta:fechaEntrega});
  if(!String(persona||'').trim()||String(persona).length>120)throw Object.assign(new Error('Indicá la persona responsable (máximo 120 caracteres).'),{status:400});
  if(!filas.length)throw Object.assign(new Error('No hay documentos de los proveedores seleccionados para generar el listado.'),{status:400});
  const validos=filas.filter(r=>Number.isFinite(r.monto)&&Number.isSafeInteger(Math.round(Math.abs(r.monto)*100))&&['CRC','USD'].includes(r.moneda));
  const pendientes=filas.filter(r=>!validos.includes(r));
  const libro=new ExcelJS.Workbook();libro.creator='Gas Tomza';libro.calcProperties.fullCalcOnLoad=true;
  const mes=new Date(hasta+'T12:00:00-06:00').toLocaleDateString('es-CR',{month:'long',year:'numeric',timeZone:'America/Costa_Rica'}).toUpperCase();
  for(const moneda of ['CRC','USD'].filter(m=>validos.some(r=>r.moneda===m))){
    const hoja=libro.addWorksheet('Pasivos '+moneda,{pageSetup:{paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0},views:[{state:'frozen',ySplit:5}]});
    hoja.columns=[{width:23},{width:65},{width:22},{width:40},{width:25}];
    for(const titulo of ['PASIVOS LISTOS','LISTADO DE PROVEEDORES','MES '+mes,`Correos del ${desde} al ${hasta} · Moneda: ${moneda}`]){
      const row=hoja.addRow([titulo]);hoja.mergeCells(row.number,1,row.number,5);row.height=23;row.font={bold:row.number<4,size:row.number===1?16:11,color:{argb:'FF17365D'}};
    }
    hoja.addRow(['FECHA DE ENTREGA','PROVEEDOR','MONTO','# FACTURA','PERSONA']);
    hoja.getRow(5).font={bold:true,color:{argb:'FFFFFFFF'}};hoja.getRow(5).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17365D'}};
    for(const empresa of ['SUPER GAS','GAS TOMZA']){
      const grupo=validos.filter(r=>r.empresa===empresa&&r.moneda===moneda).sort((a,b)=>a.proveedor_nombre.localeCompare(b.proveedor_nombre,'es')||a.numero_factura.localeCompare(b.numero_factura));
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
  if(pendientes.length){
    const hoja=libro.addWorksheet('Por revisar');
    hoja.columns=[{header:'FECHA DE ENTREGA',key:'fecha',width:23},{header:'PROVEEDOR',key:'proveedor',width:65},{header:'MONTO LEÍDO',key:'monto',width:22},{header:'# FACTURA',key:'factura',width:40},{header:'PERSONA',key:'persona',width:30},{header:'MONEDA',key:'moneda',width:15},{header:'MOTIVO · No incluido en totales',key:'motivo',width:65}];
    for(const r of pendientes)hoja.addRow({fecha:fechaEntrega,proveedor:r.proveedor_nombre,monto:Number.isFinite(r.monto)?r.monto:null,factura:r.numero_factura,persona,moneda:r.moneda||'',motivo:'Confirmar monto o moneda en el documento original.'});
    hoja.getRow(1).font={bold:true};hoja.views=[{state:'frozen',ySplit:1}];
  }
  if(filas.advertencias?.length){
    const hoja=libro.addWorksheet('Archivos no incluidos');
    hoja.columns=[{header:'RECEPCIÓN DEL CORREO',key:'fecha',width:25},{header:'ARCHIVO',key:'archivo',width:70},{header:'MOTIVO PARA REVISAR',key:'motivo',width:95}];
    for(const r of filas.advertencias)hoja.addRow({fecha:r.fecha,archivo:r.archivo,motivo:r.motivo});
    hoja.getRow(1).font={bold:true};hoja.views=[{state:'frozen',ySplit:1}];
  }
  return libro;
}
module.exports={generar};
