const express = require("express");
const ExcelJS = require("exceljs");
const router = express.Router();
const pool = require("../db");
const {
  etiquetaSede,
  esUsuarioTodasSedes,
  getSedesPermitidas
} = require("../utils/sedes");
const { normalizarPlaca, expresionPlacaSql, variantesPlaca } = require("../utils/placas");
const { normalizarTipoMantenimiento } = require("../utils/tipoMantenimiento");

const ROLES_LOGISTICA_TALLER = ["ADMIN", "TALLER", "MECANICO", "PROVEEDURIA_TALLER"];
const ESTADOS_LOGISTICA = ["PENDIENTE", "EN_PROCESO", "LISTO", "DESCARTADO"];

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireLogistica(req, res, next) {
  if (!ROLES_LOGISTICA_TALLER.includes(req.session.user.rol)) {
    return res.status(403).send("No autorizado");
  }
  next();
}

function fechaCostaRica(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function fechaValida(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? value : fechaCostaRica();
}

function estadoLogistica(value) {
  const estado = String(value || "").trim().toUpperCase();
  return ESTADOS_LOGISTICA.includes(estado) ? estado : "PENDIENTE";
}

async function ensureLogisticaTallerTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS logistica_taller (
      id INT AUTO_INCREMENT PRIMARY KEY,
      fecha DATE NOT NULL,
      prioridad_id INT NULL,
      unidad_id INT NULL,
      placa VARCHAR(50) NOT NULL,
      sede VARCHAR(100) NULL,
      detalle_malo TEXT NULL,
      tipo_mantenimiento VARCHAR(20) NOT NULL DEFAULT 'CORRECTIVO',
      estado ENUM('PENDIENTE','EN_PROCESO','LISTO','DESCARTADO') NOT NULL DEFAULT 'PENDIENTE',
      creado_por INT NULL,
      actualizado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_logistica_prioridad (prioridad_id),
      INDEX idx_logistica_fecha (fecha),
      INDEX idx_logistica_sede (sede),
      INDEX idx_logistica_placa (placa),
      INDEX idx_logistica_tipo (tipo_mantenimiento),
      INDEX idx_logistica_estado (estado)
    )
  `);
}

function aplicarFiltroSedes(condiciones, params, sedesFiltro, alias = "lt") {
  if (sedesFiltro.length) {
    condiciones.push(`(${alias}.sede IN (?) OR ${alias}.sede IS NULL OR ${alias}.sede = '')`);
    params.push(sedesFiltro);
  }
}

async function obtenerSedesFiltro(req) {
  const user = req.session.user;
  const sedes = getSedesPermitidas(req).filter(Boolean);
  if (esUsuarioTodasSedes(user) && (!req.session.sedeSeleccionada || req.session.sedeSeleccionada === "TODAS")) {
    return [];
  }
  return sedes;
}

async function sincronizarPrioridadesDelDia(fecha, req) {
  await ensureLogisticaTallerTable();
  const sedesFiltro = await obtenerSedesFiltro(req);
  const condiciones = [
    "tp.estado = 'PENDIENTE'",
    "COALESCE(tp.fecha_prioridad, DATE(tp.creado_en)) = ?"
  ];
  const params = [fecha];

  if (sedesFiltro.length) {
    condiciones.push("(COALESCE(NULLIF(tp.sede, ''), un.sede) IN (?) OR tp.sede IS NULL OR tp.sede = '')");
    params.push(sedesFiltro);
  }

  const [prioridades] = await pool.query(
    `SELECT
       tp.id AS prioridad_id,
       tp.placa,
       tp.observacion,
       un.id AS unidad_id,
       COALESCE(NULLIF(tp.sede, ''), un.sede) AS sede
     FROM taller_prioridades tp
     LEFT JOIN unidades un ON ${expresionPlacaSql("un.placa")} = ${expresionPlacaSql("tp.placa")}
     WHERE ${condiciones.join(" AND ")}
     ORDER BY tp.creado_en DESC, tp.id DESC`,
    params
  );

  let creadas = 0;
  for (const prioridad of prioridades) {
    const placa = normalizarPlaca(prioridad.placa);
    if (!placa) continue;
    let unidadId = prioridad.unidad_id || null;
    let sede = prioridad.sede || null;
    if (!unidadId || !sede) {
      const [[unidadEncontrada]] = await pool.query(
        `SELECT id, sede FROM unidades WHERE ${expresionPlacaSql("placa")} IN (?) LIMIT 1`,
        [variantesPlaca(placa)]
      );
      unidadId = unidadId || unidadEncontrada?.id || null;
      sede = sede || unidadEncontrada?.sede || null;
    }

    const [result] = await pool.query(
      `INSERT INTO logistica_taller
       (fecha, prioridad_id, unidad_id, placa, sede, detalle_malo, tipo_mantenimiento, estado, creado_por, actualizado_por)
       VALUES (?, ?, ?, ?, ?, ?, 'CORRECTIVO', 'PENDIENTE', ?, ?)
       ON DUPLICATE KEY UPDATE
         unidad_id = COALESCE(logistica_taller.unidad_id, VALUES(unidad_id)),
         placa = VALUES(placa),
         sede = COALESCE(NULLIF(logistica_taller.sede, ''), VALUES(sede)),
         detalle_malo = COALESCE(NULLIF(logistica_taller.detalle_malo, ''), VALUES(detalle_malo)),
         actualizado_por = VALUES(actualizado_por)`,
      [
        fecha,
        prioridad.prioridad_id,
        unidadId,
        placa,
        sede,
        prioridad.observacion || null,
        req.session.user.id || null,
        req.session.user.id || null
      ]
    );
    if (result.affectedRows === 1) creadas += 1;
  }

  return creadas;
}

async function obtenerRegistros(req, fecha) {
  const sedesFiltro = await obtenerSedesFiltro(req);
  const condiciones = ["lt.fecha = ?"];
  const params = [fecha];
  aplicarFiltroSedes(condiciones, params, sedesFiltro, "lt");

  const [registros] = await pool.query(
    `SELECT
       lt.*,
       DATE_FORMAT(lt.fecha, '%d/%m/%Y') AS fecha_formato,
       tp.observacion AS prioridad_observacion,
       u.usuario AS actualizado_por_nombre
     FROM logistica_taller lt
     LEFT JOIN taller_prioridades tp ON tp.id = lt.prioridad_id
     LEFT JOIN usuarios u ON u.id = lt.actualizado_por
     WHERE ${condiciones.join(" AND ")}
     ORDER BY
       CASE lt.estado
         WHEN 'PENDIENTE' THEN 1
         WHEN 'EN_PROCESO' THEN 2
         WHEN 'LISTO' THEN 3
         ELSE 4
       END,
       lt.sede,
       lt.placa,
       lt.id DESC`,
    params
  );

  return registros;
}

router.use(requireAuth, requireLogistica);

router.get("/", async (req, res) => {
  try {
    await ensureLogisticaTallerTable();
    const fecha = fechaValida(req.query.fecha);
    await sincronizarPrioridadesDelDia(fecha, req);
    const registros = await obtenerRegistros(req, fecha);

    const resumen = registros.reduce((acc, item) => {
      acc.total += 1;
      acc.correctivos += item.tipo_mantenimiento === "CORRECTIVO" ? 1 : 0;
      acc.preventivos += item.tipo_mantenimiento === "PREVENTIVO" ? 1 : 0;
      acc.pendientes += item.estado === "PENDIENTE" ? 1 : 0;
      acc.listos += item.estado === "LISTO" ? 1 : 0;
      return acc;
    }, { total: 0, correctivos: 0, preventivos: 0, pendientes: 0, listos: 0 });

    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("logistica_taller", {
      user: req.session.user,
      fecha,
      registros,
      resumen,
      estados: ESTADOS_LOGISTICA,
      etiquetaSede,
      success,
      error
    });
  } catch (error) {
    console.error("Error cargando logística taller:", error);
    res.status(500).send("Error cargando logística taller");
  }
});

router.post("/sincronizar", async (req, res) => {
  try {
    const fecha = fechaValida(req.body.fecha);
    const creadas = await sincronizarPrioridadesDelDia(fecha, req);
    req.session.success = creadas
      ? `${creadas} prioridad(es) agregada(s) a logística taller.`
      : "Logística taller ya estaba sincronizada para esa fecha.";
    res.redirect(`/logistica-taller?fecha=${encodeURIComponent(fecha)}`);
  } catch (error) {
    console.error("Error sincronizando logística taller:", error);
    req.session.error = "No se pudo sincronizar prioridades.";
    res.redirect("/logistica-taller");
  }
});

router.post("/", async (req, res) => {
  try {
    await ensureLogisticaTallerTable();
    const fecha = fechaValida(req.body.fecha);
    const placa = normalizarPlaca(req.body.placa);
    const detalle = String(req.body.detalle_malo || "").trim();
    const tipo = normalizarTipoMantenimiento(req.body.tipo_mantenimiento);
    const estado = estadoLogistica(req.body.estado);

    if (!placa || !detalle) {
      req.session.error = "Debe indicar placa y qué tiene malo.";
      return res.redirect(`/logistica-taller?fecha=${encodeURIComponent(fecha)}`);
    }

    const [[unidad]] = await pool.query(
      `SELECT id, sede FROM unidades WHERE ${expresionPlacaSql("placa")} IN (?) LIMIT 1`,
      [variantesPlaca(placa)]
    );

    await pool.query(
      `INSERT INTO logistica_taller
       (fecha, unidad_id, placa, sede, detalle_malo, tipo_mantenimiento, estado, creado_por, actualizado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fecha,
        unidad?.id || null,
        placa,
        unidad?.sede || null,
        detalle,
        tipo,
        estado,
        req.session.user.id || null,
        req.session.user.id || null
      ]
    );

    req.session.success = `Unidad ${placa} agregada a logística taller.`;
    res.redirect(`/logistica-taller?fecha=${encodeURIComponent(fecha)}`);
  } catch (error) {
    console.error("Error agregando logística taller:", error);
    req.session.error = "No se pudo agregar la unidad.";
    res.redirect("/logistica-taller");
  }
});

