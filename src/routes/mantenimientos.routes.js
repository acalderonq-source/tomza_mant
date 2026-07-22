const express = require("express");
const router = express.Router();
const pool = require("../db");
const calcularPuntos = require("../utils/puntajeCorrectivos");
const ExcelJS = require("exceljs");
const {
  ensureReportesSupervisoresTables,
  registrarSugerenciasParaCorrectivo
} = require("../utils/reportesSupervisoresDb");

// =====================================================
// MIDDLEWARE DE AUTENTICACIÓN
// =====================================================
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

// =====================================================
// OBTENER SEDE SEGÚN USUARIO
// =====================================================
function obtenerSedeFiltro(req) {
  if (!req.session.user) return null;
  if (req.session.user.rol === "ADMIN") {
    if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS")
      return req.session.sedeSeleccionada;
    return null;
  }
  return req.session.sedeSeleccionada || req.session.user.sede || null;
}

function puedeReprogramarMantenimientos(user) {
  return ["ADMIN", "TALLER"].includes(user.rol);
}

async function unidadColumnExists(columnName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'unidades'
       AND COLUMN_NAME = ?`,
    [columnName]
  );
  return Number(row.count) > 0;
}

async function ensureUnidadEstadoColumns() {
  const columns = [
    ["activa", "TINYINT(1) NOT NULL DEFAULT 1"],
    ["varada", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["razon_varada", "TEXT NULL"]
  ];

  for (const [column, definition] of columns) {
    if (!(await unidadColumnExists(column))) {
      await pool.query(`ALTER TABLE unidades ADD COLUMN ${column} ${definition}`);
    }
  }
}

function redirectMantenimientos(req, res) {
  const returnTo = String(req.body.return_to || "");
  if (returnTo.startsWith("/mantenimientos")) {
    return res.redirect(returnTo);
  }
  return res.redirect("/mantenimientos");
}

function obtenerIdsMantenimiento(value) {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map(id => String(id)).filter(id => /^\d+$/.test(id)))];
}

function obtenerValoresSeleccionados(body) {
  const seleccion = body.mecanicos !== undefined ? body.mecanicos : body["mecanicos[]"];
  if (seleccion === undefined) return [];
  if (Array.isArray(seleccion)) return seleccion.filter(Boolean).map(String);
  if (typeof seleccion === "object" && seleccion !== null) return Object.values(seleccion).filter(Boolean).map(String);
  return [String(seleccion)];
}

function obtenerValorCampoMecanico(body, nombreCampo, idMecanico, indiceOrdenado = -1) {
  const id = String(idMecanico);
  const planoPorId = body[`${nombreCampo}[${id}]`];
  if (planoPorId !== undefined) {
    return String(planoPorId || "").trim();
  }

  const planoPorIndice = indiceOrdenado >= 0 ? body[`${nombreCampo}[${indiceOrdenado}]`] : undefined;
  if (planoPorIndice !== undefined) {
    return String(planoPorIndice || "").trim();
  }

  const campos = body[nombreCampo];
  if (!campos) return "";

  if (Object.prototype.hasOwnProperty.call(campos, id)) {
    return String(campos[id] || "").trim();
  }

  if (Array.isArray(campos) && indiceOrdenado >= 0 && campos[indiceOrdenado] !== undefined) {
    return String(campos[indiceOrdenado] || "").trim();
  }

  return "";
}

async function obtenerReportesPendientesSupervisores(sedeFiltro) {
  await ensureReportesSupervisoresTables(pool);

  const params = [];
  let sql = `
    SELECT
      rs.id,
      rs.unidad_id,
      rs.sede,
      rs.supervisor_nombre,
      rs.descripcion_original,
      rs.descripcion_limpia,
      rs.importante,
      rs.fecha_reporte,
      u.placa
    FROM reportes_supervisores rs
    JOIN unidades u ON u.id = rs.unidad_id
    WHERE rs.estado IN ('PENDIENTE','EN_REVISION')
  `;

  if (sedeFiltro) {
    sql += " AND rs.sede = ?";
    params.push(sedeFiltro);
  }

  sql += " ORDER BY rs.importante DESC, rs.sede, u.placa, rs.fecha_reporte DESC";
  const [reportes] = await pool.query(sql, params);
  return reportes;
}

async function obtenerReporteSupervisorAutorizado(reporteId, sedeFiltro) {
  if (!reporteId) return null;
  await ensureReportesSupervisoresTables(pool);

  const params = [reporteId];
  let sql = `
    SELECT
      rs.*,
      u.placa
    FROM reportes_supervisores rs
    JOIN unidades u ON u.id = rs.unidad_id
    WHERE rs.id = ?
      AND rs.estado IN ('PENDIENTE','EN_REVISION')
  `;

  if (sedeFiltro) {
    sql += " AND rs.sede = ?";
    params.push(sedeFiltro);
  }

  sql += " LIMIT 1";
  const [[reporte]] = await pool.query(sql, params);
  return reporte || null;
}

// =====================================================
// LISTADO DE CORRECTIVOS
// =====================================================
router.get("/correctivos", requireAuth, async (req, res) => {
  try {
    const sedeFiltro = obtenerSedeFiltro(req);
    const condiciones = [];
    const params = [];
    if (sedeFiltro) {
      condiciones.push("c.sede = ?");
      params.push(sedeFiltro);
    }
    const where = condiciones.length ? "WHERE " + condiciones.join(" AND ") : "";
    const [rows] = await pool.query(
      `
      SELECT
        c.id,
        DATE_FORMAT(c.fecha, '%d/%m/%Y %H:%i') AS fecha_formato,
        u.placa,
        c.trabajo_realizado,
        c.pendiente,
        COALESCE(GROUP_CONCAT(DISTINCT m.nombre SEPARATOR ' — '), '—') AS mecanicos
      FROM correctivos c
      JOIN unidades u ON u.id = c.unidad_id
      LEFT JOIN correctivo_trabajos ct ON ct.correctivo_id = c.id
      LEFT JOIN mecanicos m ON m.id = ct.mecanico_id
      ${where}
      GROUP BY c.id, c.fecha, u.placa, c.trabajo_realizado, c.pendiente
      ORDER BY c.fecha DESC
      `,
      params
    );
    const reportesPendientes = ["MECANICO", "ADMIN", "TALLER"].includes(req.session.user.rol)
      ? await obtenerReportesPendientesSupervisores(sedeFiltro)
      : [];

    res.render("correctivos", {
      correctivos: rows,
      reportesPendientes,
      user: req.session.user
    });
  } catch (error) {
    console.error("❌ ERROR listado correctivos:", error);
    res.status(500).send("Error interno");
  }
});

// =====================================================
// EXPORTAR A EXCEL (solo ADMIN)
// =====================================================
router.get("/exportar", requireAuth, async (req, res) => {
  try {
    if (req.session.user.rol !== "ADMIN")
      return res.status(403).send("No autorizado");
    const [rows] = await pool.query(`
      SELECT u.placa, u.sede, 'PREVENTIVO' AS tipo, DATE_FORMAT(m.fecha_programada,'%d/%m/%Y') AS fecha, m.estado, m.ejecucion
      FROM mantenimientos m JOIN unidades u ON u.id = m.unidad_id WHERE m.estado = 'CERRADO'
      UNION ALL
      SELECT u.placa, u.sede, 'CORRECTIVO' AS tipo, DATE_FORMAT(c.fecha,'%d/%m/%Y') AS fecha, 'CERRADO' AS estado, c.trabajo_realizado AS ejecucion
      FROM correctivos c JOIN unidades u ON u.id = c.unidad_id
      ORDER BY fecha DESC
    `);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Mantenimientos");
    sheet.columns = [
      { header: "Placa", key: "placa", width: 15 },
      { header: "Sede", key: "sede", width: 20 },
      { header: "Tipo", key: "tipo", width: 15 },
      { header: "Fecha", key: "fecha", width: 15 },
      { header: "Estado", key: "estado", width: 15 },
      { header: "Ejecución", key: "ejecucion", width: 50 }
    ];
    sheet.addRows(rows);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=mantenimientos.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Error exportando:", err);
    res.status(500).send("Error exportando datos");
  }
});

// =====================================================
// FORMULARIO NUEVO CORRECTIVO
// =====================================================
router.get("/correctivos/nuevo", requireAuth, async (req, res) => {
  try {
    if (!["MECANICO", "ADMIN", "TALLER"].includes(req.session.user.rol))
      return res.redirect("/mantenimientos");
    let sedeFiltro = obtenerSedeFiltro(req);
    const reporteAtendido = await obtenerReporteSupervisorAutorizado(req.query.reporte_id, sedeFiltro);
    if (!sedeFiltro && reporteAtendido) {
      sedeFiltro = reporteAtendido.sede;
    }
    if (!sedeFiltro) return res.status(400).send("No hay sede seleccionada");
    const [unidades] = await pool.query("SELECT id, placa FROM unidades WHERE sede = ? ORDER BY placa", [sedeFiltro]);
    let sqlMecanicos = "SELECT id, nombre FROM mecanicos WHERE activo = 1";
    let paramsMecanicos = [];
    if (sedeFiltro === "Transportadora" || sedeFiltro === "Granel") {
      sqlMecanicos += " AND sede = 'Transportadora'";
    } else {
      sqlMecanicos += " AND sede = ?";
      paramsMecanicos.push(sedeFiltro);
    }
    sqlMecanicos += " ORDER BY nombre";
    const [mecanicos] = await pool.query(sqlMecanicos, paramsMecanicos);
    res.render("correctivos_nuevo", { unidades, mecanicos, reporteAtendido, user: req.session.user });
  } catch (error) {
    console.error("❌ ERROR form correctivo:", error);
    res.status(500).send("Error interno");
  }
});

// =====================================================
// GUARDAR CORRECTIVO (POST)
// =====================================================
router.post("/correctivos", requireAuth, async (req, res) => {
  try {
    if (!["MECANICO", "ADMIN", "TALLER"].includes(req.session.user.rol)) {
      return res.status(403).send("No autorizado");
    }
    await ensureUnidadEstadoColumns();
    const { unidad_id, pendiente, trabajo_general, reporte_id } = req.body;
    const pendienteTexto = String(pendiente || "").trim();
    if (!unidad_id) return res.status(400).send("Debe seleccionar una unidad.");
    const mecanicosArray = obtenerValoresSeleccionados(req.body);
    if (mecanicosArray.length === 0) return res.status(400).send("Debe seleccionar al menos un mecánico.");

    const sedeFiltro = obtenerSedeFiltro(req);
    const [[unidadCorrectivo]] = await pool.query("SELECT id, sede FROM unidades WHERE id = ?", [unidad_id]);
    if (!unidadCorrectivo) return res.status(400).send("Unidad no encontrada.");
    const sedeCorrectivo = sedeFiltro || unidadCorrectivo.sede;
    let sqlMecanicos = "SELECT id FROM mecanicos WHERE activo = 1";
    let paramsMecanicos = [];
    if (sedeCorrectivo === "Transportadora" || sedeCorrectivo === "Granel") {
      sqlMecanicos += " AND sede = 'Transportadora'";
    } else {
      sqlMecanicos += " AND sede = ?";
      paramsMecanicos.push(sedeCorrectivo);
    }
    sqlMecanicos += " ORDER BY nombre";
    const [todosMecanicos] = await pool.query(sqlMecanicos, paramsMecanicos);
    const idsOrdenados = todosMecanicos.map(m => String(m.id));

    let resumenGeneral = "";
    for (const idMec of mecanicosArray) {
      const idx = idsOrdenados.indexOf(idMec);
      const trabajo = obtenerValorCampoMecanico(req.body, "trabajos", idMec, idx);
      if (trabajo.length > 0) {
        resumenGeneral += trabajo + " | ";
      }
    }
    if (!resumenGeneral.trim() && trabajo_general && String(trabajo_general).trim()) {
      resumenGeneral = String(trabajo_general).trim() + " | ";
    }
    if (!resumenGeneral.trim()) return res.status(400).send("Debe escribir al menos un trabajo.");

    const puntos = calcularPuntos(resumenGeneral);
    const [result] = await pool.query(
      `INSERT INTO correctivos (unidad_id, sede, trabajo_realizado, pendiente, creado_por, puntos)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [unidad_id, sedeCorrectivo, resumenGeneral, pendienteTexto || null, req.session.user.id, puntos]
    );
    const correctivoId = result.insertId;

    if (pendienteTexto) {
      await pool.query(
        `UPDATE unidades
         SET varada = 1,
             razon_varada = ?
         WHERE id = ?`,
        [`Pendiente de taller: ${pendienteTexto}`, unidad_id]
      );
    } else {
      await pool.query(
        `UPDATE unidades
         SET varada = 0,
             razon_varada = NULL
         WHERE id = ?`,
        [unidad_id]
      );
    }

    for (const idMec of mecanicosArray) {
      let trabajo = null, repuesto = null;
      const idx = idsOrdenados.indexOf(idMec);
      trabajo = obtenerValorCampoMecanico(req.body, "trabajos", idMec, idx) || null;
      repuesto = obtenerValorCampoMecanico(req.body, "repuestos", idMec, idx) || null;
      if (trabajo || repuesto) {
        await pool.query(
          `INSERT INTO correctivo_trabajos (correctivo_id, mecanico_id, trabajo, repuestos)
           VALUES (?, ?, ?, ?)`,
          [correctivoId, idMec, trabajo, repuesto]
        );
      }
    }

    const reporteAtendido = await obtenerReporteSupervisorAutorizado(reporte_id, sedeFiltro);
    if (reporteAtendido && String(reporteAtendido.unidad_id) === String(unidad_id)) {
      await pool.query(
        `UPDATE reportes_supervisores
         SET estado = 'HISTORIAL',
             cerrado_por = ?,
             fecha_cierre = NOW(),
             correctivo_id = ?,
             cierre_motivo = ?,
             cierre_confianza = 1,
             actualizado_en = NOW()
         WHERE id = ?`,
        [
          req.session.user.id,
          correctivoId,
          "Cerrado por mecánico al completar correctivo desde el reporte.",
          reporteAtendido.id
        ]
      );
      await pool.query(
        `UPDATE reportes_supervisores_sugerencias
         SET estado = CASE WHEN estado = 'PENDIENTE' THEN 'CONFIRMADA' ELSE estado END,
             resuelto_por = COALESCE(resuelto_por, ?),
             resuelto_en = COALESCE(resuelto_en, NOW())
         WHERE reporte_id = ?`,
        [req.session.user.id, reporteAtendido.id]
      );
    }

    const sugerencias = await registrarSugerenciasParaCorrectivo(pool, correctivoId);
    if (sugerencias.length && ["ADMIN", "TALLER"].includes(req.session.user.rol)) {
      return res.redirect(`/reportes-supervisores?correctivo_id=${correctivoId}`);
    }

    res.redirect("/mantenimientos/correctivos");
  } catch (error) {
    console.error("❌ ERROR guardar correctivo:", error);
    res.status(500).send("Error interno al guardar el correctivo");
  }
});

