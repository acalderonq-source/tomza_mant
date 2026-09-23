const express = require('express');
const pool = require('../db');
const a = require('../utils/aresep');
const { TODAS_SEDES, etiquetaSede } = require('../utils/sedes');
const { generarExcel } = require('../utils/aresepExcel');
const router = express.Router();
const envolver = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const idValido = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const urlLista = ({ periodo, seccion, sede = '' }) => `/aresep?${new URLSearchParams({ periodo, seccion, ...(sede ? { sede } : {}) })}`;
async function obtenerSedesYUnidades() {
  const [unidades] = await pool.query('SELECT id, sede FROM unidades');
  const porId = new Map(unidades.map(u => [u.id, u.sede]));
  const sedes = [...new Set([...TODAS_SEDES, ...unidades.map(u => u.sede)].filter(Boolean))]
    .sort((x, y) => etiquetaSede(x).localeCompare(etiquetaSede(y), 'es'));
  return { porId, sedes };
}

router.use((req, res, next) => {
  if (!req.session?.user) return res.redirect('/login');
  res.set('Cache-Control', 'no-store');
  if (!a.permitidas(req.session.user).length) return res.status(403).send('Sin acceso a ARESEP.');
  next();
});
function contexto(req, res, next) {
  req.periodoAresep = req.query.periodo || a.mesActual();
  req.seccionAresep = req.query.seccion || 'unidades';
  req.sedeAresep = typeof req.query.sede === 'string' ? req.query.sede.trim() : '';
  if (!a.periodoValido(req.periodoAresep)) return res.status(400).send('Mes inválido.');
  if (req.sedeAresep.length > 100) return res.status(400).send('Sede inválida.');
  if (!a.permitidas(req.session.user).includes(req.seccionAresep)) return res.status(403).send('Sin acceso a este apartado.');
  next();
}
async function registro(req) {
  if (!idValido(req.params.id)) return null;
  const [[row]] = await pool.query('SELECT * FROM aresep_registros WHERE id = ?', [req.params.id]);
  if (!row || !a.permitidas(req.session.user).includes(row.seccion)) return null;
  return row;
}
async function vistaFormulario(req, res, { row, error = '', body, status = 200 }) {
  const seccion = row?.seccion || req.seccionAresep;
  const periodo = row?.periodo || req.periodoAresep;
  const sedeFormulario = typeof req.query.sede === 'string' ? req.query.sede : '';
  const [unidades] = a.secciones[seccion].unidad
    ? await pool.query(`SELECT id, placa, marca, modelo, anio, sede FROM unidades ${sedeFormulario && !row ? 'WHERE sede = ?' : ''} ORDER BY placa`, sedeFormulario && !row ? [sedeFormulario] : []) : [[]];
  const [historial] = row ? await pool.query(
    'SELECT h.version, h.creado_en, u.nombre AS usuario FROM aresep_historial h LEFT JOIN usuarios u ON u.id = h.usuario_id WHERE h.registro_id = ? ORDER BY h.version DESC LIMIT 20', [row.id]) : [[]];
  const { sedes } = await obtenerSedesYUnidades();
  const sedeSeleccionada = body?.sede || (row ? a.sedeRegistro(row) : sedeFormulario);
  if (sedeSeleccionada && !sedes.includes(sedeSeleccionada)) sedes.push(sedeSeleccionada);
  res.status(status).render('aresep/formulario', {
    a, user: req.session.user, seccion, periodo, row, unidades, historial, error, sedes, sedeSeleccionada,
    sedeFiltro: sedeFormulario,
    valores: body || (row ? a.leerDatos(row) : {}), unidadId: body?.unidad_id || row?.unidad_id || '',
    version: body?.version ?? row?.version ?? 0
  });
}
router.get('/', contexto, envolver(async (req, res) => {
  const { periodoAresep: periodo, seccionAresep: seccion } = req;
  const [rows] = await pool.query('SELECT * FROM aresep_registros WHERE periodo = ? AND seccion IN (?) ORDER BY id DESC', [periodo, a.permitidas(req.session.user)]);
  const { porId, sedes } = await obtenerSedesYUnidades();
  const todos = rows.map(row => ({ ...a.preparar(row), sede: a.sedeRegistro(row, porId) }));
  for (const r of todos) if (r.sede && !sedes.includes(r.sede)) sedes.push(r.sede);
  const sede = req.sedeAresep;
  if (sede && !sedes.includes(sede)) sedes.push(sede);
  const delLugar = sede ? todos.filter(r => r.sede === sede) : todos;
  const registros = delLugar.filter(r => r.seccion === seccion);
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200).trim() : '';
  const estado = ['pendiente', 'completo'].includes(req.query.estado) ? req.query.estado : '';
  const visibles = registros.filter(r => (!q || Object.values(r.valores).some(v => String(v ?? '').toLocaleLowerCase('es').includes(q.toLocaleLowerCase('es'))))
    && (!estado || (estado === 'pendiente' ? r.pendientes.length : !r.pendientes.length)));
  const page = Math.max(1, Math.min(Math.ceil(visibles.length / 50) || 1, Number.parseInt(req.query.pagina, 10) || 1));
  const cuentas = {};
  for (const r of delLugar) cuentas[r.seccion] = (cuentas[r.seccion] || 0) + 1;
  res.render('aresep/index', {
    a, etiquetaSede, user: req.session.user, periodo, seccion, sede, sedes, q, estado, pagina: page, paginas: Math.ceil(visibles.length / 50),
    registros: visibles.slice((page - 1) * 50, page * 50), totalFiltrado: visibles.length, total: registros.length,
    completos: registros.filter(r => !r.pendientes.length).length,
    cuentas,
    mensaje: req.query.guardado ? 'Registro guardado.' : req.query.incorporados ? 'Unidades incorporadas. Las fichas existentes no se modificaron.' : '',
    error: ''
  });
}));
router.get('/nuevo', contexto, envolver((req, res) => vistaFormulario(req, res, {})));
router.get('/registro/:id', envolver(async (req, res) => {
  const row = await registro(req);
  if (!row) return res.status(404).send('Registro no disponible.');
  await vistaFormulario(req, res, { row });
}));

