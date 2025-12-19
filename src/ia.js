const pool = require("./db");

/**
 * Genera agenda automática:
 * - 5 unidades por día
 * - recorre TODAS las placas
 * - cuando llega al final, vuelve al inicio
 */
async function generarAgenda(fechaISO, sede = "CARTAGO") {

  // 1. Obtener TODAS las unidades ordenadas
  const [unidades] = await pool.query(
    "SELECT id FROM unidades WHERE sede=? ORDER BY id",
    [sede]
  );

  if (unidades.length === 0) return;

  // 2. Leer control de agenda
  const [[control]] = await pool.query(
    "SELECT ultimo_unidad_id FROM agenda_control WHERE id=1"
  );

  let startIndex = 0;

  if (control.ultimo_unidad_id !== 0) {
    const idx = unidades.findIndex(u => u.id === control.ultimo_unidad_id);
    startIndex = idx === -1 ? 0 : idx + 1;
  }

  // 3. Seleccionar 5 unidades en ciclo
  const seleccionadas = [];
  let i = startIndex;

  while (seleccionadas.length < 5) {
    if (i >= unidades.length) i = 0;
    seleccionadas.push(unidades[i]);
    i++;
  }

  // 4. Guardar mantenimientos del día
  for (const u of seleccionadas) {
    await pool.query(
      `
      INSERT INTO mantenimientos (unidad_id, fecha_programada, tipo, estado, generado_por)
      VALUES (?, ?, 'PREVENTIVO', 'PROGRAMADO', 'IA')
      `,
      [u.id, fechaISO]
    );
  }

  // 5. Actualizar control (última placa usada)
  const ultimo = seleccionadas[seleccionadas.length - 1].id;

  await pool.query(
    "UPDATE agenda_control SET ultimo_unidad_id=? WHERE id=1",
    [ultimo]
  );
}

module.exports = { generarAgenda };
