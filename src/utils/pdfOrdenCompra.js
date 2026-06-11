const pdf = require('html-pdf');
const ejs = require('ejs');
const path = require('path');

async function generarPDFOrden(orden, proveedor, lineas) {
  let empresa = {};
  if (orden.empresa_destino === 'SUPER GAS') {
    empresa = {
      nombre: 'ENVASADORA SUPER GAS GLP SOCIEDAD ANÓNIMA',
      nombreEmpresa: 'ENVASADORA SUPER GAS GLP S.A.',
      direccion: 'Alajuela, San Antonio, Tejar',
      telefono: '2434-1038',
      email: 'supergasfe@tomza.com',
      cedula: '3-101-044021'
    };
  } else {
    empresa = {
      nombre: 'GAS TOMZA DE COSTA RICA S.A.',
      nombreEmpresa: 'GAS TOMZA DE COSTA RICA S.A.',
      direccion: 'Autopista Florencio del castillo, contiguo a Agrotico, La Lima.',
      telefono: '2201-6000',
      email: 'facelectronica@tomza.com'
    };
  }

  const templatePath = path.join(__dirname, '../views/compras/orden_pdf.ejs');
  const html = await ejs.renderFile(templatePath, { orden, proveedor, lineas, empresa });

  return new Promise((resolve, reject) => {
    pdf.create(html, { format: 'Letter' }).toBuffer((err, buffer) => {
      if (err) reject(err);
      else resolve(buffer);
    });
  });
}

module.exports = { generarPDFOrden };