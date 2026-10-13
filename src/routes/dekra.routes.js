const express = require("express");
const router = express.Router();
const pool = require("../db");
const { esUsuarioTodasSedes, sedeGranelDesdeUsuario } = require("../utils/sedes");
const { obtenerCorreosSupervisores, enviarAvisoCitaDekra } = require("../utils/dekraMail");

const mesesPorCiclo = {
  "ENE-JUL": ["Enero", "Julio"],
  "FEB-AGO": ["Febrero", "Agosto"],
  "MAR-SET": ["Marzo", "Setiembre"],
  "ABR-OCT": ["Abril", "Octubre"],
  "MAY-NOV": ["Mayo", "Noviembre"],
  "JUN-DIC": ["Junio", "Diciembre"]
};
const numeroMesPorNombre = {
  Enero: 1, Febrero: 2, Marzo: 3, Abril: 4, Mayo: 5, Junio: 6,
  Julio: 7, Agosto: 8, Setiembre: 9, Octubre: 10, Noviembre: 11, Diciembre: 12
};

const camposCitaPorSlot = {
  primera: {
    fecha: "cita_fecha", hora: "cita_hora", lugar: "cita_lugar", estado: "estado",
    observacion: "observacion", recordatorio15: "recordatorio_15d_enviado", recordatorio2: "recordatorio_2d_enviado"
  },
  segunda: {
    fecha: "cita_fecha_segunda", hora: "cita_hora_segunda", lugar: "cita_lugar_segunda", estado: "estado_segunda",
    observacion: "observacion_segunda", recordatorio15: "recordatorio_15d_segundo_enviado", recordatorio2: "recordatorio_2d_segundo_enviado"
  }
};

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function obtenerSedeFiltro(req) {

  if (!req.session.user) {
    return null;
  }

  const sedeGranel = sedeGranelDesdeUsuario(req.session.user);
  if (sedeGranel) return sedeGranel;

  // =========================
  // ADMIN
  // =========================
  if (esUsuarioTodasSedes(req.session.user)) {

    if (
      req.session.sedeSeleccionada &&
      req.session.sedeSeleccionada !== "TODAS"
    ) {

      return req.session.sedeSeleccionada;

    }

    return null;

  }

  // =========================
  // MULTI-SEDE
  // =========================
  return (
    req.session.sedeSeleccionada ||
    req.session.user.sede
  );

}

