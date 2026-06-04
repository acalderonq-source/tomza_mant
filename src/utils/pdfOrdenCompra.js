const pdf = require('html-pdf');
const ejs = require('ejs');
const path = require('path');

async function generarPDFOrden(orden, proveedor, lineas) {
  // Datos fijos de la empresa compradora (o puedes obtenerlos de una tabla)
  const empresa = {
    nombre: 'GAS TOMZA DE COSTA RICA S.A.',
    direccion: 'Autopista Florencio del castillo, contiguo a Agrotico, La Lima.',
    telefono: '2201-6000',
    email: 'facelectronica@tomza.com'
  };

  // Ruta a la plantilla EJS que crearás
  const templatePath = path.join(__dirname, '../views/compras/orden_pdf.ejs');

  // Renderizar el HTML a partir de la plantilla con los datos
  const html = await ejs.renderFile(templatePath, { orden, proveedor, lineas, empresa });

  // Generar el PDF
  return new Promise((resolve, reject) => {
    pdf.create(html, { format: 'Letter' }).toBuffer((err, buffer) => {
      if (err) reject(err);
      else resolve(buffer);
    });
  });
}

module.exports = { generarPDFOrden };