router.post("/:id", async (req, res) => {
  try {
    await ensureLogisticaTallerTable();
    const fecha = fechaValida(req.body.fecha);
    const tipo = normalizarTipoMantenimiento(req.body.tipo_mantenimiento);
    const estado = estadoLogistica(req.body.estado);
    const detalle = String(req.body.detalle_malo || "").trim();
    const sedesFiltro = await obtenerSedesFiltro(req);
    const condiciones = ["id = ?"];
    const params = [
      detalle || null,
      tipo,
      estado,
      req.session.user.id || null,
      req.params.id
    ];

    if (sedesFiltro.length) {
      condiciones.push("(sede IN (?) OR sede IS NULL OR sede = '')");
      params.push(sedesFiltro);
    }

    const [result] = await pool.query(
      `UPDATE logistica_taller
       SET detalle_malo = ?,
           tipo_mantenimiento = ?,
           estado = ?,
           actualizado_por = ?
       WHERE ${condiciones.join(" AND ")}`,
      params
    );

    req.session[result.affectedRows ? "success" : "error"] = result.affectedRows
      ? "Logística actualizada."
      : "Registro no encontrado o sin permiso.";
    res.redirect(`/logistica-taller?fecha=${encodeURIComponent(fecha)}`);
  } catch (error) {
    console.error("Error actualizando logística taller:", error);
    req.session.error = "No se pudo actualizar logística.";
    res.redirect("/logistica-taller");
  }
});