async function guardar(req, res, row) {
  const seccion = row?.seccion || req.seccionAresep;
  const periodo = row?.periodo || req.periodoAresep;
  let conn;
  try {
    let unidad = null;
    if (a.secciones[seccion].unidad) {
      const id = row?.unidad_id || req.body.unidad_id;
      if (!idValido(id)) throw new Error('Seleccione una unidad registrada.');
      [[unidad]] = await pool.query('SELECT id, placa, sede FROM unidades WHERE id = ?', [id]);
    }
    const datos = a.validar(seccion, req.body, periodo, unidad);
    if (seccion === 'operacion' && row) datos.sede = a.leerDatos(row).sede || unidad.sede || '';
    const key = a.clave(seccion, datos, unidad?.id);
    conn = await pool.getConnection();
    await conn.beginTransaction();
    let id = row?.id;
    let version = 1;
    if (row) {
      const [[actual]] = await conn.query('SELECT version FROM aresep_registros WHERE id = ? FOR UPDATE', [row.id]);
      if (!actual || actual.version !== Number(req.body.version)) {
        const err = new Error('Otra persona modificó este registro. Abra de nuevo el registro antes de guardar para no perder esos cambios.');
        err.status = 409;
        throw err;
      }
      version = actual.version + 1;
      await conn.query('UPDATE aresep_registros SET clave = ?, datos = ?, version = ?, actualizado_por = ? WHERE id = ?',
        [key, JSON.stringify(datos), version, req.session.user.id, id]);
    } else {
      const [result] = await conn.query('INSERT INTO aresep_registros (periodo, seccion, clave, unidad_id, datos, creado_por, actualizado_por) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [periodo, seccion, key, unidad?.id || null, JSON.stringify(datos), req.session.user.id, req.session.user.id]);
      id = result.insertId;
    }
    await conn.query('INSERT INTO aresep_historial (registro_id, version, datos, usuario_id) VALUES (?, ?, ?, ?)', [id, version, JSON.stringify(datos), req.session.user.id]);
    await conn.commit();
    res.redirect(`${urlLista({ periodo, seccion, sede: req.query.sede })}&guardado=1`);
  } catch (error) {
    if (conn) await conn.rollback();
    const known = !error.code || error.code === 'ER_DUP_ENTRY';
    if (!known) throw error;
    await vistaFormulario(req, res, { row, body: req.body, status: error.status || 400,
      error: error.code === 'ER_DUP_ENTRY' ? 'Ya existe este registro en el mes. Búsquelo en el listado y use Editar.' : error.message });
  } finally { conn?.release(); }
}
router.post('/nuevo', contexto, envolver((req, res) => guardar(req, res, null)));
router.post('/registro/:id', envolver(async (req, res) => {
  const row = await registro(req);
  if (!row) return res.status(404).send('Registro no disponible.');
  await guardar(req, res, row);
}));
router.post('/incorporar-unidades', contexto, envolver(async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [unidades] = await conn.query('SELECT id, placa, marca, anio, sede FROM unidades WHERE activa = 1 ORDER BY placa');
    const [existentes] = await conn.query("SELECT unidad_id FROM aresep_registros WHERE periodo = ? AND seccion = 'unidades' FOR UPDATE", [req.periodoAresep]);
    const ids = new Set(existentes.map(r => r.unidad_id));
    const nuevas = unidades.filter(u => !ids.has(u.id) && (!req.sedeAresep || u.sede === req.sedeAresep));
    if (nuevas.length) {
      const values = nuevas.map(u => {
        const datos = a.validar('unidades', { marca: u.marca || '', anio: u.anio || '', almacenamiento: u.sede || '' }, req.periodoAresep, u);
        return [req.periodoAresep, 'unidades', a.clave('unidades', datos, u.id), u.id, JSON.stringify(datos), req.session.user.id, req.session.user.id];
      });
      await conn.query('INSERT INTO aresep_registros (periodo, seccion, clave, unidad_id, datos, creado_por, actualizado_por) VALUES ?', [values]);
      await conn.query(`INSERT INTO aresep_historial (registro_id, version, datos, usuario_id)
        SELECT id, version, datos, actualizado_por FROM aresep_registros WHERE periodo = ? AND seccion = 'unidades' AND unidad_id IN (?)`, [req.periodoAresep, nuevas.map(u => u.id)]);
    }
    await conn.commit();
    res.redirect(`${urlLista({ periodo: req.periodoAresep, seccion: 'unidades', sede: req.sedeAresep })}&incorporados=1`);
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}));
router.get('/exportar/:tipo', contexto, envolver(async (req, res) => {
  if (!['a7', 'costos'].includes(req.params.tipo)) return res.status(404).send('Archivo no disponible.');
  const sections = req.params.tipo === 'a7' ? ['unidades'] : a.permitidas(req.session.user).filter(s => s !== 'unidades');
  const [rows] = await pool.query('SELECT * FROM aresep_registros WHERE periodo = ? AND seccion IN (?) ORDER BY seccion, id', [req.periodoAresep, sections]);
  const { porId } = await obtenerSedesYUnidades();
  const conSede = rows.map(row => ({ ...row, sede: a.sedeRegistro(row, porId) }));
  const filtrados = req.sedeAresep ? conSede.filter(row => row.sede === req.sedeAresep) : conSede;
  const buffer = await generarExcel(req.params.tipo, req.periodoAresep, filtrados, a.permitidas(req.session.user).includes('planilla'));
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.attachment(`ARESEP_${req.params.tipo}_${req.periodoAresep}${req.sedeAresep ? '_' + req.sedeAresep.replace(/[^\w-]/g, '_') : ''}.xlsx`);
  res.send(Buffer.from(buffer));
}));
router.use((error, req, res, next) => {
  console.error('ARESEP:', error.code || error.message);
  if (res.headersSent) return next(error);
  res.status(500).send('No se pudo completar la operación de ARESEP. Intente nuevamente.');
});
module.exports = router;
