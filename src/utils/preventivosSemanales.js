const DIA_MS = 86400000;

function hoyCostaRica(fecha = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(fecha);
}

function fechaValida(valor) {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return Number.isFinite(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

function sumarDias(fecha, dias) {
  return new Date(new Date(`${fecha}T00:00:00Z`).getTime() + dias * DIA_MS).toISOString().slice(0, 10);
}

function lunesSemana(fecha) {
  const dia = new Date(`${fecha}T00:00:00Z`).getUTCDay();
  return sumarDias(fecha, dia === 0 ? -6 : 1 - dia);
}

function fechasProgramadas(inicio, intervalo, desde, hasta) {
  if (![inicio, desde, hasta].every(fechaValida) || !Number.isInteger(Number(intervalo)) || Number(intervalo) < 1 || Number(intervalo) > 52) {
    throw new Error("Programación semanal inválida.");
  }
  const paso = Number(intervalo) * 7;
  const distancia = (new Date(`${desde}T00:00:00Z`) - new Date(`${inicio}T00:00:00Z`)) / DIA_MS;
  let fecha = sumarDias(inicio, Math.max(0, Math.ceil(distancia / paso)) * paso);
  const fechas = [];
  while (fecha <= hasta) {
    fechas.push(fecha);
    fecha = sumarDias(fecha, paso);
  }
  return fechas;
}

function puedeProgramar(user) {
  return ["ADMIN", "TALLER", "PROVEEDURIA_TALLER"].includes(user?.rol);
}

let esquemaPendiente;
function asegurarProgramacionSemanal(pool) {
  if (!esquemaPendiente) {
    esquemaPendiente = pool.query(`CREATE TABLE IF NOT EXISTS preventivos_programaciones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      unidad_id INT NOT NULL,
      fecha_inicio DATE NOT NULL,
      intervalo_semanas INT NOT NULL,
      plan TEXT NULL,
      activa TINYINT(1) NOT NULL DEFAULT 1,
      procesada_hasta DATE NOT NULL,
      version INT NOT NULL DEFAULT 1,
      creado_por INT NULL,
      actualizado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_preventivos_programaciones_unidad (unidad_id),
      INDEX idx_preventivos_programaciones_pendientes (activa, procesada_hasta)
    )`).catch(error => { esquemaPendiente = null; throw error; });
  }
  return esquemaPendiente;
}

async function generarPreventivos(pool, hoy = hoyCostaRica()) {
  if (!fechaValida(hoy)) throw new Error("Fecha de generación inválida.");
  const [programaciones] = await pool.query(
    `SELECT p.id, p.unidad_id FROM preventivos_programaciones p
     JOIN unidades u ON u.id = p.unidad_id
     WHERE p.activa = 1 AND COALESCE(u.activa, 1) = 1
       AND p.procesada_hasta < ? AND p.fecha_inicio <= ?
     ORDER BY p.id`, [hoy, hoy]
  );
  let creados = 0;
  for (const programacion of programaciones) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[unidad]] = await connection.query(
        "SELECT id, sede FROM unidades WHERE id = ? AND COALESCE(activa, 1) = 1 FOR UPDATE", [programacion.unidad_id]
      );
      if (!unidad) { await connection.commit(); continue; }
      const [[regla]] = await connection.query(
        `SELECT p.*, DATE_FORMAT(p.fecha_inicio, '%Y-%m-%d') AS inicio,
                DATE_FORMAT(p.procesada_hasta, '%Y-%m-%d') AS procesada
         FROM preventivos_programaciones p
         WHERE p.id = ? AND p.activa = 1 FOR UPDATE`, [programacion.id]
      );
      if (!regla || regla.procesada >= hoy) {
        await connection.commit();
        continue;
      }
      // Bound catch-up per transaction; the cursor retains the rest for the next run.
      const desde = [sumarDias(regla.procesada, 1), regla.inicio].sort()[1];
      const hasta = [sumarDias(desde, 365), hoy].sort()[0];
      let nuevos = 0;
      for (const fecha of fechasProgramadas(regla.inicio, regla.intervalo_semanas, desde, hasta)) {
        const [[existente]] = await connection.query(
          `SELECT id FROM mantenimientos WHERE unidad_id = ? AND tipo = 'PREVENTIVO'
           AND fecha_programada >= ? AND fecha_programada < ? LIMIT 1`,
          [regla.unidad_id, fecha, sumarDias(fecha, 1)]
        );
        if (existente) continue;
        const [insert] = await connection.query(
          `INSERT INTO mantenimientos
           (unidad_id, sede, tipo, estado, prioridad, fecha_programada, plan, creado_por)
           VALUES (?, ?, 'PREVENTIVO', 'PROGRAMADO', 'MEDIA', ?, ?, ?)`,
          [regla.unidad_id, unidad.sede, fecha, regla.plan || null, regla.actualizado_por || regla.creado_por]
        );
        await connection.query(
          `UPDATE mantenimientos SET numero_mantenimiento = CONCAT('MANT-', YEAR(fecha_programada), '-', LPAD(id, 6, '0')) WHERE id = ?`,
          [insert.insertId]
        );
        nuevos += 1;
      }
      await connection.query("UPDATE preventivos_programaciones SET procesada_hasta = ? WHERE id = ?", [hasta, regla.id]);
      await connection.commit();
      creados += nuevos;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }
  return creados;
}

module.exports = { hoyCostaRica, fechaValida, sumarDias, lunesSemana, fechasProgramadas, puedeProgramar, generarPreventivos, asegurarProgramacionSemanal };