// =====================================================
// AGREGAR MÁS TRABAJOS / REPUESTOS A UN CORRECTIVO EXISTENTE
// =====================================================
router.get("/correctivos/:id/agregar", requireAuth, async (req, res) => {
  try {
    const correctivoId = req.params.id;
    const [[correctivo]] = await pool.query(
      `SELECT c.*, u.placa FROM correctivos c JOIN unidades u ON u.id = c.unidad_id WHERE c.id = ?`,
      [correctivoId]
    );
    if (!correctivo) return res.status(404).send("Correctivo no encontrado");
    const sedeFiltro = obtenerSedeFiltro(req);
    let sqlMecanicos = "SELECT id, nombre FROM mecanicos WHERE activo = 1";
    let paramsMecanicos = [];
    if (sedeFiltro === "Transportadora" || sedeFiltro === "Granel") {
      sqlMecanicos += " AND sede = 'Transportadora'";
    } else {
      sqlMecanicos += " AND sede = ?";
      paramsMecanicos.push(sedeFiltro);
    }
    sqlMecanicos += " ORDER BY nombre";
    const [mecanicosDisponibles] = await pool.query(sqlMecanicos, paramsMecanicos);
    res.render("correctivos_agregar", { correctivo, mecanicosDisponibles, user: req.session.user });
  } catch (error) {
    console.error("❌ Error al cargar formulario de agregado:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/correctivos/:id/agregar", requireAuth, async (req, res) => {
  try {
    const correctivoId = req.params.id;
    const { mecanicos, trabajos, repuestos } = req.body;
    let mecanicosArray = [];
    if (mecanicos) {
      mecanicosArray = Array.isArray(mecanicos) ? mecanicos.filter(Boolean) : [mecanicos];
    }
    if (mecanicosArray.length === 0) return res.status(400).send("Debe seleccionar al menos un mecánico.");
    for (const idMec of mecanicosArray) {
      let trabajo = (trabajos && trabajos[idMec]) ? trabajos[idMec].trim() : null;
      let repuesto = (repuestos && repuestos[idMec]) ? repuestos[idMec].trim() : null;
      if (trabajo || repuesto) {
        await pool.query(
          `INSERT INTO correctivo_trabajos (correctivo_id, mecanico_id, trabajo, repuestos)
           VALUES (?, ?, ?, ?)`,
          [correctivoId, idMec, trabajo, repuesto]
        );
      }
    }
    res.redirect("/mantenimientos/correctivos");
  } catch (error) {
    console.error("❌ Error al guardar información adicional:", error);
    res.status(500).send("Error interno al agregar más información");
  }
});

// =====================================================
// MANTENIMIENTOS PREVENTIVOS
// =====================================================
router.get("/", requireAuth, async (req, res) => {
  try {
    const { filtro, placa, tipo, prioridad, fecha_desde, fecha_hasta, mecanico_id } = req.query;
    let condiciones = [], params = [];
    if (filtro === "pendientes") condiciones.push("m.estado != 'CERRADO'");
    else if (filtro === "realizados") condiciones.push("m.estado = 'CERRADO'");

    if (placa && placa.trim() !== "") {
      condiciones.push("u.placa LIKE ?");
      params.push(`%${placa.trim()}%`);
    }
    if (tipo && tipo !== "") {
      condiciones.push("m.tipo = ?");
      params.push(tipo);
    }
    if (prioridad && prioridad !== "") {
      condiciones.push("m.prioridad = ?");
      params.push(prioridad);
    }
    if (fecha_desde && fecha_desde !== "") {
      condiciones.push("m.fecha_programada >= ?");
      params.push(fecha_desde);
    }
    if (fecha_hasta && fecha_hasta !== "") {
      condiciones.push("m.fecha_programada <= ?");
      params.push(fecha_hasta);
    }
    if (mecanico_id && mecanico_id !== "") {
      condiciones.push(`EXISTS (
        SELECT 1
        FROM mantenimiento_mecanicos mm
        WHERE mm.mantenimiento_id = m.id AND mm.mecanico_id = ?
      )`);
      params.push(mecanico_id);
    }

    const sedeFiltro = obtenerSedeFiltro(req);
    if (sedeFiltro) {
      condiciones.push("u.sede = ?");
      params.push(sedeFiltro);
    }
    if (req.session.user.rol === "MECANICO") {
      condiciones.push("DATE(m.fecha_programada) <= CURDATE()");
    }
    const where = condiciones.length ? "WHERE " + condiciones.join(" AND ") : "";
    const [mantenimientos] = await pool.query(
      `
      SELECT
        m.id,
        u.placa,
        u.sede,
        m.tipo,
        m.estado,
        m.prioridad,
        m.fecha_programada,
        DATE_FORMAT(m.fecha_programada, '%d/%m/%Y') AS fecha_formato,
        m.ejecucion,
        m.pendiente,
        COALESCE(GROUP_CONCAT(DISTINCT mec.nombre ORDER BY mec.nombre SEPARATOR ', '), '—') AS mecanicos
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      LEFT JOIN mantenimiento_mecanicos mm ON mm.mantenimiento_id = m.id
      LEFT JOIN mecanicos mec ON mec.id = mm.mecanico_id
      ${where}
      GROUP BY m.id, u.placa, u.sede, m.tipo, m.estado, m.prioridad, m.fecha_programada, m.ejecucion, m.pendiente
      ORDER BY m.fecha_programada DESC, m.id DESC
      `,
      params
    );

    let sqlMecanicos = "SELECT id, nombre FROM mecanicos WHERE activo = 1";
    const paramsMecanicos = [];
    if (sedeFiltro === "Transportadora" || sedeFiltro === "Granel") {
      sqlMecanicos += " AND sede = 'Transportadora'";
    } else if (sedeFiltro) {
      sqlMecanicos += " AND sede = ?";
      paramsMecanicos.push(sedeFiltro);
    }
    sqlMecanicos += " ORDER BY nombre";
    const [mecanicos] = await pool.query(sqlMecanicos, paramsMecanicos);
    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("mantenimientos", {
      mantenimientos,
      user: req.session.user,
      filtro,
      filtros: { filtro, placa, tipo, prioridad, fecha_desde, fecha_hasta, mecanico_id },
      mecanicos,
      sedeSeleccionada: sedeFiltro || "TODAS",
      puedeReprogramar: puedeReprogramarMantenimientos(req.session.user),
      success,
      error
    });
  } catch (error) {
    console.error("❌ ERROR listado mantenimientos:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/reprogramar", requireAuth, async (req, res) => {
  try {
    if (!puedeReprogramarMantenimientos(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    const ids = obtenerIdsMantenimiento(req.body.mantenimientos_ids);
    const nuevaFecha = String(req.body.nueva_fecha || "").trim();

    if (!ids.length) {
      req.session.error = "Debe seleccionar al menos un mantenimiento.";
      return redirectMantenimientos(req, res);
    }

    if (!nuevaFecha) {
      req.session.error = "Debe indicar la nueva fecha.";
      return redirectMantenimientos(req, res);
    }

    const sedeFiltro = obtenerSedeFiltro(req);
    let sql = `
      UPDATE mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      SET m.fecha_programada = ?
      WHERE m.id IN (?)
        AND m.estado != 'CERRADO'
    `;
    const params = [nuevaFecha, ids];

    if (sedeFiltro) {
      sql += " AND u.sede = ?";
      params.push(sedeFiltro);
    }

    const [result] = await pool.query(sql, params);
    req.session.success = `${result.affectedRows} mantenimiento${result.affectedRows === 1 ? "" : "s"} reprogramado${result.affectedRows === 1 ? "" : "s"} para ${nuevaFecha}.`;
    return redirectMantenimientos(req, res);
  } catch (error) {
    console.error("❌ ERROR reprogramando mantenimientos:", error);
    req.session.error = "Error interno al reprogramar mantenimientos.";
    return redirectMantenimientos(req, res);
  }
});

router.post("/:id/reprogramar", requireAuth, async (req, res) => {
  try {
    if (!puedeReprogramarMantenimientos(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    const id = String(req.params.id || "");
    const nuevaFecha = String(req.body.nueva_fecha || "").trim();

    if (!/^\d+$/.test(id) || !nuevaFecha) {
      req.session.error = "Debe indicar el mantenimiento y la nueva fecha.";
      return redirectMantenimientos(req, res);
    }

    const sedeFiltro = obtenerSedeFiltro(req);
    let sql = `
      UPDATE mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      SET m.fecha_programada = ?
      WHERE m.id = ?
        AND m.estado != 'CERRADO'
    `;
    const params = [nuevaFecha, id];

    if (sedeFiltro) {
      sql += " AND u.sede = ?";
      params.push(sedeFiltro);
    }

    const [result] = await pool.query(sql, params);
    req.session.success = result.affectedRows
      ? `Mantenimiento reprogramado para ${nuevaFecha}.`
      : "No se reprogramó. Puede que ya esté cerrado o no tengas permiso para esa sede.";
    return redirectMantenimientos(req, res);
  } catch (error) {
    console.error("❌ ERROR reprogramando mantenimiento:", error);
    req.session.error = "Error interno al reprogramar mantenimiento.";
    return redirectMantenimientos(req, res);
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const sedeFiltro = obtenerSedeFiltro(req);
    let sql = `SELECT m.id, m.tipo, m.estado, m.prioridad, m.plan, m.ejecucion, m.pendiente, u.placa, u.sede
               FROM mantenimientos m JOIN unidades u ON u.id = m.unidad_id WHERE m.id = ?`;
    let params = [req.params.id];
    if (sedeFiltro) {
      sql += " AND u.sede = ?";
      params.push(sedeFiltro);
    }
    const [rows] = await pool.query(sql, params);
    if (!rows.length) return res.send("Mantenimiento no encontrado");
    let sqlMecanicos = "SELECT id, nombre FROM mecanicos WHERE activo = 1";
    let paramsMecanicos = [];
    if (sedeFiltro === "Transportadora" || sedeFiltro === "Granel") {
      sqlMecanicos += " AND sede = 'Transportadora'";
    } else {
      sqlMecanicos += " AND sede = ?";
      paramsMecanicos.push(sedeFiltro);
    }
    sqlMecanicos += " ORDER BY nombre";
    const [mecanicos] = await pool.query(sqlMecanicos, paramsMecanicos);
    const [mecanicosAsignados] = await pool.query(
      `SELECT m.id, m.nombre FROM mantenimiento_mecanicos mm JOIN mecanicos m ON m.id = mm.mecanico_id WHERE mm.mantenimiento_id = ?`,
      [req.params.id]
    );
    res.render("mantenimiento_detalle", { mantenimiento: rows[0], user: req.session.user, mecanicos, mecanicosAsignados });
  } catch (error) {
    console.error("❌ ERROR detalle mantenimiento:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/:id/plan", requireAuth, async (req, res) => {
  try {
    if (!["ADMIN", "TALLER"].includes(req.session.user.rol)) return res.status(403).send("No autorizado");
    const { plan } = req.body;
    await pool.query("UPDATE mantenimientos SET plan = ? WHERE id = ?", [plan, req.params.id]);
    res.redirect(`/mantenimientos/${req.params.id}`);
  } catch (error) {
    console.error("❌ ERROR guardando plan:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/:id/ejecucion", requireAuth, async (req, res) => {
  try {
    if (!["ADMIN", "MECANICO"].includes(req.session.user.rol)) return res.status(403).send("No autorizado");
    const { ejecucion, pendiente } = req.body;
    let mecanicos = [];
    if (req.body.mecanicos !== undefined) {
      mecanicos = Array.isArray(req.body.mecanicos) ? req.body.mecanicos.filter(Boolean) : [req.body.mecanicos];
    }
    if (mecanicos.length === 0) return res.status(400).send("Debe asignar al menos un mecánico antes de cerrar.");
    await pool.query(`UPDATE mantenimientos SET ejecucion = ?, pendiente = ?, estado = 'CERRADO', fecha_cierre = NOW() WHERE id = ?`, [ejecucion, pendiente, req.params.id]);
    await pool.query("DELETE FROM mantenimiento_mecanicos WHERE mantenimiento_id = ?", [req.params.id]);
    for (const mecanicoId of mecanicos) {
      await pool.query("INSERT INTO mantenimiento_mecanicos (mantenimiento_id, mecanico_id) VALUES (?, ?)", [req.params.id, mecanicoId]);
    }
    res.redirect("/mantenimientos");
  } catch (error) {
    console.error("❌ ERROR cerrar mantenimiento:", error);
    res.status(500).send("Error interno");
  }
});

module.exports = router;
