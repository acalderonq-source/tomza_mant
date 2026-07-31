const PdfPrinter = require('pdfmake');

// Definir fuentes (pdfmake requiere .ttf)
const fonts = {
  Roboto: {
    normal: 'node_modules/pdfmake/fonts/Roboto-Regular.ttf',
    bold: 'node_modules/pdfmake/fonts/Roboto-Medium.ttf',
    italics: 'node_modules/pdfmake/fonts/Roboto-Italic.ttf',
    bolditalics: 'node_modules/pdfmake/fonts/Roboto-MediumItalic.ttf'
  }
};

const printer = new PdfPrinter(fonts);

function generarPDFOrden(orden, lineas, proveedor) {
  const docDefinition = {
    content: [
      { text: 'ORDEN DE COMPRA', style: 'header', alignment: 'center' },
      { text: `N° PO: ${orden.po_numero}`, margin: [0, 20, 0, 5] },
      { text: `Fecha: ${orden.fecha}`, margin: [0, 0, 0, 5] },
      { text: `Proveedor: ${proveedor.nombre}`, margin: [0, 0, 0, 5] },
      { text: `Dirección: ${proveedor.direccion || '-'}`, margin: [0, 0, 0, 5] },
      { text: `Forma de pago: ${orden.forma_pago || '-'}`, margin: [0, 0, 0, 10] },
      {
        table: {
          headerRows: 1,
          widths: ['auto', '*', 'auto', 'auto', 'auto'],
          body: [
            ['Código', 'Descripción', 'Cantidad', 'Precio', 'Subtotal'],
            ...lineas.map(l => [l.codigo || '-', l.descripcion, l.cantidad, l.precio_unitario, l.subtotal])
          ]
        }
      },
      { text: `Subtotal: ${orden.subtotal}`, alignment: 'right', margin: [0, 10, 0, 0] },
      { text: `Descuento: ${orden.descuento}`, alignment: 'right' },
      { text: `Transporte: ${orden.transporte}`, alignment: 'right' },
      { text: `IVA (${orden.iva}%): ${(orden.total - (orden.subtotal - orden.descuento + orden.transporte)).toFixed(2)}`, alignment: 'right' },
      { text: `TOTAL: ${orden.total}`, style: 'total', alignment: 'right' },
      { text: `Observaciones: ${orden.observaciones || '-'}`, margin: [0, 20, 0, 0] }
    ],
    styles: {
      header: { fontSize: 18, bold: true },
      total: { fontSize: 14, bold: true, color: 'red' }
    }
  };
  const pdfDoc = printer.createPdfKitDocument(docDefinition);
  return pdfDoc;
}

module.exports = { generarPDFOrden };
