const express = require('express');
const { requireAdministracion } = require('../middleware/requireAdministracion');
const { validarDatos, validarImagen, idValido } = require('../utils/noticiasInicio');

function crearRouters(db, autorizar = requireAdministracion(db)) {
  const lectura = express.Router(), administracion = express.Router();
  lectura.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    const user = req.session?.user;
    if (!user || req.session?.proveedorPortal || user.requiereCambioPassword) return res.sendStatus(401);
    next();
  });
  administracion.use(autorizar);

  const fallo = (res, error) => {
    console.error('Noticias de inicio:', error.code || 'ERROR');
    return res.status(503).json({ error: 'No se pudieron cargar o guardar las noticias. Intente nuevamente.' });
  };
  async function imagen(req, res, soloActivas) {
    if (!idValido(req.params.id)) return res.sendStatus(404);
    try {
      const [[row]] = await db.query(`SELECT mime, imagen FROM inicio_noticias WHERE id=?${soloActivas ? ' AND activa=1' : ''}`, [Number(req.params.id)]);
      if (!row) return res.sendStatus(404);
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(row.mime)) return res.sendStatus(404);
      res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': row.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
      return res.send(row.imagen);
    } catch (error) { return fallo(res, error); }
  }
  lectura.get('/', async (_req, res) => {
    try {
      const [rows] = await db.query('SELECT id,titulo FROM inicio_noticias WHERE activa=1 ORDER BY orden,id');
      res.json({ noticias: rows.map(row => ({ id: row.id, titulo: row.titulo, imagen: `/inicio/noticias/${row.id}/imagen` })) });
    } catch (error) { fallo(res, error); }
  });
  lectura.get('/:id/imagen', (req, res) => imagen(req, res, true));
  administracion.get('/', async (req, res) => {
    try {
      const [noticias] = await db.query('SELECT id,titulo,orden,activa,creado_en FROM inicio_noticias ORDER BY orden,id');
      res.render('noticias_inicio', { user: req.session.user, noticias });
    } catch (error) { fallo(res, error); }
  });
  administracion.get('/:id/imagen', (req, res) => imagen(req, res, false));
  administracion.post('/', async (req, res) => {
    let datos, archivo;
    try { datos = validarDatos(req.body); archivo = validarImagen(req.body?.imagen); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    try {
      const [result] = await db.query('INSERT INTO inicio_noticias (titulo,orden,activa,mime,imagen,tamanio,creado_por) VALUES (?,?,?,?,?,?,?)',
        [datos.titulo, datos.orden, datos.activa, archivo.mime, archivo.imagen, archivo.tamanio, req.session.user.id]);
      res.status(201).json({ id: result.insertId });
    } catch (error) { fallo(res, error); }
  });
  administracion.post('/:id/editar', async (req, res) => {
    if (!idValido(req.params.id)) return res.sendStatus(404);
    let datos;
    try { datos = validarDatos(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
    try {
      const [result] = await db.query('UPDATE inicio_noticias SET titulo=?,orden=?,activa=? WHERE id=?', [datos.titulo, datos.orden, datos.activa, Number(req.params.id)]);
      if (!result.affectedRows) return res.sendStatus(404);
      res.json({ ok: true });
    } catch (error) { fallo(res, error); }
  });
  administracion.post('/:id/eliminar', async (req, res) => {
    if (!idValido(req.params.id)) return res.sendStatus(404);
    try {
      const [result] = await db.query('DELETE FROM inicio_noticias WHERE id=?', [Number(req.params.id)]);
      if (!result.affectedRows) return res.sendStatus(404);
      res.json({ ok: true });
    } catch (error) { fallo(res, error); }
  });
  return { lectura, administracion };
}
module.exports = { crearRouters };
