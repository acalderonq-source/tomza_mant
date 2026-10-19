const express = require("express");
const pool = require("../db");
const { asegurarEliminaciones } = require('../utils/preventivosEliminacion');
const { getSedesPermitidas, esUsuarioTodasSedes, etiquetaSede } = require("../utils/sedes");
const { hoyCostaRica, fechaValida, sumarDias, lunesSemana, fechasProgramadas, puedeProgramar, generarPreventivos, asegurarProgramacionSemanal, repartirUnidadesSemana, sedeAdmitePreventivos } = require("../utils/preventivosSemanales");
const { ensureNumeroMantenimientoColumn } = require("../utils/mantenimientosNumero");
const router = express.Router();

router.use((req, res, next) => {
  if (!req.session.user) return res.redirect("/login");
  next();
});

router.get("/", async (req, res) => {
  try {
    await asegurarProgramacionSemanal(pool);
    await asegurarEliminaciones(pool);
    const hoy = hoyCostaRica();
    const semana = lunesSemana(fechaValida(req.query.semana) ? req.query.semana : hoy);
    const fin = sumarDias(semana, 6);
    const todas = esUsuarioTodasSedes(req.session.user);
    const permitidas = getSedesPermitidas(req);
    const condiciones = ["COALESCE(u.activa, 1) = 1"];
    const params = [];
    if (!todas) {
      condiciones.push("u.sede IN (?)");
      params.push(permitidas.length ? permitidas : [""]);
    }
    const [unidades] = await pool.query(
      `SELECT u.id, u.placa, u.sede, p.id AS programacion_id, p.intervalo_semanas, p.plan,
              p.activa AS programacion_activa, p.version,
              DATE_FORMAT(p.fecha_inicio, '%Y-%m-%d') AS fecha_inicio
       FROM unidades u LEFT JOIN preventivos_programaciones p ON p.unidad_id = u.id
       WHERE ${condiciones.join(" AND ")} ORDER BY u.sede, u.placa`, params
    );
    const elegibles = unidades.filter(unidad => sedeAdmitePreventivos(unidad.sede));
    const sedes = [...new Set(elegibles.map(unidad => unidad.sede))];
    const sede = sedes.includes(req.query.sede) ? req.query.sede : "";
    const visibles = elegibles.filter(unidad => !sede || unidad.sede === sede);
    const ids = visibles.map(unidad => unidad.id);
    const [mantenimientos] = ids.length ? await pool.query(
      `SELECT id, unidad_id, estado, numero_mantenimiento, DATE_FORMAT(fecha_programada, '%Y-%m-%d') AS fecha
       FROM mantenimientos WHERE tipo = 'PREVENTIVO' AND unidad_id IN (?)
         AND fecha_programada >= ? AND fecha_programada < ? ORDER BY fecha_programada, id`,
      [ids, semana, sumarDias(fin, 1)]
    ) : [[]];
    const porUnidad = new Map();
    const [eliminados]=ids.length?await pool.query('SELECT unidad_id, DATE_FORMAT(fecha,\'%Y-%m-%d\') AS fecha FROM preventivos_eliminados WHERE unidad_id IN (?) AND fecha>=? AND fecha<?',[ids,semana,sumarDias(fin,1)]):[[]];
    const omitidos=new Set(eliminados.map(m=>`${m.unidad_id}:${m.fecha}`));
    for (const mantenimiento of mantenimientos) {
      if (!porUnidad.has(mantenimiento.unidad_id)) porUnidad.set(mantenimiento.unidad_id, []);
      porUnidad.get(mantenimiento.unidad_id).push(mantenimiento);
    }
    const filas = visibles.map(unidad => {
      const trabajos = porUnidad.get(unidad.id) || [];
      const previstas = unidad.programacion_activa
        ? fechasProgramadas(unidad.fecha_inicio, unidad.intervalo_semanas, semana, fin)
        : [];
      return { ...unidad, trabajos, previstas: previstas.filter(fecha => !omitidos.has(`${unidad.id}:${fecha}`) && !trabajos.some(trabajo => trabajo.fecha === fecha)) };
    });
    const resumen = {
      unidades: filas.length,
      conFrecuencia: filas.filter(unidad => unidad.programacion_activa).length,
      estaSemana: filas.filter(unidad => unidad.trabajos.length || unidad.previstas.length).length,
      cerrados: mantenimientos.filter(mantenimiento => mantenimiento.estado === "CERRADO").length
    };
    const success = req.session.preventivosSuccess;
    const error = req.session.preventivosError;
    delete req.session.preventivosSuccess;
    delete req.session.preventivosError;
    res.render("preventivos_semana", {
      filas, resumen, semana, fin, anterior: sumarDias(semana, -7), siguiente: sumarDias(semana, 7),
      hoy, sedes, sede, etiquetaSede, puedeProgramar: puedeProgramar(req.session.user), success, error
    });
  } catch (error) {
    console.error("Error cargando preventivos semanales:", error);
    res.status(500).send("No se pudo cargar la programación semanal de preventivos.");
  }
});

