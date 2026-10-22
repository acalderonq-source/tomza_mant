const router = require('express').Router();
const ExcelJS = require('exceljs');
const pool = require('../db');
const personal = require('../utils/personalRh');

router.use((req, res, next) => {
  const user = req.session?.user;
  if (!user) return res.redirect('/login');
  if (user.departamentoActivo !== 'RECURSOS_HUMANOS' || !['ADMIN', 'RH_GESTOR'].includes(user.rol) || !user.departamentos?.includes('RECURSOS_HUMANOS')) return res.status(403).send('No tiene acceso a Recursos Humanos.');
  res.set('Cache-Control', 'private, no-store');
  next();
});

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

router.get('/', wrap(async (req, res) => {
  res.render('recursos_humanos', { user: req.session.user, totalPersonal: await personal.contarActivos(pool) });
}));

const estadoValido = v => ['activos', 'inactivos', 'todos'].includes(v) ? v : 'activos';

router.get('/personal', wrap(async (req, res) => {
  const filtros = { q: String(req.query.q || '').slice(0, 80), estado: estadoValido(req.query.estado) };
  const datos = await personal.listar(pool, filtros);
  res.render('recursos_humanos_personal', { user: req.session.user, filtros, ...datos });
}));

router.get('/personal/exportar', wrap(async (req, res) => {
  const { personas } = await personal.listar(pool, { q: String(req.query.q || '').slice(0, 80), estado: estadoValido(req.query.estado) });
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Personal Gas Tomza');
  hoja.columns = [
    { header: 'COD TRAB', key: 'codigo', width: 12 },
    { header: 'Apellidos y Nombre', key: 'nombre', width: 45 },
    { header: 'Estado', key: 'estado', width: 12 },
    { header: 'Acceso al sistema', key: 'acceso', width: 18 }
  ];
  for (const p of personas) hoja.addRow({ codigo: Number(p.codigo), nombre: p.nombre, estado: Number(p.activo) ? 'Activo' : 'Inactivo', acceso: p.conAcceso ? 'Sí' : 'No' });
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: 'frozen', ySplit: 1 }];
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('Personal-Gas-Tomza.xlsx');
  await libro.xlsx.write(res);
  res.end();
}));

router.post('/personal/importar', wrap(async (req, res) => {
  try {
    const base64 = String(req.body?.archivo || '');
    if (!base64 || base64.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return res.status(400).json({ error: 'Adjunte un archivo Excel (.xlsx) de hasta 5 MB.' });
    const personas = await personal.leerExcel(Buffer.from(base64, 'base64'));
    const resultado = await personal.importar(pool, personas, req.session.user.id, { desactivarAusentes: req.body?.desactivarAusentes === true });
    res.json(resultado);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Carga de personal RH:', error.code || error.message);
    res.status(500).json({ error: 'No se pudo cargar el personal. No se cambió ningún dato.' });
  }
}));

module.exports = router;