async function registroAutorizado(req, id) {
  const [[registro]] = await pool.query(
    `SELECT d.sede, u.sede AS unidad_sede
     FROM dekra_control d JOIN unidades u ON u.id = d.unidad_id
     WHERE d.id = ? LIMIT 1`,
    [id]
  );
  if (!registro) return { error: 404 };
  const sedeFiltro = obtenerSedeFiltro(req);
  if (sedeFiltro && (registro.sede !== sedeFiltro || registro.unidad_sede !== sedeFiltro)) {
    return { error: 403 };
  }
  return { registro };
}
// =========================
// LISTADO DEKRA
// =========================
router.get("/", requireAuth, async (req, res) => {
  try {
    const sedeFiltroSesion = obtenerSedeFiltro(req);
    let sedesDisponibles = [];
    if (sedeFiltroSesion) {
      sedesDisponibles = [sedeFiltroSesion];
    } else if (esUsuarioTodasSedes(req.session.user)) {
      const [sedes] = await pool.query(`
        SELECT DISTINCT sede
        FROM dekra_control
        WHERE sede IS NOT NULL AND TRIM(sede) <> ''
        ORDER BY sede
      `);
      sedesDisponibles = sedes.map(row => row.sede);
    }
    const sedeSolicitada = String(req.query.sede || "").trim();
    const sedeFiltro = sedeFiltroSesion || (sedesDisponibles.includes(sedeSolicitada) ? sedeSolicitada : "");
    const mes = req.query.mes || "";
    const negocio = req.query.negocio || "";
    const estado = req.query.estado || "";

    let sql = `
      SELECT
        d.id,
        u.placa,
        d.sede,
        d.mes,
        d.negocio,
        d.estado,
        d.estado_segunda,
        d.observacion,
        d.observacion_segunda,
        DATE_FORMAT(d.cita_fecha, '%Y-%m-%d') AS cita_fecha,
        TIME_FORMAT(d.cita_hora, '%H:%i') AS cita_hora,
        d.cita_lugar,
        DATE_FORMAT(d.cita_fecha_segunda, '%Y-%m-%d') AS cita_fecha_segunda,
        TIME_FORMAT(d.cita_hora_segunda, '%H:%i') AS cita_hora_segunda,
        d.cita_lugar_segunda,
        d.cita_correos,
        DATE_FORMAT(d.fecha_registro, '%d/%m/%Y %H:%i') AS fecha_registro
      FROM dekra_control d
      JOIN unidades u ON u.id = d.unidad_id
      WHERE 1=1
    `;

    const params = [];

    if (sedeFiltro) {
      sql += ` AND d.sede = ?`;
      params.push(sedeFiltro);
      if (sedeGranelDesdeUsuario(req.session.user)) {
        sql += ` AND u.sede = ?`;
        params.push(sedeFiltro);
      }
    }

    if (mes) {
      sql += ` AND d.mes = ?`;
      params.push(mes);
    }

    if (negocio) {
      sql += ` AND d.negocio = ?`;
      params.push(negocio);
    }

    if (estado) {
      sql += ` AND (d.estado = ? OR d.estado_segunda = ?)`;
      params.push(estado, estado);
    }

    sql += ` ORDER BY d.sede, d.mes, d.negocio, u.placa`;

    const [rows] = await pool.query(sql, params);
    rows.forEach(row => {
      row.correos_sugeridos = row.cita_correos || obtenerCorreosSupervisores(row.sede, row.negocio).join(", ");
    });
    const resumen = rows.reduce((acc, item) => {
      for (const estadoRevision of [item.estado, item.estado_segunda]) {
        acc.total += 1;
        if (estadoRevision === "REALIZADO") acc.realizados += 1;
        if (estadoRevision === "NO_REALIZADO") acc.noRealizados += 1;
        if (estadoRevision === "PENDIENTE") acc.pendientes += 1;
      }
      return acc;
    }, { total: 0, realizados: 0, noRealizados: 0, pendientes: 0 });

    resumen.cumplimiento = resumen.total
      ? Math.round((resumen.realizados / resumen.total) * 100)
      : 0;

    res.render("dekra", {
      registros: rows,
      user: req.session.user,
      mesSeleccionado: mes,
      negocioSeleccionado: negocio,
      estadoSeleccionado: estado,
      resumen,
      sedesDisponibles,
      sedeSeleccionada: sedeFiltro || "TODAS",
      citaAviso: req.query.cita || "",
      mesesPorCiclo,
      hoyCostaRica: new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" })
    });
  } catch (error) {
    console.error("❌ Error cargando DEKRA:", error);
    res.status(500).send("Error interno");
  }
});

// =========================
// FORM NUEVO REGISTRO
// =========================
router.get("/nuevo", requireAuth, async (req, res) => {
  try {
    const sedeFiltro = obtenerSedeFiltro(req);

    let sql = `SELECT id, placa, sede FROM unidades WHERE activa = 1`;
    const params = [];

    if (sedeFiltro) {
      sql += ` AND sede = ?`;
      params.push(sedeFiltro);
    }

    sql += ` ORDER BY sede, placa`;

    const [unidades] = await pool.query(sql, params);

    res.render("dekra_nuevo", {
      unidades,
      user: req.session.user
    });
  } catch (error) {
    console.error("❌ Error formulario DEKRA:", error);
    res.status(500).send("Error interno");
  }
});

