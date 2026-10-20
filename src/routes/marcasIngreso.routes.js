const express = require('express');
const { rateLimit } = require('express-rate-limit');
const marcas = require('../utils/marcasIngreso');
function crearRouter(db) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (!req.session?.user) return res.sendStatus(401);
    try {
      req.marcasPermisos = await marcas.permisosMarcas(db, req.session.user);
      if (!req.marcasPermisos.marcar && !req.marcasPermisos.consultar) return res.sendStatus(403);
      next();
    } catch (e) { next(e); }
  });
  const requireMarcar = (req, res, next) => req.marcasPermisos.marcar ? next() : res.sendStatus(403);
  const requireConsultar = (req, res, next) => req.marcasPermisos.consultar ? next() : res.sendStatus(403);
  router.get('/', async (req, res, next) => {
    if (!req.marcasPermisos.marcar) return res.redirect('/marcas-ingreso/historial');
    try {
      const [historial] = await db.query(`SELECT ${marcas.CAMPOS_MARCA} FROM taller_marcas WHERE usuario_id=? ORDER BY id DESC LIMIT 20`, [req.session.user.id]);
      res.render('marcas_ingreso/reloj', { user: req.session.user, historial });
    } catch (e) { next(e); }
  });
  router.get('/estado', requireMarcar, async (req, res, next) => {
    try { const ultima = await marcas.ultimaMarca(db, req.session.user.id); res.json({ ultima, siguiente: marcas.siguienteTipo(ultima), servidor: Date.now() }); }
    catch (e) { next(e); }
  });
  router.post('/reto', requireMarcar, async (req, res, next) => {
    try {
      const ultima = await marcas.ultimaMarca(db, req.session.user.id), tipo = marcas.siguienteTipo(ultima);
      const reto = marcas.nuevoReto(req.session.user.id, tipo); req.session.retoMarca = reto.guardado;
      res.json({ token: reto.token, tipo, expira: reto.guardado.expira, servidor: Date.now() });
    } catch (e) { next(e); }
  });
  router.post('/registrar', requireMarcar, rateLimit({ windowMs: 60000, limit: 6, standardHeaders: true, legacyHeaders: false, handler: (_req, res) => res.status(429).json({ error: 'Demasiados intentos. Espere un minuto y revise sus marcas.' }) }), async (req, res, next) => {
    try {
      const tipo = req.body?.tipo;
      if (!['ENTRADA', 'SALIDA'].includes(tipo)) return res.status(400).json({ error: 'Tipo de marca invalido.' });
      marcas.verificarReto(req.session.retoMarca, req.body?.token, req.session.user.id, tipo);
      const foto = marcas.validarFoto(req.body?.foto);
      const id = await marcas.registrarMarca(db, req.session.user, tipo, foto, req.session.retoMarca.hash);
      delete req.session.retoMarca;
      res.status(201).json({ id, ok: true });
    } catch (e) { next(e); }
  });
  router.get('/historial', requireConsultar, async (req, res, next) => {
    try {
      const filtros = marcas.filtrosHistorial(req.query);
      const where = 'creado_en>=DATE_ADD(?, INTERVAL 6 HOUR) AND creado_en<DATE_ADD(DATE_ADD(?,INTERVAL 1 DAY),INTERVAL 6 HOUR)';
      const params = [filtros.desde, filtros.hasta];
      const [[count]] = await db.query(`SELECT COUNT(*) AS total FROM taller_marcas WHERE ${where}`, params);
      const [historial] = await db.query(`SELECT ${marcas.CAMPOS_MARCA} FROM taller_marcas WHERE ${where} ORDER BY id DESC LIMIT 50 OFFSET ?`, [...params, (filtros.pagina - 1) * 50]);
      res.render('marcas_ingreso/historial', { user: req.session.user, historial, filtros, total: Number(count.total) });
    } catch (e) { next(e); }
  });
  router.get('/foto/:id', async (req, res, next) => {
    if (!/^[1-9]\d{0,14}$/.test(req.params.id)) return res.sendStatus(404);
    try {
      const [[row]] = await db.query(`SELECT foto FROM taller_marcas WHERE id=?${req.marcasPermisos.consultar ? '' : ' AND usuario_id=?'}`, req.marcasPermisos.consultar ? [req.params.id] : [req.params.id, req.session.user.id]);
      if (!row) return res.sendStatus(404);
      res.set({ 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' }); res.send(row.foto);
    } catch (e) { next(e); }
  });
  router.use((err, _req, res, _next) => {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Marcas de Taller:', err.code || 'ERROR');
    res.status(503).json({ error: 'No se pudo completar la operacion. Revise el historial antes de intentar otra marca.' });
  });
  return router;
}
module.exports = { crearRouter };
