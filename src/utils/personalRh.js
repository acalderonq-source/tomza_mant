// Personal de Gas Tomza para Recursos Humanos: lectura del Excel, carga y consulta.
const ExcelJS = require('exceljs');

const EMPRESA = 'GAS TOMZA';
const MAXIMO = 5000;
const fallo = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status });
const normalizar = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
const limpiarNombre = v => String(v ?? '').replace(/\s+/g, ' ').trim();

function textoCelda(celda) {
  const v = celda.value;
  if (v && typeof v === 'object') return String(v.text ?? v.result ?? '').trim();
  return String(v ?? '').trim();
}

// Espera una hoja con las columnas "COD TRAB" y "Apellidos y Nombre" (en cualquier posición).
async function leerExcel(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 5 * 1024 * 1024) throw fallo('Adjunte un archivo Excel (.xlsx) de hasta 5 MB.');
  const libro = new ExcelJS.Workbook();
  try { await libro.xlsx.load(buffer); } catch { throw fallo('No se pudo leer el archivo. Debe ser un Excel .xlsx.'); }
  for (const hoja of libro.worksheets) {
    let filaTitulos = 0, colCodigo = 0, colNombre = 0;
    for (let r = 1; r <= Math.min(10, hoja.rowCount) && !filaTitulos; r++) {
      hoja.getRow(r).eachCell((celda, c) => {
        const t = normalizar(textoCelda(celda));
        if (/^COD/.test(t) && !colCodigo) colCodigo = c;
        if (/NOMBRE/.test(t) && !colNombre) colNombre = c;
      });
      if (colCodigo && colNombre) filaTitulos = r; else { colCodigo = 0; colNombre = 0; }
    }
    if (!filaTitulos) continue;
    const personas = [], vistos = new Set(), errores = [];
    for (let r = filaTitulos + 1; r <= hoja.rowCount; r++) {
      const fila = hoja.getRow(r);
      const codigo = textoCelda(fila.getCell(colCodigo)).replace(/\.0+$/, '');
      const nombre = limpiarNombre(textoCelda(fila.getCell(colNombre)));
      if (!codigo && !nombre) continue;
      if (!/^\d{1,20}$/.test(codigo)) { errores.push(`Fila ${r}: código inválido`); continue; }
      if (!nombre || nombre.length > 200) { errores.push(`Fila ${r}: nombre vacío o demasiado largo`); continue; }
      if (vistos.has(codigo)) { errores.push(`Fila ${r}: el código ${codigo} está repetido`); continue; }
      vistos.add(codigo);
      personas.push({ codigo, nombre });
    }
    if (errores.length) throw fallo(`Corrija el archivo antes de cargarlo: ${errores.slice(0, 5).join('; ')}${errores.length > 5 ? ` y ${errores.length - 5} más` : ''}.`);
    if (!personas.length) throw fallo('El archivo no tiene personas para cargar.');
    if (personas.length > MAXIMO) throw fallo(`El archivo supera el máximo de ${MAXIMO} personas.`);
    return personas;
  }
  throw fallo('No se encontraron las columnas "COD TRAB" y "Apellidos y Nombre".');
}

// Agrega o actualiza a cada persona. Quien no viene en el archivo se conserva, pero queda inactivo
// solo si se pide expresamente, para no perder a nadie por un archivo incompleto.
async function importar(pool, personas, usuarioId, { desactivarAusentes = false, empresa = EMPRESA } = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [actuales] = await conn.query('SELECT codigo, nombre, activo FROM rh_personal WHERE empresa = ? FOR UPDATE', [empresa]);
    const previos = new Map(actuales.map(p => [p.codigo, p]));
    let nuevos = 0, actualizados = 0, sinCambios = 0;
    for (const p of personas) {
      const previo = previos.get(p.codigo);
      if (!previo) nuevos++;
      else if (previo.nombre !== p.nombre || !Number(previo.activo)) actualizados++;
      else { sinCambios++; continue; }
      await conn.query(`INSERT INTO rh_personal (empresa, codigo, nombre, activo, actualizado_por) VALUES (?, ?, ?, 1, ?)
        ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), activo = 1, actualizado_por = VALUES(actualizado_por)`, [empresa, p.codigo, p.nombre, usuarioId || null]);
    }
    const enArchivo = new Set(personas.map(p => p.codigo));
    const ausentes = actuales.filter(p => Number(p.activo) && !enArchivo.has(p.codigo)).map(p => p.codigo);
    if (desactivarAusentes && ausentes.length) {
      await conn.query(`UPDATE rh_personal SET activo = 0, actualizado_por = ? WHERE empresa = ? AND codigo IN (${ausentes.map(() => '?').join(',')})`, [usuarioId || null, empresa, ...ausentes]);
    }
    await conn.commit();
    return { total: personas.length, nuevos, actualizados, sinCambios, ausentes: ausentes.length, desactivados: desactivarAusentes ? ausentes.length : 0 };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

// Lista con indicador de acceso al sistema (mismo código de trabajador en los carnets).
async function listar(pool, { q = '', estado = 'activos', empresa = EMPRESA } = {}) {
  const filtros = ['p.empresa = ?'], params = [empresa];
  if (estado === 'activos') filtros.push('p.activo = 1');
  if (estado === 'inactivos') filtros.push('p.activo = 0');
  const busqueda = String(q || '').trim().slice(0, 80);
  if (busqueda) { filtros.push('(p.codigo LIKE ? OR p.nombre LIKE ?)'); params.push(`${busqueda}%`, `%${busqueda}%`); }
  let accesos = new Set();
  try {
    const [filas] = await pool.query("SELECT DISTINCT TRIM(codigo_trabajador) codigo FROM usuario_cedulas WHERE codigo_trabajador IS NOT NULL AND codigo_trabajador <> ''");
    accesos = new Set(filas.map(f => String(f.codigo)));
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
  }
  const [personas] = await pool.query(`SELECT p.codigo, p.nombre, p.activo, p.actualizado_en FROM rh_personal p
    WHERE ${filtros.join(' AND ')} ORDER BY p.nombre`, params);
  const [[totales]] = await pool.query('SELECT SUM(activo = 1) activos, SUM(activo = 0) inactivos FROM rh_personal WHERE empresa = ?', [empresa]);
  return {
    personas: personas.map(p => ({ ...p, conAcceso: accesos.has(String(p.codigo)) })),
    totales: { activos: Number(totales?.activos || 0), inactivos: Number(totales?.inactivos || 0) }
  };
}

async function contarActivos(pool, empresa = EMPRESA) {
  try {
    const [[fila]] = await pool.query('SELECT COUNT(*) total FROM rh_personal WHERE empresa = ? AND activo = 1', [empresa]);
    return Number(fila.total || 0);
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') return 0;
    throw error;
  }
}

module.exports = { EMPRESA, leerExcel, importar, listar, contarActivos };
