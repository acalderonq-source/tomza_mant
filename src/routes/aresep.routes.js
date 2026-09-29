const express = require('express');
const pool = require('../db');
const a = require('../utils/aresep');
const { TODAS_SEDES, etiquetaSede } = require('../utils/sedes');
const { generarExcel } = require('../utils/aresepExcel');
const { ensureGastosOperativosTables } = require('../utils/gastosOperativos');
const router = express.Router();
const envolver = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const idValido = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const urlLista = ({ periodo, seccion, sede = '' }) => `/aresep?${new URLSearchParams({ periodo, seccion, ...(sede ? { sede } : {}) })}`;
const limpiarTexto = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function categoriaTrabajo(value) {
  const texto = limpiarTexto(value);
  if (/aline|alineacion/.test(texto)) return 'alineamiento';
  if (/afin|afinamiento|afinacion/.test(texto)) return 'afinamiento';
  if (/freno|revision|inspeccion|diagnost/.test(texto)) return 'frenos';
  return 'mantenimiento';
}
function promedio(total, cantidad) { return cantidad ? Math.round((total / cantidad + Number.EPSILON) * 100) / 100 : null; }

async function datosOperacionMes(conn, periodo, unidades) {
  const inicio = `${periodo}-01`;
  const fin = `${periodo}-${String(new Date(Number(periodo.slice(0, 4)), Number(periodo.slice(5)), 0).getDate()).padStart(2, '0')}`;
  const ids = unidades.map(u => u.id);
  if (!ids.length) return new Map();
  const [rutas] = await conn.query(`SELECT unidad_id, placa_reportada, ruta, semana_inicio
    FROM supervisor_rutas_semanales WHERE activo = 1 AND semana_inicio BETWEEN ? AND ? ORDER BY semana_inicio`, [inicio, fin]);
  const [lavados] = await conn.query(`SELECT unidad_id, COUNT(*) AS total FROM lavado_unidades
    WHERE fecha BETWEEN ? AND ? AND unidad_id IN (?) GROUP BY unidad_id`, [inicio, fin, ids]);
  const [preventivos] = await conn.query(`SELECT m.unidad_id, m.tipo, m.plan, m.ejecucion
    FROM mantenimientos m WHERE m.estado = 'CERRADO' AND DATE(m.fecha_programada) BETWEEN ? AND ? AND m.unidad_id IN (?)`, [inicio, fin, ids]);
  const [correctivos] = await conn.query(`SELECT c.unidad_id, c.tipo_mantenimiento, c.trabajo_realizado,
      GROUP_CONCAT(DISTINCT ct.trabajo SEPARATOR ' ') AS trabajos_detalle
    FROM correctivos c LEFT JOIN correctivo_trabajos ct ON ct.correctivo_id = c.id
    WHERE DATE(c.fecha) BETWEEN ? AND ? AND c.unidad_id IN (?)
    GROUP BY c.id, c.unidad_id, c.tipo_mantenimiento, c.trabajo_realizado`, [inicio, fin, ids]);
  const [gastos] = await conn.query(`SELECT placa, tipo_trabajo, descripcion, monto FROM gastos_operativos
    WHERE periodo = ? AND estado = 'ACTIVO' AND placa IS NOT NULL`, [periodo]);
  const [fichas] = await conn.query(`SELECT unidad_id, datos FROM aresep_registros
    WHERE periodo = ? AND seccion = 'unidades' AND unidad_id IN (?)`, [periodo, ids]);
  const fichaPorUnidad = new Map(fichas.map(row => [Number(row.unidad_id), typeof row.datos === 'string' ? JSON.parse(row.datos) : row.datos]));
  const porId = new Map(unidades.map(u => [Number(u.id), { rutas: [], lavados: 0, trabajos: [], costos: { mantenimiento: 0, alineamiento: 0, afinamiento: 0, frenos: 0 }, rutasMes: 0 }]));
  const idPorPlaca = new Map(unidades.map(u => [String(u.placa || '').replace(/[^a-z0-9]/gi, '').toUpperCase(), Number(u.id)]));
  for (const row of rutas) {
    const unidadId = Number(row.unidad_id) || idPorPlaca.get(String(row.placa_reportada || '').replace(/[^a-z0-9]/gi, '').toUpperCase());
    const item = porId.get(Number(unidadId));
    if (!item) continue;
    item.rutas.push({ nombre: row.ruta, semana: String(row.semana_inicio).slice(0, 10) });
  }
  for (const row of lavados) if (porId.has(Number(row.unidad_id))) porId.get(Number(row.unidad_id)).lavados = Number(row.total || 0);
  for (const row of [...preventivos, ...correctivos]) {
    const item = porId.get(Number(row.unidad_id));
    if (!item) continue;
    const descripcion = [row.tipo, row.tipo_mantenimiento, row.plan, row.ejecucion, row.trabajo_realizado, row.trabajos_detalle].filter(Boolean).join(' ');
    item.trabajos.push(categoriaTrabajo(descripcion));
  }
  for (const gasto of gastos) {
    const unidadId = idPorPlaca.get(String(gasto.placa || '').replace(/[^a-z0-9]/gi, '').toUpperCase());
    if (!unidadId) continue;
    const tipo = limpiarTexto(gasto.tipo_trabajo);
    if (!['correctivo', 'preventivo', 'mantenimiento', 'reparacion', 'emergencia'].includes(tipo)) continue;
    const cat = categoriaTrabajo(gasto.descripcion);
    porId.get(unidadId).costos[cat] += Number(gasto.monto || 0);
  }
  const resultados = new Map();
  for (const unidad of unidades) {
    const item = porId.get(Number(unidad.id));
    const tiposRuta = [...new Set(item.rutas.map(r => r.nombre).filter(Boolean))];
    const ultimaRuta = item.rutas[item.rutas.length - 1]?.nombre || '';
    const frecuencias = Object.fromEntries(['mantenimiento', 'alineamiento', 'afinamiento', 'frenos'].map(cat => [cat, item.trabajos.filter(t => t === cat).length]));
    const ficha = fichaPorUnidad.get(Number(unidad.id)) || {};
    const datos = {
      sede: unidad.sede || '', ruta: ultimaRuta, placa: unidad.placa,
      tipo: a.tipos[String(ficha.tipo_transporte)] || unidad.negocio || '',
      rutas_mes: new Set(item.rutas.map(r => r.semana)).size,
      rutas_detalle: tiposRuta.join(', ').slice(0, 250), lavados_mes: item.lavados,
      mantenimientos: item.trabajos.length,
      alineamientos: frecuencias.alineamiento,
      afinamientos: frecuencias.afinamiento,
      frenos: frecuencias.frenos,
      costo_mantenimiento: promedio(item.costos.mantenimiento, frecuencias.mantenimiento),
      costo_alineamiento: promedio(item.costos.alineamiento, frecuencias.alineamiento),
      costo_afinamiento: promedio(item.costos.afinamiento, frecuencias.afinamiento),
      costo_frenos: promedio(item.costos.frenos, frecuencias.frenos)
    };
    resultados.set(Number(unidad.id), datos);
  }
  return resultados;
}
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
    mensaje: req.query.guardado ? 'Registro guardado.' : req.query.incorporados ? 'Unidades incorporadas. Las fichas existentes no se modificaron.'
      : req.query.operacionCompletada !== undefined ? `${Number(req.query.operacionCompletada) || 0} registros de operación agregados desde el sistema. Los existentes se conservaron.` : '',
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
router.post('/completar-operacion', contexto, envolver(async (req, res) => {
  if (req.seccionAresep !== 'operacion') return res.status(400).send('Seleccione Operación y costos.');
  await ensureGastosOperativosTables();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [unidades] = await conn.query('SELECT id, placa, sede, negocio FROM unidades WHERE COALESCE(activa, 1) = 1 ORDER BY placa');
    const incluidas = unidades.filter(u => !req.sedeAresep || u.sede === req.sedeAresep);
    if (!incluidas.length) {
      await conn.commit();
      return res.redirect(`${urlLista({ periodo: req.periodoAresep, seccion: 'operacion', sede: req.sedeAresep })}&operacionCompletada=0`);
    }
    const datosPorUnidad = await datosOperacionMes(conn, req.periodoAresep, incluidas);
    const [existentes] = await conn.query("SELECT unidad_id FROM aresep_registros WHERE periodo = ? AND seccion = 'operacion' AND unidad_id IN (?) FOR UPDATE", [req.periodoAresep, incluidas.map(u => u.id)]);
    const idsExistentes = new Set(existentes.map(r => Number(r.unidad_id)));
    const nuevas = incluidas.filter(u => !idsExistentes.has(Number(u.id)));
    if (nuevas.length) {
      const valores = nuevas.map(unidad => {
        const datos = a.validar('operacion', datosPorUnidad.get(Number(unidad.id)), req.periodoAresep, unidad);
        datos.sede = unidad.sede || '';
        return [req.periodoAresep, 'operacion', a.clave('operacion', datos, unidad.id), unidad.id,
          JSON.stringify(datos), req.session.user.id, req.session.user.id];
      });
      await conn.query('INSERT INTO aresep_registros (periodo, seccion, clave, unidad_id, datos, creado_por, actualizado_por) VALUES ?', [valores]);
      await conn.query(`INSERT INTO aresep_historial (registro_id, version, datos, usuario_id)
        SELECT id, version, datos, actualizado_por FROM aresep_registros
        WHERE periodo = ? AND seccion = 'operacion' AND unidad_id IN (?)`, [req.periodoAresep, nuevas.map(u => u.id)]);
    }
    await conn.commit();
    res.redirect(`${urlLista({ periodo: req.periodoAresep, seccion: 'operacion', sede: req.sedeAresep })}&operacionCompletada=${nuevas.length}`);
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
