const express = require("express");
const router = express.Router();
const pool = require("../db");
const { ensureNumeroMantenimientoColumn, asignarNumeroMantenimiento } = require("../utils/mantenimientosNumero");

const SEDES_REPARTO_SEMANAL = new Set(["NICOYA", "RIO_CLARO"]);
const CUPOS_PREVENTIVOS_POR_DIA = {
  CARTAGO: 5,
  LA_CRUZ: 2
};

// devuelve siguiente día hábil (sin sábado ni domingo)
function siguienteDiaHabil(fecha) {
  const f = new Date(fecha);
  do {
    f.setDate(f.getDate() + 1);
  } while (f.getDay() === 0 || f.getDay() === 6); // 0=domingo,6=sábado
  return f.toISOString().slice(0, 10);
}

function normalizarSedeAgenda(sede) {
  return String(sede || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, "_")
    .trim();
}

function esDiaHabil(fecha) {
  const dia = new Date(fecha).getDay();
  return dia !== 0 && dia !== 6;
}

function primerDiaHabil(fecha) {
  return esDiaHabil(fecha) ? fecha : siguienteDiaHabil(fecha);
}

function obtenerDiasHabiles(fechaInicio, cantidad) {
  const dias = [primerDiaHabil(fechaInicio)];
  while (dias.length < cantidad) {
    dias.push(siguienteDiaHabil(dias[dias.length - 1]));
  }
  return dias;
}

function fechaProgramadaPreventivo({ sede, indice, total, fechaInicio }) {
  const sedeNormalizada = normalizarSedeAgenda(sede);

  if (SEDES_REPARTO_SEMANAL.has(sedeNormalizada)) {
    const diasSemana = obtenerDiasHabiles(fechaInicio, 5);
    const cupoSemana = Math.max(1, Math.ceil(total / diasSemana.length));
    const indiceDia = Math.min(diasSemana.length - 1, Math.floor(indice / cupoSemana));
    return diasSemana[indiceDia];
  }

  const cupoDiario = CUPOS_PREVENTIVOS_POR_DIA[sedeNormalizada] || 1;
  const saltoDias = Math.floor(indice / cupoDiario);
  return obtenerDiasHabiles(fechaInicio, saltoDias + 1)[saltoDias];
}

router.post("/admin/regenerar-agenda", async (req, res) => {
  try {
    if (!req.session.user || req.session.user.rol !== "ADMIN") {
      return res.status(403).send("No autorizado");
    }

    const sedeSeleccionada = req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS"
      ? req.session.sedeSeleccionada
      : null;
    const sedeAdmin = req.session.user.sede && req.session.user.sede !== "TODAS"
      ? req.session.user.sede
      : null;
    const sedeObjetivo = sedeSeleccionada || sedeAdmin;

    // 1) BORRAR SOLO PENDIENTES DE SU SEDE (o todos si es super admin)
    if (sedeObjetivo) {
      await pool.query(`
        DELETE m FROM mantenimientos m
        JOIN unidades u ON u.id = m.unidad_id
        WHERE m.estado != 'CERRADO'
          AND u.sede = ?
      `, [sedeObjetivo]);
    } else {
      await pool.query(`
        DELETE FROM mantenimientos
        WHERE estado != 'CERRADO'
      `);
    }

    let unidadesSql = `
      SELECT id, sede
      FROM unidades
      WHERE sede IS NOT NULL
        AND TRIM(sede) <> ''
    `;
    const unidadesParams = [];
    if (sedeObjetivo) {
      unidadesSql += " AND sede = ?";
      unidadesParams.push(sedeObjetivo);
    }
    unidadesSql += " ORDER BY sede, id";
    const [unidades] = await pool.query(unidadesSql, unidadesParams);

    // fecha inicio = hoy CR
    const hoy = new Date();
    hoy.setHours(hoy.getHours() - 6);
    const fechaInicio = hoy.toISOString().slice(0, 10);

    await ensureNumeroMantenimientoColumn(pool);

    const unidadesPorSede = unidades.reduce((acc, unidad) => {
      const sede = unidad.sede || "Sin sede";
      if (!acc.has(sede)) acc.set(sede, []);
      acc.get(sede).push(unidad);
      return acc;
    }, new Map());

    for (const [sede, unidadesSede] of unidadesPorSede.entries()) {
      for (const [indice, unidad] of unidadesSede.entries()) {
        const fechaProgramada = fechaProgramadaPreventivo({
          sede,
          indice,
          total: unidadesSede.length,
          fechaInicio
        });

        const [result] = await pool.query(`
          INSERT INTO mantenimientos
            (unidad_id, sede, tipo, estado, prioridad, fecha_programada)
          VALUES (?, ?, 'PREVENTIVO', 'PROGRAMADO', 'MEDIA', ?)
        `, [unidad.id, sede, fechaProgramada]);
        await asignarNumeroMantenimiento(pool, result.insertId);
      }
    }

    res.redirect("/agenda/semana");

  } catch (error) {
    console.error("❌ Error regenerando agenda:", error);
    res.status(500).send("Error regenerando agenda");
  }
});

module.exports = router;
