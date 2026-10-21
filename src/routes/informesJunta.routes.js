const express = require('express');
const path = require('node:path');
const { UPLOAD_ROOT } = require('../utils/uploadStorage');
const { importWorkbooks, summarize, demoData, createStore, exportExcel, exportPowerPoint, scopeText } = require('../services/informesJunta');
const templates = require('../services/informesJuntaPlantillas');
const { buildAutomatic, overlays } = require('../services/informesJuntaAutomaticos');

function createRouter({ store = createStore(path.join(UPLOAD_ROOT, '.informes-junta')) } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (!req.session?.user) return req.path.startsWith('/api/') ? res.status(401).json({ error: 'Iniciá sesión para continuar.' }) : res.redirect('/login');
    if (req.session.user.rol !== 'ADMIN') return res.status(403).json({ error: 'Este módulo está reservado al administrador.' });
    next();
  });
  const run = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
  const view = report => ({ ...report, data: { ...report.data, records: report.data.records.slice(0, 30), count: report.data.records.length }, summary: summarize(report.data, report.params), scope: scopeText(report) });
  router.get('/', (req, res) => res.render('informes_junta', { user: req.session.user, csrfToken: req.session.csrfToken || '' }));
  router.get('/api/plantillas', run(async (_req, res) => res.json(await templates.manifest())));
  router.get('/api/plantillas/imagen/:name', run(async (req, res) => res.type('png').send(await templates.originalImage(req.params.name))));
  router.get('/api/informes/:id/sugerencias', run(async (req, res) => res.json(await templates.suggestions(await store.get(req.session.user.id, req.params.id)))));
  router.get('/api/informes/:id/relleno', run(async (req, res) => {
    const report=await store.get(req.session.user.id,req.params.id), automatic=await buildAutomatic(report), manifest=await templates.manifest();
    const blocks=(await overlays(automatic)).map(block=>({...block,...manifest.slides.find(slide=>slide.number===block.slide).images.find(image=>image.name===block.image),cells:block.cells}));
    const excelPreview=['G8','J8','K8','L8','M8','N8','O8'].map((address,index)=>({label:['Distribuidores','Pulperías','Total envasado','Granel','Gran Granel','Carburación','Total empresa'][index],value:automatic.model.get('Por canal',address).value}));
    res.json({coverage:automatic.coverage,blocks,excelPreview});
  }));
  router.put('/api/informes/:id/plantilla', run(async (req, res) => {
    const report = await store.get(req.session.user.id, req.params.id);
    const edits = await templates.validateEdits(req.body.edits);
    const saved = await store.update(req.session.user.id, report.id, req.body.revision, report.params, edits);
    res.json(view(saved));
  }));
  router.get('/api/informes', run(async (req, res) => res.json(await store.list(req.session.user.id))));
  router.post('/api/importar', run(async (req, res) => {
    const files = req.body?.files || [req.body];
    if (!Array.isArray(files) || !files.length || files.length > 10 || files.some(file => !file || typeof file.filename !== 'string' || file.filename.length > 150 || typeof file.content !== 'string' || file.content.length > 8388608 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content))) return res.status(400).json({ error: 'Los archivos recibidos no son válidos. Usá .xlsx de hasta 6 MB en total.' });
    const data = await importWorkbooks(files.map(file => ({ filename: file.filename, buffer: Buffer.from(file.content, 'base64') })));
    res.status(201).json(view(await store.create(req.session.user.id, data)));
  }));
  router.post('/api/demo', run(async (req, res) => res.status(201).json(view(await store.create(req.session.user.id, demoData())))));
  router.get('/api/informes/:id', run(async (req, res) => res.json(view(await store.get(req.session.user.id, req.params.id)))));
  router.put('/api/informes/:id', run(async (req, res) => {
    const report = await store.update(req.session.user.id, req.params.id, req.body.revision, req.body.params || {});
    res.json(view(report));
  }));
  for (const [extension, mime, build] of [
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', exportExcel],
    ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', exportPowerPoint]
  ]) {
    router.get(`/api/informes/:id/descargar.${extension}`, run(async (req, res) => {
      const report = await store.get(req.session.user.id, req.params.id);
      const buffer = await build(report);
      res.type(mime).attachment(`${report.data.demo?'DEMO-':''}Informe-relleno-${report.params.period}-v${report.revision}.${extension}`).send(Buffer.from(buffer));
    }));
  }
  router.use((error, _req, res, _next) => {
    if (!error.status) console.error('Informes de junta:', error.code || error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'No se pudo completar la operación. Intentá otra vez.' });
  });
  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