// =========================
// GUARDAR NUEVO REGISTRO
// =========================
router.post("/nuevo", requireAuth, async (req, res) => {
  try {
    const { unidad_id, mes, negocio } = req.body;

    if (!unidad_id || !mes || !negocio) {
      return res.status(400).send("Datos incompletos");
    }

    const [[unidad]] = await pool.query(
      `SELECT id, sede FROM unidades WHERE id = ? LIMIT 1`,
      [unidad_id]
    );

    if (!unidad) {
      return res.status(404).send("Unidad no encontrada");
    }
    const sedeFiltro = obtenerSedeFiltro(req);
    if (sedeFiltro && unidad.sede !== sedeFiltro) {
      return res.status(403).send("No autorizado para esta sede");
    }

    await pool.query(
      `
      INSERT INTO dekra_control (unidad_id, sede, mes, negocio, estado, actualizado_por)
      VALUES (?, ?, ?, ?, 'PENDIENTE', ?)
      `,
      [unidad.id, unidad.sede, mes, negocio, req.session.user.id]
    );

    res.redirect("/dekra");
  } catch (error) {
    console.error("❌ Error guardando DEKRA:", error);
    res.status(500).send("Error interno");
  }
});

async function guardarCita(req, res, slot) {
  try {
    if (["SUPERVISOR", "SUPERVISOR_PESADO"].includes(req.session.user.rol)) {
      return res.sendStatus(403);
    }
    const campos = camposCitaPorSlot[slot];
    if (!campos) return res.sendStatus(404);
    const permiso = await registroAutorizado(req, req.params.id);
    if (permiso.error) return res.sendStatus(permiso.error);

    const { fecha, hora, lugar } = req.body;
    const fechaValida = typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha) &&
      !Number.isNaN(Date.parse(`${fecha}T12:00:00Z`)) &&
      new Date(`${fecha}T12:00:00Z`).toISOString().slice(0, 10) === fecha;
    const hoyCostaRica = new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
    if (!fechaValida || fecha < hoyCostaRica) {
      return res.status(400).send("Seleccione una fecha de cita válida, igual o posterior a hoy.");
    }
    if (hora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) {
      return res.status(400).send("La hora de la cita no es válida.");
    }
    if (String(lugar || "").trim().length > 200) {
      return res.status(400).send("El lugar de inspección no puede superar 200 caracteres.");
    }

    const [[registro]] = await pool.query(
      `SELECT d.id, d.sede, d.negocio, d.mes, d.${campos.estado} AS estado, u.placa
       FROM dekra_control d JOIN unidades u ON u.id = d.unidad_id WHERE d.id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!["PENDIENTE", "NO_REALIZADO"].includes(registro.estado)) {
      return res.status(409).send("Solo se pueden programar citas para revisiones pendientes o no realizadas.");
    }
    const correosBase = obtenerCorreosSupervisores(registro.sede, registro.negocio);
    const correosIngresados = String(req.body.correos || "")
      .split(/[;,\s]+/).map(email => email.trim()).filter(Boolean);
    const destinatarios = [...new Set([...correosBase, ...correosIngresados].map(email => email.toLowerCase()))];
    const correoValido = destinatarios.every(email => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email));
    if (!destinatarios.length || !correoValido) {
      return res.status(400).send("Agregue al menos un correo válido de supervisor.");
    }

    const meses = mesesPorCiclo[registro.mes];
    const indiceMes = slot === "primera" ? 0 : 1;
    const mesEsperado = numeroMesPorNombre[meses?.[indiceMes]];
    if (!mesEsperado || Number(fecha.slice(5, 7)) !== mesEsperado) {
      return res.status(400).send(`La fecha de esta cita debe quedar dentro del mes de ${meses?.[indiceMes] || "revisión"}.`);
    }
    await pool.query(
      `UPDATE dekra_control
       SET ${campos.fecha} = ?, ${campos.hora} = ?, ${campos.lugar} = ?, cita_correos = ?,
           ${campos.estado} = 'PENDIENTE', ${campos.observacion} = NULL,
           ${campos.recordatorio15} = 0, ${campos.recordatorio2} = 0,
           actualizado_por = ?, fecha_actualizacion = NOW()
       WHERE id = ?`,
      [fecha, hora || null, lugar?.trim() || null, destinatarios.join(","), req.session.user.id, req.params.id]
    );

    const aviso = await enviarAvisoCitaDekra({
      ...registro,
      cita_fecha: fecha,
      cita_hora: hora,
      cita_lugar: lugar,
      mes_revision: meses?.[indiceMes] || `Revisión ${indiceMes + 1}`
    }, destinatarios);
    res.redirect(`/dekra?cita=${aviso ? "enviada" : "correo_error"}`);
  } catch (error) {
    console.error("❌ Error programando cita DEKRA:", error);
    res.status(500).send("No se pudo programar la cita DEKRA.");
  }
}

router.post("/:id/cita", requireAuth, (req, res) => guardarCita(req, res, "primera"));
router.post("/:id/cita/:slot", requireAuth, (req, res) => guardarCita(req, res, req.params.slot));

// =========================
// MARCAR COMO REALIZADO
// =========================
router.post("/:id/realizado", requireAuth, async (req, res) => {
  try {
    if (["SUPERVISOR", "SUPERVISOR_PESADO"].includes(req.session.user.rol)) return res.sendStatus(403);
    const permiso = await registroAutorizado(req, req.params.id);
    if (permiso.error) return res.sendStatus(permiso.error);
    await pool.query(
      `
      UPDATE dekra_control
      SET estado = 'REALIZADO',
          observacion = NULL,
          actualizado_por = ?,
          fecha_actualizacion = NOW()
      WHERE id = ?
      `,
      [req.session.user.id, req.params.id]
    );

    res.redirect("/dekra");
  } catch (error) {
    console.error("❌ Error marcando realizado:", error);
    res.status(500).send("Error interno");
  }
});

// =========================
// MARCAR COMO NO REALIZADO
// =========================
router.post("/:id/no-realizado", requireAuth, async (req, res) => {
  try {
    if (["SUPERVISOR", "SUPERVISOR_PESADO"].includes(req.session.user.rol)) return res.sendStatus(403);
    const { observacion } = req.body;

    if (!observacion || !observacion.trim()) {
      return res.status(400).send("Debe indicar el motivo");
    }

    const permiso = await registroAutorizado(req, req.params.id);
    if (permiso.error) return res.sendStatus(permiso.error);

    await pool.query(
      `
      UPDATE dekra_control
      SET estado = 'NO_REALIZADO',
          observacion = ?,
          actualizado_por = ?,
          fecha_actualizacion = NOW()
      WHERE id = ?
      `,
      [observacion.trim(), req.session.user.id, req.params.id]
    );

    res.redirect("/dekra");
  } catch (error) {
    console.error("❌ Error marcando no realizado:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/:id/:slot/realizado", requireAuth, async (req, res) => {
  try {
    if (["SUPERVISOR", "SUPERVISOR_PESADO"].includes(req.session.user.rol)) return res.sendStatus(403);
    const campos = camposCitaPorSlot[req.params.slot];
    if (!campos) return res.sendStatus(404);
    const permiso = await registroAutorizado(req, req.params.id);
    if (permiso.error) return res.sendStatus(permiso.error);
    await pool.query(
      `UPDATE dekra_control SET ${campos.estado} = 'REALIZADO', ${campos.observacion} = NULL,
       actualizado_por = ?, fecha_actualizacion = NOW() WHERE id = ?`,
      [req.session.user.id, req.params.id]
    );
    res.redirect("/dekra");
  } catch (error) {
    console.error("❌ Error marcando revisión DEKRA realizada:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/:id/:slot/no-realizado", requireAuth, async (req, res) => {
  try {
    if (["SUPERVISOR", "SUPERVISOR_PESADO"].includes(req.session.user.rol)) return res.sendStatus(403);
    const campos = camposCitaPorSlot[req.params.slot];
    if (!campos) return res.sendStatus(404);
    const observacion = String(req.body.observacion || "").trim();
    if (!observacion) return res.status(400).send("Debe indicar el motivo");
    const permiso = await registroAutorizado(req, req.params.id);
    if (permiso.error) return res.sendStatus(permiso.error);
    await pool.query(
      `UPDATE dekra_control SET ${campos.estado} = 'NO_REALIZADO', ${campos.observacion} = ?,
       actualizado_por = ?, fecha_actualizacion = NOW() WHERE id = ?`,
      [observacion, req.session.user.id, req.params.id]
    );
    res.redirect("/dekra");
  } catch (error) {
    console.error("❌ Error marcando revisión DEKRA no realizada:", error);
    res.status(500).send("Error interno");
  }
});

module.exports = router;
