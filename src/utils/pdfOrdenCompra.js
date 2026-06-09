const puppeteer = require('puppeteer');
const ejs = require('ejs');
const path = require('path');

async function generarPDFOrden(orden, proveedor, lineas) {
  // Datos de la empresa según el destino
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

  // Ruta a la plantilla EJS
  const templatePath = path.join(__dirname, '../views/compras/orden_pdf.ejs');
  const html = await ejs.renderFile(templatePath, { orden, proveedor, lineas, empresa });

  // Lanzar Puppeteer (con opciones necesarias para entornos como Render)
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' }); // Espera a que cargue la imagen
  const pdfBuffer = await page.pdf({ format: 'Letter', printBackground: true });
  await browser.close();
  return pdfBuffer;
}

module.exports = { generarPDFOrden };