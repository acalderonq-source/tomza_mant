const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  ensureRepuestosSolicitudesTable,
  etiquetaEstadoRepuesto
} = require("../utils/repuestosSolicitudes");

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

router.use(requireAuth);

const ROLES_VER_TALLER = ["ADMIN", "TALLER", "MECANICO", "SUPERVISOR", "SUPERVISOR_PESADO"];
const ROLES_GESTION_TALLER = ["ADMIN", "TALLER", "MECANICO"];
const ROLES_PRIORIDADES_TALLER = ["ADMIN", "TALLER"];
const SEDES_TRANSPORTE = ["Transportadora", "Granel"];

function puedeVerTaller(user) {
  return ROLES_VER_TALLER.includes(user.rol);
}

function puedeGestionarTaller(user) {
  return ROLES_GESTION_TALLER.includes(user.rol);
}

function puedeGestionarPrioridades(user) {
  return ROLES_PRIORIDADES_TALLER.includes(user.rol);
}

async function columnExists(tableName, columnName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
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
    if (!(await columnExists("unidades", column))) {
      await pool.query(`ALTER TABLE unidades ADD COLUMN ${column} ${definition}`);
    }
  }
}

async function ensurePrioridadesTallerTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS taller_prioridades (
      id INT AUTO_INCREMENT PRIMARY KEY,
      placa VARCHAR(50) NOT NULL,
      sede VARCHAR(80) NULL,
      observacion TEXT NOT NULL,
      estado ENUM('PENDIENTE','ATENDIDA') NOT NULL DEFAULT 'PENDIENTE',
      creado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atendido_por INT NULL,
      atendido_en DATETIME NULL,
      INDEX idx_taller_prioridades_estado (estado),
      INDEX idx_taller_prioridades_sede (sede),
      INDEX idx_taller_prioridades_creado (creado_en)
    )
  `);
}

async function obtenerSedesPermitidas(req) {
  const user = req.session.user;

  if (user.rol === "ADMIN") {
    if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
      return [req.session.sedeSeleccionada];
    }
    return [];
  }

  const [extras] = await pool.query(
    `SELECT sede
     FROM usuarios_sedes
     WHERE usuario_id = ?`,
    [user.id]
  );

  const sedesExtras = extras.map(e => e.sede);
  const sedes = [...new Set([user.sede, ...sedesExtras].filter(Boolean))];

  if (req.session.sedeSeleccionada && sedes.includes(req.session.sedeSeleccionada)) {
    return [req.session.sedeSeleccionada];
  }

  return sedes;
}

function expandirSedesTransporte(sedes) {
  if (!Array.isArray(sedes) || sedes.length === 0) return sedes;
  const set = new Set(sedes.filter(Boolean));
  if (sedes.some(sede => SEDES_TRANSPORTE.includes(sede))) {
    SEDES_TRANSPORTE.forEach(sede => set.add(sede));
  }
  return [...set];
}

function aplicarFiltroSedes(sql, params, sedesPermitidas, alias = "u") {
  if (sedesPermitidas.length > 0) {
    return {
      sql: `${sql} AND ${alias}.sede IN (?)`,
      params: [...params, sedesPermitidas]
    };
  }
  return { sql, params };
}

function normalizarTrabajoTexto(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[|.,;:]+$/g, "")
    .trim();
}

function dividirTrabajos(value) {
  return String(value || "")
    .split(/\s*\|\s*|\n+/)
    .map(texto => texto.trim())
    .filter(Boolean);
}

function unirTextoUnico(actual, nuevo, separador = " / ") {
  const existentes = new Set(
    String(actual || "")
      .split(separador)
      .map(normalizarTrabajoTexto)
      .filter(Boolean)
  );
  const nuevos = String(nuevo || "")
    .split(separador)
    .map(texto => texto.trim())
    .filter(Boolean)
    .filter(texto => {
      const key = normalizarTrabajoTexto(texto);
      if (!key || existentes.has(key)) return false;
      existentes.add(key);
      return true;
    });

  return [actual, ...nuevos].filter(Boolean).join(separador);
}

function agruparTrabajosPorPlaca(rows, diasCercanos = 2) {
  const grupos = [];
  const ventanaMs = diasCercanos * 24 * 60 * 60 * 1000;

  for (const row of rows) {
    const fecha = row.fecha ? new Date(row.fecha) : new Date(0);
    const placa = String(row.placa || "").trim().toUpperCase();
    if (!placa) continue;

    let grupo = grupos.find(item =>
      item.placa === placa &&
      Math.abs(new Date(item.fecha).getTime() - fecha.getTime()) <= ventanaMs
    );

    if (!grupo) {
      grupo = {
        id: row.id,
        fecha: row.fecha,
        fecha_inicio: row.fecha,
        fecha_fin: row.fecha,
        placa,
        sede: row.sede,
        trabajo_realizado: "",
        trabajos: [],
        pendiente: null,
        mecanicos: "",
        tipos: "",
        registros: 0,
        trabajosKeys: new Set(),
        tiposKeys: new Set()
      };
      grupos.push(grupo);
    }

    grupo.registros += 1;
    const fechaInicio = new Date(grupo.fecha_inicio);
    const fechaFin = new Date(grupo.fecha_fin);
    if (fecha < fechaInicio) grupo.fecha_inicio = row.fecha;
    if (fecha > fechaFin) {
      grupo.fecha_fin = row.fecha;
      grupo.fecha = row.fecha;
    }

    for (const trabajo of dividirTrabajos(row.trabajo_realizado)) {
      const key = normalizarTrabajoTexto(trabajo);
      if (!key || grupo.trabajosKeys.has(key)) continue;
      grupo.trabajosKeys.add(key);
      grupo.trabajos.push({
        tipo: row.tipo,
        texto: trabajo
      });
    }

    if (row.pendiente) {
      grupo.pendiente = unirTextoUnico(grupo.pendiente, row.pendiente);
    }
    grupo.mecanicos = unirTextoUnico(grupo.mecanicos, row.mecanicos);

    const tipoKey = normalizarTrabajoTexto(row.tipo);
    if (tipoKey && !grupo.tiposKeys.has(tipoKey)) {
      grupo.tiposKeys.add(tipoKey);
      grupo.tipos = [grupo.tipos, row.tipo].filter(Boolean).join(" + ");
    }
  }

  return grupos
    .map(grupo => {
      delete grupo.trabajosKeys;
      delete grupo.tiposKeys;
      grupo.trabajo_realizado = grupo.trabajos.map(t => `${t.tipo}: ${t.texto}`).join(" | ");
      grupo.mecanicos = grupo.mecanicos || "Sin asignar";
      grupo.tipos = grupo.tipos || "Trabajo";
      return grupo;
    })
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    .slice(0, 8);
}

async function obtenerUltimosTrabajosAgrupados(sedesPermitidas) {
  let trabajosSql = `
    SELECT
      CONCAT('C', c.id) AS id,
      c.fecha,
      u.placa,
      u.sede,
      'Correctivo' AS tipo,
      c.trabajo_realizado,
      c.pendiente,
      COALESCE(GROUP_CONCAT(DISTINCT me.nombre ORDER BY me.nombre SEPARATOR ' / '), 'Sin asignar') AS mecanicos
    FROM correctivos c
    JOIN unidades u ON u.id = c.unidad_id
    LEFT JOIN correctivo_trabajos ct ON ct.correctivo_id = c.id
    LEFT JOIN mecanicos me ON me.id = ct.mecanico_id
    WHERE c.fecha >= DATE_SUB(NOW(), INTERVAL 21 DAY)
  `;
  let trabajosParams = [];
  ({ sql: trabajosSql, params: trabajosParams } = aplicarFiltroSedes(trabajosSql, trabajosParams, sedesPermitidas, "u"));
  trabajosSql += `
    GROUP BY c.id, c.fecha, u.placa, u.sede, c.trabajo_realizado, c.pendiente

    UNION ALL

    SELECT
      CONCAT('P', m.id) AS id,
      COALESCE(m.fecha_cierre, m.fecha_programada) AS fecha,
      u.placa,
      u.sede,
      'Preventivo' AS tipo,
      m.ejecucion AS trabajo_realizado,
      m.pendiente,
      COALESCE(GROUP_CONCAT(DISTINCT me.nombre ORDER BY me.nombre SEPARATOR ' / '), 'Sin asignar') AS mecanicos
    FROM mantenimientos m
    JOIN unidades u ON u.id = m.unidad_id
    LEFT JOIN mantenimiento_mecanicos mm ON mm.mantenimiento_id = m.id
    LEFT JOIN mecanicos me ON me.id = mm.mecanico_id
    WHERE m.estado = 'CERRADO'
      AND COALESCE(m.fecha_cierre, m.fecha_programada) >= DATE_SUB(NOW(), INTERVAL 21 DAY)
  `;
  let preventivosParams = [];
  ({ sql: trabajosSql, params: preventivosParams } = aplicarFiltroSedes(trabajosSql, preventivosParams, sedesPermitidas, "u"));
  trabajosSql += `
    GROUP BY m.id, COALESCE(m.fecha_cierre, m.fecha_programada), u.placa, u.sede, m.ejecucion, m.pendiente
    ORDER BY fecha DESC
    LIMIT 80
  `;

  const [rows] = await pool.query(trabajosSql, [...trabajosParams, ...preventivosParams]);
  return agruparTrabajosPorPlaca(rows, 2);
}

router.get("/dashboard", async (req, res) => {
  try {
    if (!puedeVerTaller(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    await ensureUnidadEstadoColumns();
    await ensurePrioridadesTallerTable();
    await ensureRepuestosSolicitudesTable(pool);
    const sedesPermitidas = expandirSedesTransporte(await obtenerSedesPermitidas(req));
    const placaFiltro = String(req.query.placa || "").trim().toUpperCase();
    const estadoFiltro = req.query.estado || "taller";

    let sql = `
      SELECT
        u.id,
        u.placa,
        u.sede,
        u.activa,
        u.varada,
        u.razon_varada,
        c.id AS ultimo_correctivo_id,
        c.fecha AS ultimo_correctivo_fecha,
        c.trabajo_realizado AS ultimo_trabajo,
        c.pendiente AS ultimo_pendiente,
        m.fecha_programada AS preventivo_fecha,
        m.plan AS preventivo_plan,
        m.estado AS preventivo_estado
      FROM unidades u
      LEFT JOIN correctivos c ON c.id = (
        SELECT c2.id
        FROM correctivos c2
        WHERE c2.unidad_id = u.id
        ORDER BY c2.fecha DESC, c2.id DESC
        LIMIT 1
      )
      LEFT JOIN mantenimientos m ON m.id = (
        SELECT m2.id
        FROM mantenimientos m2
        WHERE m2.unidad_id = u.id
          AND m2.estado != 'CERRADO'
        ORDER BY m2.fecha_programada ASC, m2.id ASC
        LIMIT 1
      )
      WHERE COALESCE(u.activa, 1) = 1
    `;
    let params = [];

    ({ sql, params } = aplicarFiltroSedes(sql, params, sedesPermitidas, "u"));

    if (estadoFiltro === "taller") {
      sql += " AND COALESCE(u.varada, 0) = 1";
    } else if (estadoFiltro === "disponibles") {
      sql += " AND COALESCE(u.varada, 0) = 0";
    }

    if (placaFiltro) {
      sql += " AND u.placa LIKE ?";
      params.push(`%${placaFiltro}%`);
    }

    sql += " ORDER BY COALESCE(u.varada, 0) DESC, u.sede, u.placa";
    const [unidades] = await pool.query(sql, params);

    const ultimosCorrectivos = await obtenerUltimosTrabajosAgrupados(sedesPermitidas);

    let prioridadesSql = `
      SELECT
        tp.id,
        tp.placa,
        COALESCE(NULLIF(tp.sede, ''), un.sede) AS sede,
        tp.observacion,
        tp.estado,
        tp.creado_en,
        usr.usuario AS creado_por_nombre
      FROM taller_prioridades tp
      LEFT JOIN usuarios usr ON usr.id = tp.creado_por
      LEFT JOIN unidades un ON UPPER(TRIM(un.placa)) = UPPER(TRIM(tp.placa))
      WHERE tp.estado = 'PENDIENTE'
        AND DATE(tp.creado_en) = CURDATE()
    `;
    let prioridadesParams = [];
    if (sedesPermitidas.length > 0) {
      prioridadesSql += " AND (COALESCE(NULLIF(tp.sede, ''), un.sede) IN (?) OR tp.sede IS NULL OR tp.sede = '')";
      prioridadesParams.push(sedesPermitidas);
    }
    prioridadesSql += " ORDER BY tp.creado_en DESC, tp.id DESC LIMIT 20";
    const [prioridades] = await pool.query(prioridadesSql, prioridadesParams);
    const prioridadesPesados = prioridades.filter(p =>
      SEDES_TRANSPORTE.includes(p.sede) ||
      String(p.creado_por_nombre || "").toLowerCase() === "pesados"
    );
    const prioridadesMecanico = prioridades.filter(p => !prioridadesPesados.some(pesado => pesado.id === p.id));

    let repuestosSql = `
      SELECT
        id,
        fecha_solicitud,
        sede,
        placa,
        repuesto_solicitado,
        cantidad,
        prioridad,
        estado,
        proveedor
      FROM solicitudes_repuestos
      WHERE estado <> 'ENTREGADO'
    `;
    const repuestosParams = [];
    if (sedesPermitidas.length > 0) {
      repuestosSql += " AND sede IN (?)";
      repuestosParams.push(sedesPermitidas);
    }
    repuestosSql += `
      ORDER BY
        CASE estado
          WHEN 'PENDIENTE_COMPRAR' THEN 1
          WHEN 'PEDIDO' THEN 2
          WHEN 'EN_TRANSITO' THEN 3
          ELSE 4
        END,
        CASE prioridad WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END,
        fecha_solicitud DESC,
        id DESC
      LIMIT 8
    `;
    const [solicitudesRepuestos] = await pool.query(repuestosSql, repuestosParams);

    let resumenSql = `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN COALESCE(varada, 0) = 1 THEN 1 ELSE 0 END) AS en_taller,
        SUM(CASE WHEN COALESCE(varada, 0) = 0 THEN 1 ELSE 0 END) AS disponibles
      FROM unidades u
      WHERE COALESCE(activa, 1) = 1
    `;
    let resumenParams = [];
    ({ sql: resumenSql, params: resumenParams } = aplicarFiltroSedes(resumenSql, resumenParams, sedesPermitidas, "u"));
    const [[resumenRow]] = await pool.query(resumenSql, resumenParams);

    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("taller_dashboard", {
      user: req.session.user,
      unidades,
      filtros: { placa: placaFiltro, estado: estadoFiltro },
      resumen: {
        total: Number(resumenRow.total || 0),
        enTaller: Number(resumenRow.en_taller || 0),
        disponibles: Number(resumenRow.disponibles || 0)
      },
      ultimosCorrectivos,
      prioridades,
      prioridadesPesados,
      prioridadesMecanico,
      solicitudesRepuestos,
      etiquetaEstadoRepuesto,
      sedeSeleccionada: sedesPermitidas.length > 1 && sedesPermitidas.some(sede => SEDES_TRANSPORTE.includes(sede))
        ? "Transportadora + Granel"
        : req.session.sedeSeleccionada || "TODAS",
      puedeGestionar: puedeGestionarTaller(req.session.user),
      puedeGestionarPrioridades: puedeGestionarPrioridades(req.session.user),
      success,
      error
    });
  } catch (error) {
    console.error("ERROR dashboard taller:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/prioridades", async (req, res) => {
  try {
    if (!puedeGestionarPrioridades(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    await ensurePrioridadesTallerTable();
    const placa = String(req.body.placa || "").trim().toUpperCase();
    const observacion = String(req.body.observacion || "").trim();
    const sedesPermitidas = expandirSedesTransporte(await obtenerSedesPermitidas(req));

    if (!placa || !observacion) {
      req.session.error = "Debe indicar placa y observación para la prioridad.";
      return res.redirect("/taller/dashboard");
    }

    let sedeAsignada = req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS"
      ? req.session.sedeSeleccionada
      : req.session.user.sede || null;

    if (sedesPermitidas.length === 1) {
      sedeAsignada = sedesPermitidas[0];
    }

    await pool.query(
      `INSERT INTO taller_prioridades (placa, sede, observacion, creado_por)
       VALUES (?, ?, ?, ?)`,
      [placa, sedeAsignada, observacion, req.session.user.id]
    );

    req.session.success = `Prioridad agregada para la unidad ${placa}.`;
    res.redirect("/taller/dashboard");
  } catch (error) {
    console.error("ERROR agregando prioridad taller:", error);
    req.session.error = "Error interno al agregar la prioridad.";
    res.redirect("/taller/dashboard");
  }
});

router.post("/prioridades/:id/atendida", async (req, res) => {
  try {
    if (!puedeGestionarPrioridades(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    await ensurePrioridadesTallerTable();
    const id = Number(req.params.id);
    const sedesPermitidas = expandirSedesTransporte(await obtenerSedesPermitidas(req));

    if (!Number.isInteger(id)) {
      req.session.error = "Prioridad inválida.";
      return res.redirect("/taller/dashboard");
    }

    let sql = `
      UPDATE taller_prioridades
      SET estado = 'ATENDIDA',
          atendido_por = ?,
          atendido_en = NOW()
      WHERE id = ?
        AND estado = 'PENDIENTE'
    `;
    const params = [req.session.user.id, id];

    if (sedesPermitidas.length > 0) {
      sql += " AND (sede IN (?) OR sede IS NULL OR sede = '')";
      params.push(sedesPermitidas);
    }

    const [result] = await pool.query(sql, params);
    req.session[result.affectedRows ? "success" : "error"] = result.affectedRows
      ? "Prioridad marcada como atendida."
      : "No se encontró la prioridad o no tiene permiso para atenderla.";
    res.redirect("/taller/dashboard");
  } catch (error) {
    console.error("ERROR atendiendo prioridad taller:", error);
    req.session.error = "Error interno al atender la prioridad.";
    res.redirect("/taller/dashboard");
  }
});

router.post("/unidades/:id/estado", async (req, res) => {
  try {
    if (!puedeGestionarTaller(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    await ensureUnidadEstadoColumns();
    const id = Number(req.params.id);
    const varada = req.body.varada === "1" ? 1 : 0;
    const razon = String(req.body.razon_varada || "").trim();
    const sedesPermitidas = expandirSedesTransporte(await obtenerSedesPermitidas(req));

    if (!Number.isInteger(id)) {
      req.session.error = "Unidad inválida.";
      return res.redirect("/taller/dashboard");
    }

    if (varada && !razon) {
      req.session.error = "Debe indicar la razón para dejar la unidad en taller.";
      return res.redirect("/taller/dashboard");
    }

    let sql = "UPDATE unidades u SET u.varada = ?, u.razon_varada = ? WHERE u.id = ?";
    let params = [varada, varada ? razon : null, id];
    ({ sql, params } = aplicarFiltroSedes(sql, params, sedesPermitidas, "u"));

    const [result] = await pool.query(sql, params);
    if (!result.affectedRows) {
      req.session.error = "Unidad no encontrada o sin permiso para esta sede.";
      return res.redirect("/taller/dashboard");
    }

    req.session.success = varada ? "Unidad marcada en taller." : "Unidad marcada como lista para ruta.";
    res.redirect("/taller/dashboard");
  } catch (error) {
    console.error("ERROR actualizando estado taller:", error);
    req.session.error = "Error interno al actualizar la unidad.";
    res.redirect("/taller/dashboard");
  }
});

module.exports = router;