router.post("/automatico", async (req, res) => {
  if (!puedeProgramar(req.session.user)) return res.status(403).send("No autorizado para programar preventivos.");
  if (!fechaValida(req.body.semana) || typeof req.body.sede !== "string" || req.body.sede.length > 100) {
    return res.status(400).send("Revise la semana y la sede seleccionadas.");
  }
  const hoy = hoyCostaRica();
  const seleccionada = lunesSemana(req.body.semana);
  const inicio = seleccionada < hoy ? sumarDias(lunesSemana(hoy), 7) : seleccionada;
  const sede = req.body.sede.trim();
  if (sede && !sedeAdmitePreventivos(sede)) return res.status(403).send("Esta sede está excluida de los preventivos semanales.");
  let connection;
  try {
    await asegurarProgramacionSemanal(pool);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [unidades] = await connection.query(
      `SELECT id, placa, sede FROM unidades WHERE COALESCE(activa, 1) = 1
       ${sede ? "AND sede = ?" : ""} ORDER BY id FOR UPDATE`, sede ? [sede] : []
    );
    const reparto = repartirUnidadesSemana(unidades.filter(unidad => sedeAdmitePreventivos(unidad.sede)), inicio);
    if (reparto.length) {
      const [existentes] = await connection.query(
        `SELECT id, unidad_id, intervalo_semanas, activa, DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS inicio
         FROM preventivos_programaciones WHERE unidad_id IN (?) FOR UPDATE`, [reparto.map(unidad => unidad.id)]
      );
      const porUnidad = new Map(existentes.map(regla => [regla.unidad_id, regla]));
      for (const unidad of reparto) {
        const actual = porUnidad.get(unidad.id);
        if (actual && actual.intervalo_semanas === 1 && actual.activa && actual.inicio === unidad.fecha) continue;
        if (actual) {
          await connection.query(
            `UPDATE preventivos_programaciones SET fecha_inicio = ?, intervalo_semanas = 1, activa = 1,
             procesada_hasta = ?, version = version + 1, actualizado_por = ? WHERE id = ?`,
            [unidad.fecha, sumarDias(hoy, -1), req.session.user.id, actual.id]
          );
        } else {
          await connection.query(
            `INSERT INTO preventivos_programaciones
             (unidad_id, fecha_inicio, intervalo_semanas, activa, procesada_hasta, creado_por, actualizado_por)
             VALUES (?, ?, 1, 1, ?, ?, ?)`,
            [unidad.id, unidad.fecha, sumarDias(hoy, -1), req.session.user.id, req.session.user.id]
          );
        }
      }
    }
    await connection.commit();
    req.session.preventivosSuccess = reparto.length
      ? `${reparto.length} unidades distribuidas de lunes a viernes por sede. Ciclo semanal desde ${inicio.split("-").reverse().join("/")}.`
      : "No hay unidades activas para programar en esta sede.";
  } catch (error) {
    await connection?.rollback().catch(() => {});
    console.error("Error repartiendo preventivos automáticamente:", error);
    return res.status(500).send("No se pudo completar la programación automática. Puede reintentar.");
  } finally {
    connection?.release();
  }
  try { await ensureNumeroMantenimientoColumn(pool); await generarPreventivos(pool); }
  catch (error) {
    console.error("Error generando preventivos después del reparto:", error);
    req.session.preventivosError = "El ciclo quedó guardado. La generación se reintentará automáticamente.";
  }
  res.redirect(`/mantenimientos/semana?${new URLSearchParams({ semana: inicio, sede })}`);
});

