const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  ensureReportesSupervisoresTables,
  limpiarTextoReporte
} = require("../utils/reportesSupervisoresDb");

const ROLES_VER = ["ADMIN", "TALLER", "MECANICO", "SUPERVISOR", "SUPERVISOR_PESADO"];
const ROLES_CREAR = ["ADMIN", "TALLER", "SUPERVISOR", "SUPERVISOR_PESADO"];
const ROLES_EDITAR = ["ADMIN", "TALLER"];

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (roles.includes(req.session.user.rol)) return next();
    return res.status(403).send("No autorizado");
  };
}

async function obtenerSedesPermitidas(req) {
  const user = req.session.user;
  if (user.rol === "ADMIN") {
    if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
      return [req.session.sedeSeleccionada];
    }
    return [];
  }

  const [extras] = await pool.query("SELECT sede FROM usuarios_sedes WHERE usuario_id = ?", [user.id]);
  const sedes = [...new Set([user.sede, ...extras.map(e => e.sede)].filter(Boolean))];

  if (req.session.sedeSeleccionada && sedes.includes(req.session.sedeSeleccionada)) {
    return [req.session.sedeSeleccionada];
  }

  return sedes;
}

function aplicarFiltroSedes(sql, params, sedesPermitidas, alias = "rs") {
  if (sedesPermitidas.length) {
    sql += ` AND ${alias}.sede IN (?)`;
    params.push(sedesPermitidas);
  }
  return sql;
}

async function cargarUnidades(req) {
  const sedesPermitidas = await obtenerSedesPermitidas(req);
  let sql = "SELECT id, placa, sede FROM unidades WHERE activa = 1";
  const params = [];
  if (sedesPermitidas.length) {
    sql += " AND sede IN (?)";
    params.push(sedesPermitidas);
  }
  sql += " ORDER BY sede, placa";
  const [unidades] = await pool.query(sql, params);
  return unidades;
}

async function obtenerSugerenciasPendientes(sedesPermitidas, correctivoId = null) {
  const params = [];
  let sql = `
    SELECT
      s.id,
      s.reporte_id,
      s.correctivo_id,
      s.confianza,
      s.motivo,
      rs.descripcion_limpia,
      rs.descripcion_original,
      rs.fecha_reporte,
      u.placa,
      rs.sede,
      c.trabajo_realizado,
      c.fecha AS fecha_correctivo
    FROM reportes_supervisores_sugerencias s
    JOIN reportes_supervisores rs ON rs.id = s.reporte_id
    JOIN unidades u ON u.id = rs.unidad_id
    JOIN correctivos c ON c.id = s.correctivo_id
    WHERE s.estado = 'PENDIENTE'
      AND rs.estado IN ('PENDIENTE','EN_REVISION')
  `;

  if (correctivoId) {
    sql += " AND s.correctivo_id = ?";
    params.push(correctivoId);
  }

  sql = aplicarFiltroSedes(sql, params, sedesPermitidas, "rs");
  sql += " ORDER BY s.confianza DESC, s.creado_en DESC";

  const [sugerencias] = await pool.query(sql, params);
  return sugerencias;
}

router.use(requireAuth);

router.get("/", allowRoles(...ROLES_VER), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    const sedesPermitidas = await obtenerSedesPermitidas(req);
    const { sede, placa, importante, correctivo_id } = req.query;
    const params = [];
    let sql = `
      SELECT
        rs.*,
        u.placa,
        u.sede AS unidad_sede
      FROM reportes_supervisores rs
      JOIN unidades u ON u.id = rs.unidad_id
      WHERE rs.estado IN ('PENDIENTE','EN_REVISION')
    `;

    sql = aplicarFiltroSedes(sql, params, sedesPermitidas, "rs");

    if (sede) {
      sql += " AND rs.sede = ?";
      params.push(sede);
    }
    if (placa) {
      sql += " AND u.placa LIKE ?";
      params.push(`%${String(placa).trim().toUpperCase()}%`);
    }
    if (importante === "1") {
      sql += " AND rs.importante = 1";
    }

    sql += " ORDER BY rs.importante DESC, rs.sede ASC, u.placa ASC, rs.fecha_reporte DESC";
    const [reportes] = await pool.query(sql, params);
    const unidades = await cargarUnidades(req);
    const sugerencias = await obtenerSugerenciasPendientes(sedesPermitidas, correctivo_id || null);
    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("reportes_supervisores", {
      reportes,
      unidades,
      sugerencias,
      user: req.session.user,
      filtros: { sede, placa, importante, correctivo_id },
      puedeCrear: ROLES_CREAR.includes(req.session.user.rol),
      puedeEditar: ROLES_EDITAR.includes(req.session.user.rol),
      success,
      error
    });
  } catch (error) {
    console.error("Error cargando reportes de supervisores:", error);
    res.status(500).send("Error interno");
  }
});

