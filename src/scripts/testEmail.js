const path = require('path');
const dotenv = require('dotenv');

// Forzar ruta absoluta al .env en la raíz del proyecto
const envPath = path.resolve('C:/Users/asist/tomza_mant/.env');
console.log('Intentando cargar .env desde:', envPath);
const result = dotenv.config({ path: envPath });
if (result.error) {
  console.error('Error cargando .env:', result.error);
} else {
  console.log('.env cargado correctamente');
}

console.log('SENDGRID_API_KEY:', process.env.SENDGRID_API_KEY ? '✅ Cargada (primeros 5: ' + process.env.SENDGRID_API_KEY.substring(0,5) + '...)' : '❌ No cargada');

const { enviarCorreo } = require('../utils/emailService');

async function test() {
  const exito = await enviarCorreo('dmartinez.s@tomza.com', 'Prueba', '<b>Test</b>');
  console.log(exito ? '✅ Enviado' : '❌ Falló');
}
test();