router.post("/programacion", async (req, res) => {
  if (!puedeProgramar(req.session.user)) return res.status(403).send("No autorizado para programar preventivos.");
  const unidadId = Number(req.body.unidad_id);
  const intervalo = Number(req.body.intervalo_semanas);
  const inicio = req.body.fecha_inicio;
  const version = Number(req.body.version);
  const activa = req.body.activa === "1" ? 1 : 0;
  const plan = String(req.body.plan || "").trim();
  const hoy = hoyCostaRica();
  if (!Number.isSafeInteger(unidadId) || unidadId <= 0 || !Number.isInteger(intervalo) || intervalo < 1 || intervalo > 52 ||
      !fechaValida(inicio) || !Number.isInteger(version) || version < 0 || !["0", "1"].includes(req.body.activa) || plan.length > 5000) {
    return res.status(400).send("Revise unidad, fecha, frecuencia (1 a 52 semanas) y plan de trabajo.");
  }
  let connection;
  try {
    await asegurarProgramacionSemanal(pool);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[unidad]] = await connection.query("SELECT id, sede FROM unidades WHERE id = ? AND COALESCE(activa, 1) = 1 FOR UPDATE", [unidadId]);
    if (!unidad) { await connection.rollback(); return res.status(404).send("Unidad no encontrada."); }
    if (!sedeAdmitePreventivos(unidad.sede)) { await connection.rollback(); return res.status(403).send("Esta sede está excluida de los preventivos semanales."); }
    const [[actual]] = await connection.query("SELECT id, version FROM preventivos_programaciones WHERE unidad_id = ? FOR UPDATE", [unidadId]);
    if ((actual?.version || 0) !== version) {
      await connection.rollback();
      return res.status(409).send("Otra persona modificó esta programación. Actualice la página antes de guardar.");
    }
    if (!actual && inicio < hoy) {
      await connection.rollback();
      return res.status(400).send("La primera programación debe comenzar hoy o en una fecha futura.");
    }
    if (actual) {
      await connection.query(
        `UPDATE preventivos_programaciones SET fecha_inicio = ?, intervalo_semanas = ?, plan = ?, activa = ?,
         procesada_hasta = ?, version = version + 1, actualizado_por = ? WHERE id = ?`,
        [inicio, intervalo, plan || null, activa, sumarDias(hoy, -1), req.session.user.id, actual.id]
      );
    } else {
      await connection.query(
        `INSERT INTO preventivos_programaciones
         (unidad_id, fecha_inicio, intervalo_semanas, plan, activa, procesada_hasta, creado_por, actualizado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [unidadId, inicio, intervalo, plan || null, activa, sumarDias(hoy, -1), req.session.user.id, req.session.user.id]
      );
    }
    await connection.commit();
    req.session.preventivosSuccess = activa ? "Frecuencia guardada. Los próximos preventivos se crearán automáticamente en su fecha." : "Programación automática pausada.";
  } catch (error) {
    await connection?.rollback().catch(() => {});
    console.error("Error guardando frecuencia de preventivos:", error);
    return res.status(500).send("No se pudo guardar la programación semanal.");
  } finally {
    connection?.release();
  }
  try { await ensureNumeroMantenimientoColumn(pool); await generarPreventivos(pool); }
  catch (error) {
    console.error("Error generando preventivos después de guardar:", error);
    req.session.preventivosError = "La frecuencia se guardó. La generación automática se reintentará en la siguiente revisión.";
  }
  const query = new URLSearchParams();
  if (fechaValida(req.body.semana)) query.set("semana", req.body.semana);
  if (typeof req.body.sede === "string" && req.body.sede.length <= 100) query.set("sede", req.body.sede);
  res.redirect(`/mantenimientos/semana?${query}`);
});

module.exports = router;
