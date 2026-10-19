const express = require('express');
const { centroControl, expediente, consultar } = require('../utils/controlEmpresa');
const { requireAdministracion } = require('../middleware/requireAdministracion');
function crearRouter(db) {
  const router = express.Router();
  router.use(requireAdministracion(db));
  router.get('/', async (req, res, next) => {
    if (req.session.user.rol !== 'ADMIN') return res.sendStatus(403);
    try {
      const modelo = await centroControl(db);
      res.render('control_empresa', { titulo: 'Centro de control', modelo, placa: '', unidad: null,
        version: require('../../package.json').version, release: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'local' });
    } catch (error) { next(error); }
  });
  router.get('/unidades', async (req, res, next) => {
    const placa = String(req.query.placa || '').trim().toUpperCase();
    if (placa && !/^[A-Z0-9-]{3,20}$/.test(placa)) return res.status(400).send('Placa invalida.');
    try {
      const data = placa ? await expediente(db, placa) : { unidad: null, secciones: [] };
      if (data.unidad?.error) return res.status(503).send(data.unidad.error);
      if (placa && !data.unidad?.filas.length) return res.status(404).send('Unidad no encontrada.');
      res.render('control_empresa', { titulo: 'Expediente por placa', modelo: data, placa,
        unidad: data.unidad?.filas[0], version: require('../../package.json').version,
        release: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'local' });
    } catch (error) { next(error); }
  });
  router.get('/auditoria/excel', async (req, res, next) => {
    if (req.session.user.rol !== 'ADMIN') return res.sendStatus(403);
    try {
      const resultado = await consultar(db, 'SELECT id,modulo,tabla_afectada,registro_id,accion,usuario_nombre,creado_en,antes,despues FROM auditoria_sistema ORDER BY id DESC LIMIT 1000');
      if (resultado.error) return res.status(503).send(resultado.error);
      const ExcelJS = require('exceljs'), libro = new ExcelJS.Workbook();
      const hoja = libro.addWorksheet('Ultimos 1000 cambios');
      const claves = ['id','modulo','tabla_afectada','registro_id','accion','usuario_nombre','creado_en','antes','despues'];
      hoja.addRow(claves);
      for (const fila of resultado.filas) hoja.addRow(claves.map(k => typeof fila[k] === 'object' && !(fila[k] instanceof Date) ? JSON.stringify(fila[k]) : fila[k]));
      res.attachment('auditoria-taller.xlsx');
      await libro.xlsx.write(res); res.end();
    } catch (error) { next(error); }
  });
  return router;
}
module.exports = crearRouter(require('../db'));
module.exports.crearRouter = crearRouter;
