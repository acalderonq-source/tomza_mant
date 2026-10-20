const express = require('express');
const { requireAdministracion } = require('../middleware/requireAdministracion');
const { resumenDemo, GRAVEDADES } = require('../utils/ciberseguridadDemo');
function crearRouter(db, autorizar = requireAdministracion(db)) {
  const router = express.Router();
  router.use(autorizar);
  router.get('/', (req, res) => res.render('ciberseguridad', { user: req.session.user }));
  router.get('/datos', (req, res) => {
    const dias = Number(req.query.dias || 30), gravedad = req.query.gravedad || 'Todas';
    if (![7, 14, 30].includes(dias) || !['Todas', ...GRAVEDADES].includes(gravedad)) return res.status(400).json({ error: 'Filtro inválido.' });
    return res.json(resumenDemo(dias, gravedad));
  });
  return router;
}
module.exports = { crearRouter };
