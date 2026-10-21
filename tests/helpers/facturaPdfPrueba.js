const clave='50630092600030401080600100001030000000118106309240';
function pdfPrueba(lineas){
  const stream='BT /F1 10 Tf 40 750 Td 14 TL '+lineas.map(l=>'('+l.replace(/[()\\]/g,'\\$&')+') Tj T*').join(' ')+' ET';
  const objetos=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let texto='%PDF-1.4\n',posiciones=[0];for(const [i,o] of objetos.entries()){posiciones.push(Buffer.byteLength(texto));texto+=`${i+1} 0 obj\n${o}\nendobj\n`;}
  const xref=Buffer.byteLength(texto);texto+='xref\n0 6\n0000000000 65535 f \n'+posiciones.slice(1).map(p=>String(p).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(texto);
}
const lineas=['PABLO CESAR HIDALGO QUIROS','Nota de Credito Electronica No: 00100001030000000118','Clave numerica: '+clave,'Cliente: GAS TOMZA DE COSTA RICA SOCIEDAD ANONIMA','Cedula: 3101349880','Total Comprobante: CRC 100.00','Moneda: CRC'];

module.exports={pdfPrueba,lineas,clave};
