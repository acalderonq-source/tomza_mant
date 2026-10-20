const express = require('express');
const { requireAdministracion } = require('../middleware/requireAdministracion');
const seguridad = require('../utils/ciberseguridad');
function crearRouter(db, autorizar = requireAdministracion(db), servicio = seguridad) {
  const router = express.Router();
  const wrap = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
  router.use(autorizar);
  router.get('/', (req, res) => res.render('ciberseguridad', { user: req.session.user }));
  router.get('/datos', wrap(async (req, res) => res.json(await servicio.resumenReal(db, seguridad.filtros(req.query)))));
  router.get('/exportar.csv', wrap(async (req, res) => {
    const f = seguridad.filtros(req.query), csv = await servicio.exportar(db, f);
    res.set('Content-Disposition', `attachment; filename="ciberseguridad-${f.desde}-${f.hasta}.csv"`);
    return res.type('text/csv; charset=utf-8').send(csv);
  }));
  router.use('/:id/seguimiento', (req, res, next) => /^[1-9]\d{0,14}$/.test(req.params.id) ? next() : res.status(400).json({ error: 'Incidente inválido.' }));
  router.get('/:id/seguimiento', wrap(async (req, res) => res.json({ historial: await servicio.seguimiento(db, req.params.id) })));
  router.post('/:id/seguimiento', wrap(async (req, res) => {
    await servicio.cambiarEstado(db, req.params.id, req.body || {}, req.session.user.id);
    res.json({ ok: true });
  }));
  router.use((error, _req, res, _next) => {
    if (!error.status) console.warn('Ciberseguridad: consulta no disponible.');
    res.status(error.status || 503).json({ error: error.status ? error.message : 'No se pudo consultar el registro real. Intente nuevamente. No se muestran datos simulados.' });
  });
  return router;
}
module.exports = { crearRouter };