router.get("/excel", async (req, res) => {
  try {
    await ensureLogisticaTallerTable();
    const fecha = fechaValida(req.query.fecha);
    await sincronizarPrioridadesDelDia(fecha, req);
    const registros = await obtenerRegistros(req, fecha);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Logistica Taller");
    sheet.columns = [
      { header: "Fecha", key: "fecha", width: 14 },
      { header: "Sede", key: "sede", width: 24 },
      { header: "Placa", key: "placa", width: 16 },
      { header: "Que tiene malo", key: "detalle", width: 60 },
      { header: "Tipo", key: "tipo", width: 16 },
      { header: "Estado", key: "estado", width: 16 },
      { header: "Prioridad original", key: "prioridad", width: 50 },
      { header: "Actualizado por", key: "actualizado_por", width: 22 }
    ];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F2F6E" } };

    registros.forEach(item => {
      sheet.addRow({
        fecha,
        sede: etiquetaSede(item.sede),
        placa: item.placa,
        detalle: item.detalle_malo || item.prioridad_observacion || "-",
        tipo: item.tipo_mantenimiento,
        estado: item.estado.replace("_", " "),
        prioridad: item.prioridad_observacion || "-",
        actualizado_por: item.actualizado_por_nombre || "-"
      });
    });

    sheet.eachRow(row => {
      row.alignment = { vertical: "top", wrapText: true };
    });
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=logistica_taller_${fecha}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error exportando logística taller:", error);
    res.status(500).send("Error exportando logística taller");
  }
});

module.exports = router;
