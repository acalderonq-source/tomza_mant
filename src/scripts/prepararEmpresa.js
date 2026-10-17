require('dotenv').config();
async function prepararEmpresa(db) {
  await require('../utils/operacionesEmpresa').preparar(db);
  await require('../utils/auditoriaOrdenes').prepararAuditoria(db);
}
if (require.main === module) {
  const db = require('../db');
  prepararEmpresa(db).then(() => console.log('Tablas de control preparadas; no se modificaron datos historicos.'))
    .catch(error => { console.error(error.code || error.message); process.exitCode = 1; }).finally(() => db.end());
}
module.exports = { prepararEmpresa };
