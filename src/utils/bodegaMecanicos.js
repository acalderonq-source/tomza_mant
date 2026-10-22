// Mecánicos que pueden recibir artículos en Bodega: las personas ligadas por cédula
// a las cuentas con rol MECANICO. No se aceptan nombres escritos a mano.
// Solo Taller central: Cartago y Transportadora; los mecánicos de las CEDIs no aparecen.
const SEDES_BODEGA = ['Cartago', 'Transportadora'];
async function listarMecanicos(db) {
  const [rows] = await db.query(`SELECT TRIM(uc.persona_nombre) AS nombre, u.sede
    FROM usuario_cedulas uc JOIN usuarios u ON u.id = uc.usuario_id
    WHERE u.rol = 'MECANICO' AND TRIM(COALESCE(uc.persona_nombre, '')) <> '' AND u.sede IN (?)
    ORDER BY nombre, u.sede`, [SEDES_BODEGA]);
  const porNombre = new Map();
  for (const r of rows) {
    const nombre = String(r.nombre).replace(/\s+/g, ' ').slice(0, 120);
    const actual = porNombre.get(nombre) || { nombre, sedes: [] };
    if (r.sede && !actual.sedes.includes(r.sede)) actual.sedes.push(r.sede);
    porNombre.set(nombre, actual);
  }
  return [...porNombre.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

async function mecanicoValido(db, nombre) {
  const buscado = String(nombre || '').replace(/\s+/g, ' ').trim();
  if (!buscado) return null;
  return (await listarMecanicos(db)).find(m => m.nombre === buscado) || null;
}

module.exports = { listarMecanicos, mecanicoValido, SEDES_BODEGA };
