const express = require('express');
const pool = require('../db');
const servicio = require('../utils/contabilidadDocumentos');
const { construir } = require('../utils/cuentasPorPagar');

const router = express.Router();
router.use((req, res, next) => {
  if (!req.session?.user) return res.redirect('/login');
  if (!['ADMIN', 'CONTABILIDAD'].includes(req.session.user.rol)) return res.status(403).send('Solo Contabilidad y Administración.');
  res.set('Cache-Control', 'no-store');
  res.locals.user = req.session.user;
  next();
});

const POR_PAGINA = 100;
router.get('/', async (req, res, next) => {
  try {
    const { docs, advertencias } = await servicio.cargar(pool);
    const datos = construir(docs, req.query);
    const paginas = Math.max(1, Math.ceil(datos.detalle.length / POR_PAGINA));
    const pagina = Math.min(paginas, Math.max(1, parseInt(req.query.pagina, 10) || 1));
    res.render('contabilidad/cuentas_por_pagar', {
      ...datos,
      advertencias,
      totalDetalle: datos.detalle.length,
      detalle: datos.detalle.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA),
      sinOrdenTotal: datos.sinOrden.length,
      sinOrden: datos.sinOrden.slice(0, POR_PAGINA),
      pagina,
      paginas
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
