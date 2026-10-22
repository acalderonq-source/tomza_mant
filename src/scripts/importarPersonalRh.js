// Carga el personal de Gas Tomza desde un Excel a Recursos Humanos.
// Uso: node src/scripts/importarPersonalRh.js "ruta/al/archivo.xlsx" [--desactivar-ausentes]
require('dotenv').config();
const fs = require('node:fs');
const pool = require('../db');
const personal = require('../utils/personalRh');

(async () => {
  const archivo = process.argv[2];
  if (!archivo || !fs.existsSync(archivo)) throw new Error('Indique la ruta del archivo Excel.');
  const personas = await personal.leerExcel(fs.readFileSync(archivo));
  const resultado = await personal.importar(pool, personas, null, { desactivarAusentes: process.argv.includes('--desactivar-ausentes') });
  console.log('Personal cargado:', resultado);
})().catch(error => {
  console.error('No se pudo cargar el personal:', error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
