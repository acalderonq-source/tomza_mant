const express = require('express');
const imports = require('../services/capturaGeneralArchivos');
const capturaDiaria = require('../services/capturaDiaria');

const sendError = (res, error, fallback) => {
  if (!error.status) console.error('Captura diaria:', error.code || error.message);
  res.status(error.status || 500).json({ error: error.status ? error.message : fallback });
};
const decodeFiles = files => {
  const invalid = !Array.isArray(files) || !files.length || files.length > 5 || files.some(file => (
    !file || typeof file.filename !== 'string' || file.filename.length > 180 || typeof file.content !== 'string' ||
    file.content.length > 9437184 || file.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)
  ));
  if (invalid) throw Object.assign(new Error('Adjunte el Reporte General en Excel (.xlsx o .xls).'), { status: 400 });
  return files.map(file => ({ filename: file.filename.split(/[\\/]/).pop(), buffer: Buffer.from(file.content, 'base64') }));
};

function createRouter({ fileStore = imports.createStore(), diaria = capturaDiaria.createService() } = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (!req.session?.user) return res.redirect('/login');
    if (req.session.user.rol !== 'ADMIN') return res.status(403).send('Acceso exclusivo del administrador.');
    next();
  });

  // Los accesos anteriores llevan al único flujo vigente: importación desde Excel.
  router.get('/', (_req, res) => res.redirect('/admin/ventas-gas/captura-general/archivos'));
  router.get('/ejecutivo', (_req, res) => res.redirect('/admin/ventas-gas/captura-general/archivos'));
  router.get('/captura-general', (_req, res) => res.redirect('/admin/ventas-gas/captura-general/archivos'));

  router.get('/captura-general/archivos', async (req, res, next) => {
    try {
      const model = imports.modelFor(await fileStore.load(), req.query.period);
      res.render('captura_general_archivos', {
        csrfToken: req.session.csrfToken || '',
        model: imports.viewModel(model),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/captura-general/archivos/api', async (req, res) => {
    try {
      res.json(imports.viewModel(imports.modelFor(await fileStore.load(), req.query.period)));
    } catch (error) {
      res.status(error.status || 500).json({ error: error.status ? error.message : 'No se pudieron cargar las importaciones.' });
    }
  });

  router.post('/captura-general/archivos/importar', async (req, res) => {
    try {
      const files = req.body?.files;
      const invalid = !Array.isArray(files) || !files.length || files.length > 10 || files.some(file => (
        !file || typeof file.filename !== 'string' || typeof file.content !== 'string' ||
        file.content.length > 8388608 || file.content.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)
      ));
      if (invalid) return res.status(400).json({ error: 'Adjuntá archivos Excel o ZIP válidos, hasta 6 MB en total.' });

      const imported = await imports.importFiles(files.map(file => ({
        filename: file.filename,
        buffer: Buffer.from(file.content, 'base64'),
      })));
      const state = await fileStore.import(
        imported,
        req.session.user.id || req.session.user.nombre,
        req.body.revision,
      );
      const period = [...imported.records, ...imported.references, ...(imported.portfolios || [])]
        .map(record => record.day.slice(0, 7))
        .sort()
        .at(-1);
      res.status(201).json(imports.viewModel(imports.modelFor(state, period)));
    } catch (error) {
      if (!error.status) console.error('Captura general archivos:', error.code || error.message);
      res.status(error.status || 500).json({
        error: error.status ? error.message : 'No se pudo guardar la importación. No se sustituyeron los datos anteriores.',
      });
    }
  });

  router.get('/captura-general/archivos/excel', async (req, res, next) => {
    try {
      const model = imports.modelFor(await fileStore.load(), req.query.period);
      const buffer = await imports.exportOriginals(model, fileStore.readOriginal);
      res.type('application/zip')
        .attachment(`Capturas-originales-${model.period}.zip`)
        .send(Buffer.from(buffer));
    } catch (error) {
      next(error);
    }
  });

  router.get('/captura-general/archivos/excel-dia', async (req, res, next) => {
    try {
      const day = imports.date(req.query.day);
      const model = imports.modelFor(await fileStore.load(), day?.slice(0, 7));
      const buffer = await imports.exportDay(model, day, fileStore.readOriginal);
      res.type('application/zip')
        .attachment(`Capturas-originales-${day}.zip`)
        .send(Buffer.from(buffer));
    } catch (error) {
      if (error.status) return res.status(error.status).send(error.message);
      next(error);
    }
  });

  router.get('/captura-general/archivos/dias.zip', async (req, res, next) => {
    try {
      const model = imports.modelFor(await fileStore.load(), req.query.period);
      const buffer = await imports.exportDaysZip(model, fileStore.readOriginal);
      res.type('application/zip')
        .attachment(`Capturas-dia-a-dia-${model.period}.zip`)
        .send(Buffer.from(buffer));
    } catch (error) {
      if (error.status) return res.status(error.status).send(error.message);
      next(error);
    }
  });

  // ---------- Captura diaria automática (Reporte General -> 11 capturas) ----------
  const actor = req => req.session.user.id || req.session.user.nombre;

  router.get('/captura-diaria', async (req, res, next) => {
    try {
      res.render('captura_diaria', { csrfToken: req.session.csrfToken || '', model: await diaria.vista(req.query.month) });
    } catch (error) { next(error); }
  });

  router.get('/captura-diaria/api', async (req, res) => {
    try { res.json(await diaria.vista(req.query.month)); } catch (error) { sendError(res, error, 'No se pudo cargar la captura.'); }
  });

  router.post('/captura-diaria/importar', async (req, res) => {
    try {
      const { month } = await diaria.importar(decodeFiles(req.body?.files), actor(req), req.body?.revision);
      const check = await diaria.revisar(month);
      res.status(201).json({ view: await diaria.vista(month), check });
    } catch (error) { sendError(res, error, 'No se pudo procesar el Reporte General. No se cambió nada.'); }
  });

  router.post('/captura-diaria/cobranza', async (req, res) => {
    try {
      const day = String(req.body?.day || '');
      await diaria.guardarCobranza(day, { GT: req.body?.GT, SG: req.body?.SG }, actor(req), req.body?.revision);
      res.json({ view: await diaria.vista(day.slice(0, 7)) });
    } catch (error) { sendError(res, error, 'No se pudo guardar la cobranza.'); }
  });

  router.post('/captura-diaria/saldo', async (req, res) => {
    try {
      const month = String(req.body?.month || '');
      await diaria.guardarSaldo(month, { GT: req.body?.GT, SG: req.body?.SG }, actor(req), req.body?.revision);
      res.json({ view: await diaria.vista(month) });
    } catch (error) { sendError(res, error, 'No se pudo guardar el saldo inicial.'); }
  });

  router.post('/captura-diaria/plantillas', async (req, res) => {
    try {
      const files = req.body?.files;
      if (!Array.isArray(files) || !files.length || files.length > 11 || files.some(f => !f || typeof f.filename !== 'string' || typeof f.content !== 'string' || f.content.length > 9437184 || f.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.content))) {
        return res.status(400).json({ error: 'Adjunte las plantillas .xlsx.' });
      }
      await diaria.subirPlantillas(files.map(f => ({ filename: f.filename.split(/[\\/]/).pop(), buffer: Buffer.from(f.content, 'base64') })));
      res.json({ view: await diaria.vista(req.body?.month) });
    } catch (error) { sendError(res, error, 'No se pudieron guardar las plantillas.'); }
  });

  router.get('/captura-diaria/revisar', async (req, res) => {
    try { res.json(await diaria.revisar(String(req.query.month || ''))); } catch (error) { sendError(res, error, 'No se pudo revisar la captura.'); }
  });

  router.get('/captura-diaria/descargar', async (req, res) => {
    try {
      const month = String(req.query.month || '');
      const { buffer } = await diaria.descargar(month);
      res.type('application/zip').attachment(`Capturas-${month}.zip`).send(buffer);
    } catch (error) {
      if (error.status) return res.status(error.status).send(error.message);
      console.error('Captura diaria descarga:', error.message);
      res.status(500).send('No se pudieron generar las capturas.');
    }
  });

  return router;
}

module.exports = { createRouter };