router.get("/historial", allowRoles(...ROLES_VER), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    const sedesPermitidas = await obtenerSedesPermitidas(req);
    const { sede, placa, fecha_desde, fecha_hasta } = req.query;
    const params = [];
    let sql = `
      SELECT
        rs.*,
        u.placa,
        c.trabajo_realizado,
        c.fecha AS fecha_correctivo,
        uc.usuario AS cerrado_por_usuario
      FROM reportes_supervisores rs
      JOIN unidades u ON u.id = rs.unidad_id
      LEFT JOIN correctivos c ON c.id = rs.correctivo_id
      LEFT JOIN usuarios uc ON uc.id = rs.cerrado_por
      WHERE rs.estado IN ('HISTORIAL','DESCARTADO')
    `;

    sql = aplicarFiltroSedes(sql, params, sedesPermitidas, "rs");

    if (sede) {
      sql += " AND rs.sede = ?";
      params.push(sede);
    }
    if (placa) {
      sql += " AND u.placa LIKE ?";
      params.push(`%${String(placa).trim().toUpperCase()}%`);
    }
    if (fecha_desde) {
      sql += " AND DATE(rs.fecha_cierre) >= ?";
      params.push(fecha_desde);
    }
    if (fecha_hasta) {
      sql += " AND DATE(rs.fecha_cierre) <= ?";
      params.push(fecha_hasta);
    }

    sql += " ORDER BY rs.fecha_cierre DESC, rs.sede, u.placa";
    const [reportes] = await pool.query(sql, params);

    res.render("reportes_supervisores_historial", {
      reportes,
      user: req.session.user,
      filtros: { sede, placa, fecha_desde, fecha_hasta },
      puedeEditar: ROLES_EDITAR.includes(req.session.user.rol)
    });
  } catch (error) {
    console.error("Error cargando historial de reportes:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/", allowRoles(...ROLES_CREAR), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    const { unidad_id, descripcion_original } = req.body;
    if (!unidad_id || !String(descripcion_original || "").trim()) {
      req.session.error = "Debe seleccionar unidad y escribir el reporte.";
      return res.redirect("/reportes-supervisores");
    }

    const sedesPermitidas = await obtenerSedesPermitidas(req);
    const [[unidad]] = await pool.query("SELECT id, placa, sede FROM unidades WHERE id = ?", [unidad_id]);
    if (!unidad || (sedesPermitidas.length && !sedesPermitidas.includes(unidad.sede))) {
      req.session.error = "Unidad no autorizada para este usuario.";
      return res.redirect("/reportes-supervisores");
    }

    await pool.query(
      `INSERT INTO reportes_supervisores
       (unidad_id, sede, supervisor_id, supervisor_nombre, descripcion_original, descripcion_limpia)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        unidad.id,
        unidad.sede,
        req.session.user.id,
        req.session.user.nombre || req.session.user.usuario,
        descripcion_original.trim(),
        limpiarTextoReporte(descripcion_original)
      ]
    );

    req.session.success = `Reporte registrado para ${unidad.placa}.`;
    res.redirect("/reportes-supervisores");
  } catch (error) {
    console.error("Error guardando reporte de supervisor:", error);
    req.session.error = "Error al guardar reporte.";
    res.redirect("/reportes-supervisores");
  }
});

router.post("/:id/editar", allowRoles(...ROLES_EDITAR), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    const { descripcion_limpia, nota_taller, importante, estado } = req.body;
    await pool.query(
      `UPDATE reportes_supervisores
       SET descripcion_limpia = ?,
           nota_taller = ?,
           importante = ?,
           estado = CASE WHEN ? IN ('PENDIENTE','EN_REVISION') THEN ? ELSE estado END,
           actualizado_en = NOW()
       WHERE id = ?
         AND estado IN ('PENDIENTE','EN_REVISION')`,
      [
        descripcion_limpia || null,
        nota_taller || null,
        importante === "1" ? 1 : 0,
        estado,
        estado,
        req.params.id
      ]
    );
    req.session.success = "Reporte actualizado.";
    res.redirect("/reportes-supervisores");
  } catch (error) {
    console.error("Error editando reporte:", error);
    req.session.error = "Error al editar reporte.";
    res.redirect("/reportes-supervisores");
  }
});

router.post("/:id/limpiar-ia", allowRoles(...ROLES_EDITAR), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    const [[reporte]] = await pool.query("SELECT descripcion_original FROM reportes_supervisores WHERE id = ?", [req.params.id]);
    if (!reporte) {
      req.session.error = "Reporte no encontrado.";
      return res.redirect("/reportes-supervisores");
    }

    await pool.query(
      "UPDATE reportes_supervisores SET descripcion_limpia = ?, actualizado_en = NOW() WHERE id = ?",
      [limpiarTextoReporte(reporte.descripcion_original), req.params.id]
    );
    req.session.success = "Texto limpiado con IA interna.";
    res.redirect("/reportes-supervisores");
  } catch (error) {
    console.error("Error limpiando texto:", error);
    req.session.error = "No se pudo limpiar el texto.";
    res.redirect("/reportes-supervisores");
  }
});

router.post("/:id/cerrar", allowRoles(...ROLES_EDITAR), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    const { motivo } = req.body;
    await pool.query(
      `UPDATE reportes_supervisores
       SET estado = 'HISTORIAL',
           cerrado_por = ?,
           fecha_cierre = NOW(),
           cierre_motivo = ?,
           cierre_confianza = NULL,
           actualizado_en = NOW()
       WHERE id = ?
         AND estado IN ('PENDIENTE','EN_REVISION')`,
      [req.session.user.id, motivo || "Cierre manual por taller/admin", req.params.id]
    );
    req.session.success = "Reporte movido al historial.";
    res.redirect("/reportes-supervisores");
  } catch (error) {
    console.error("Error cerrando reporte:", error);
    req.session.error = "No se pudo cerrar el reporte.";
    res.redirect("/reportes-supervisores");
  }
});

router.post("/:id/reabrir", allowRoles(...ROLES_EDITAR), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    await pool.query(
      `UPDATE reportes_supervisores
       SET estado = 'PENDIENTE',
           cerrado_por = NULL,
           fecha_cierre = NULL,
           correctivo_id = NULL,
           cierre_motivo = NULL,
           cierre_confianza = NULL,
           actualizado_en = NOW()
       WHERE id = ?`,
      [req.params.id]
    );
    res.redirect("/reportes-supervisores");
  } catch (error) {
    console.error("Error reabriendo reporte:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/sugerencias/:id/confirmar", allowRoles(...ROLES_EDITAR), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    const [[sugerencia]] = await pool.query(
      `SELECT * FROM reportes_supervisores_sugerencias WHERE id = ? AND estado = 'PENDIENTE'`,
      [req.params.id]
    );
    if (!sugerencia) {
      req.session.error = "Sugerencia no encontrada.";
      return res.redirect("/reportes-supervisores");
    }

    await pool.query(
      `UPDATE reportes_supervisores
       SET estado = 'HISTORIAL',
           cerrado_por = ?,
           fecha_cierre = NOW(),
           correctivo_id = ?,
           cierre_motivo = ?,
           cierre_confianza = ?,
           actualizado_en = NOW()
       WHERE id = ?`,
      [
        req.session.user.id,
        sugerencia.correctivo_id,
        sugerencia.motivo,
        sugerencia.confianza,
        sugerencia.reporte_id
      ]
    );
    await pool.query(
      `UPDATE reportes_supervisores_sugerencias
       SET estado = 'CONFIRMADA', resuelto_por = ?, resuelto_en = NOW()
       WHERE id = ?`,
      [req.session.user.id, req.params.id]
    );
    req.session.success = "Sugerencia confirmada. El reporte pasó a historial.";
    res.redirect("/reportes-supervisores");
  } catch (error) {
    console.error("Error confirmando sugerencia:", error);
    req.session.error = "No se pudo confirmar la sugerencia.";
    res.redirect("/reportes-supervisores");
  }
});

router.post("/sugerencias/:id/descartar", allowRoles(...ROLES_EDITAR), async (req, res) => {
  try {
    await ensureReportesSupervisoresTables(pool);
    await pool.query(
      `UPDATE reportes_supervisores_sugerencias
       SET estado = 'DESCARTADA', resuelto_por = ?, resuelto_en = NOW()
       WHERE id = ?`,
      [req.session.user.id, req.params.id]
    );
    req.session.success = "Sugerencia descartada.";
    res.redirect("/reportes-supervisores");
  } catch (error) {
    console.error("Error descartando sugerencia:", error);
    req.session.error = "No se pudo descartar la sugerencia.";
    res.redirect("/reportes-supervisores");
  }
});

module.exports = router;
