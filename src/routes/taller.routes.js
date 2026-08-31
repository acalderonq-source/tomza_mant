const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  ensureRepuestosSolicitudesTable,
  etiquetaEstadoRepuesto
} = require("../utils/repuestosSolicitudes");
const {
  agregarTallerParaMecanico,
  SEDES_TRANSPORTE,
  esSedeTransporte,
  esUsuarioTodasSedes,
  expandirSedesEquivalentes,
  obtenerSedesTransporte,
  sedeGranelDesdeUsuario
} = require("../utils/sedes");
const { agregarFiltroPlacaSql, expresionPlacaSql, normalizarPlaca, variantesPlaca } = require("../utils/placas");

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

router.use(requireAuth);

const ROLES_VER_TALLER = ["ADMIN", "TALLER", "MECANICO", "SUPERVISOR", "SUPERVISOR_PESADO"];
const ROLES_GESTION_TALLER = ["ADMIN", "TALLER", "MECANICO"];
const ROLES_PRIORIDADES_TALLER = ["ADMIN", "TALLER", "SUPERVISOR_PESADO"];
const SQL_SEDE_TRANSPORTE_EXPR = "UPPER(TRIM(COALESCE(NULLIF(tp.sede, ''), un.sede, '')))";
const SQL_ES_SEDE_TRANSPORTE = `(${SQL_SEDE_TRANSPORTE_EXPR} IN ('TRANSPORTADORA', 'GRANEL', 'GRANEL_CARTAGO', 'CABEZALES', 'CISTERNAS', 'CARRETAS', 'TANDEM', 'TÁNDEM', 'TAMDEN') OR ${SQL_SEDE_TRANSPORTE_EXPR} LIKE 'GRANEL_%')`;

function fechaCostaRica(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function puedeVerTaller(user) {
  return ROLES_VER_TALLER.includes(user.rol);
}

function puedeGestionarTaller(user) {
  return ROLES_GESTION_TALLER.includes(user.rol);
}

function puedeGestionarPrioridades(user) {
  return ROLES_PRIORIDADES_TALLER.includes(user.rol);
}

function esUsuarioPesados(user) {
  const usuario = String(user.usuario || user.nombre || "").trim().toLowerCase();
  return (
    user.rol === "SUPERVISOR_PESADO" ||
    usuario.includes("pesado")
  );
}

function esUsuarioMecanico(user) {
  return (
    !esUsuarioPesados(user) &&
    (
      user.rol === "MECANICO" ||
      String(user.usuario || "").trim().toLowerCase() === "mecanico"
    )
  );
}

function esPrioridadPesados(prioridad) {
  return (
    prioridad.grupo_prioridad === "PESADOS" ||
    esSedeTransporte(prioridad.sede) ||
    String(prioridad.creado_por_nombre || "").trim().toLowerCase().includes("pesado")
  );
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
      fecha_prioridad DATE NULL,
      observacion TEXT NOT NULL,
      estado ENUM('PENDIENTE','ATENDIDA') NOT NULL DEFAULT 'PENDIENTE',
      creado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atendido_por INT NULL,
      atendido_en DATETIME NULL,
      INDEX idx_taller_prioridades_estado (estado),
      INDEX idx_taller_prioridades_sede (sede),
      INDEX idx_taller_prioridades_fecha (fecha_prioridad),
      INDEX idx_taller_prioridades_creado (creado_en)
    )
  `);

  if (!(await columnExists("taller_prioridades", "fecha_prioridad"))) {
    await pool.query("ALTER TABLE taller_prioridades ADD COLUMN fecha_prioridad DATE NULL AFTER sede");
    await pool.query("UPDATE taller_prioridades SET fecha_prioridad = DATE(creado_en) WHERE fecha_prioridad IS NULL");
  }

  if (!(await columnExists("taller_prioridades", "atendido_por"))) {
    await pool.query("ALTER TABLE taller_prioridades ADD COLUMN atendido_por INT NULL AFTER creado_en");
  }

  if (!(await columnExists("taller_prioridades", "atendido_en"))) {
    await pool.query("ALTER TABLE taller_prioridades ADD COLUMN atendido_en DATETIME NULL AFTER atendido_por");
  }
}

async function obtenerSedesPermitidas(req) {
  const user = req.session.user;
  const sedeGranelUsuario = sedeGranelDesdeUsuario(user);

  if (esUsuarioTodasSedes(user)) {
    if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
      return [req.session.sedeSeleccionada];
    }
    return [];
  }

  if (sedeGranelUsuario) {
    if (
      req.session.sedeSeleccionada &&
      req.session.sedeSeleccionada !== "TODAS" &&
      req.session.sedeSeleccionada === sedeGranelUsuario
    ) {
      return [req.session.sedeSeleccionada];
    }
    return [sedeGranelUsuario];
  }

  if (esUsuarioPesados(user)) {
    if (
      req.session.sedeSeleccionada &&
      req.session.sedeSeleccionada !== "TODAS" &&
      esSedeTransporte(req.session.sedeSeleccionada)
    ) {
      return [req.session.sedeSeleccionada];
    }
    return obtenerSedesTransporte(pool);
  }

  const [extras] = await pool.query(
    `SELECT sede
     FROM usuarios_sedes
     WHERE usuario_id = ?`,
    [user.id]
  );

  const sedesExtras = extras.map(e => e.sede);
  const sedes = agregarTallerParaMecanico(user, [user.sede, ...sedesExtras]);

  if (req.session.sedeSeleccionada && sedes.includes(req.session.sedeSeleccionada)) {
    return [req.session.sedeSeleccionada];
  }

  return sedes;
}

function expandirSedesTransporte(sedes) {
  return expandirSedesEquivalentes(sedes);
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

function fechaSqlDesdeValor(value) {
  if (!value) return null;
  const texto = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function fechaHoraFinDia(value) {
  const fecha = fechaSqlDesdeValor(value);
  return fecha ? `${fecha} 23:59:59` : null;
}

function fechaHoraInicioDia(value) {
  const fecha = fechaSqlDesdeValor(value);
  return fecha ? `${fecha} 00:00:00` : null;
}

function calcularDiasTaller(inicio, fin) {
  const inicioSql = fechaSqlDesdeValor(inicio);
  const finSql = fechaSqlDesdeValor(fin) || fechaCostaRica();
  if (!inicioSql || !finSql) return 1;
  const inicioDate = new Date(`${inicioSql}T00:00:00`);
  const finDate = new Date(`${finSql}T00:00:00`);
  if (Number.isNaN(inicioDate.getTime()) || Number.isNaN(finDate.getTime())) return 1;
  return Math.max(1, Math.floor((finDate - inicioDate) / 86400000) + 1);
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

async function obtenerDetalleHistorialPrioridad(prioridad) {
  const placas = variantesPlaca(prioridad.placa);
  const inicio = fechaHoraInicioDia(prioridad.fecha_entrada || prioridad.creado_en);
  const fin = fechaHoraFinDia(prioridad.fecha_salida || prioridad.atendido_en);

  if (!placas.length || !inicio || !fin) {
    return { mantenimientos: [], repuestos: [] };
  }

  const [mantenimientos] = await pool.query(
    `
    SELECT *
    FROM (
      SELECT
        CONCAT('C-', c.id) AS numero,
        'CORRECTIVO' AS tipo,
        c.fecha AS fecha,
        DATE_FORMAT(c.fecha, '%d/%m/%Y') AS fecha_formato,
        u.placa,
        u.sede,
        c.trabajo_realizado AS detalle,
        c.pendiente,
        COALESCE(GROUP_CONCAT(DISTINCT me.nombre ORDER BY me.nombre SEPARATOR ', '), 'Sin asignar') AS mecanicos
      FROM correctivos c
      JOIN unidades u ON u.id = c.unidad_id
      LEFT JOIN correctivo_trabajos ct ON ct.correctivo_id = c.id
      LEFT JOIN mecanicos me ON me.id = ct.mecanico_id
      WHERE ${expresionPlacaSql("u.placa")} IN (?)
        AND c.fecha BETWEEN ? AND ?
      GROUP BY c.id, c.fecha, u.placa, u.sede, c.trabajo_realizado, c.pendiente

      UNION ALL

      SELECT
        COALESCE(m.numero_mantenimiento, CONCAT('M-', m.id)) AS numero,
        m.tipo AS tipo,
        COALESCE(m.fecha_cierre, m.fecha_programada) AS fecha,
        DATE_FORMAT(COALESCE(m.fecha_cierre, m.fecha_programada), '%d/%m/%Y') AS fecha_formato,
        u.placa,
        u.sede,
        COALESCE(m.ejecucion, m.plan) AS detalle,
        m.pendiente,
        COALESCE(GROUP_CONCAT(DISTINCT me.nombre ORDER BY me.nombre SEPARATOR ', '), 'Sin asignar') AS mecanicos
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      LEFT JOIN mantenimiento_mecanicos mm ON mm.mantenimiento_id = m.id
      LEFT JOIN mecanicos me ON me.id = mm.mecanico_id
      WHERE ${expresionPlacaSql("u.placa")} IN (?)
        AND COALESCE(m.fecha_cierre, m.fecha_programada) BETWEEN ? AND ?
      GROUP BY m.id, m.numero_mantenimiento, m.tipo, m.fecha_cierre, m.fecha_programada, u.placa, u.sede, m.ejecucion, m.plan, m.pendiente
    ) movimientos
    ORDER BY fecha DESC, numero DESC
    `,
    [placas, inicio, fin, placas, inicio, fin]
  );

  const [repuestos] = await pool.query(
    `SELECT
       id,
       fecha_solicitud,
       DATE_FORMAT(fecha_solicitud, '%d/%m/%Y') AS fecha_formato,
       placa,
       sede,
       repuesto_solicitado,
       cantidad,
       prioridad,
       estado,
       proveedor
     FROM solicitudes_repuestos
     WHERE ${expresionPlacaSql("placa")} IN (?)
       AND fecha_solicitud BETWEEN ? AND ?
     ORDER BY fecha_solicitud DESC, id DESC`,
    [placas, inicio, fin]
  );

  return { mantenimientos, repuestos };
}

router.get("/prioridades-historial", async (req, res) => {
  try {
    if (!puedeVerTaller(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    await ensurePrioridadesTallerTable();
    await ensureRepuestosSolicitudesTable(pool);

    const sedesPermitidas = expandirSedesTransporte(await obtenerSedesPermitidas(req));
    const placaFiltro = String(req.query.placa || "").trim();
    const fechaDesde = String(req.query.fecha_desde || "").trim();
    const fechaHasta = String(req.query.fecha_hasta || "").trim();
    const condiciones = ["tp.estado = 'ATENDIDA'"];
    const params = [];

    if (sedesPermitidas.length > 0) {
      condiciones.push("COALESCE(NULLIF(tp.sede, ''), un.sede) IN (?)");
      params.push(sedesPermitidas);
    }

    if (placaFiltro) {
      const condicionesPlaca = [];
      agregarFiltroPlacaSql(condicionesPlaca, params, "tp.placa", placaFiltro);
      if (condicionesPlaca.length) condiciones.push(condicionesPlaca[0]);
    }

    if (fechaDesde) {
      condiciones.push("DATE(tp.atendido_en) >= ?");
      params.push(fechaDesde);
    }

    if (fechaHasta) {
      condiciones.push("DATE(tp.atendido_en) <= ?");
      params.push(fechaHasta);
    }

    const [rows] = await pool.query(
      `SELECT
         tp.id,
         tp.placa,
         COALESCE(NULLIF(tp.sede, ''), un.sede) AS sede,
         tp.observacion,
         tp.creado_en,
         DATE_FORMAT(tp.creado_en, '%d/%m/%Y %H:%i') AS creado_formato,
         COALESCE(tp.fecha_prioridad, DATE(tp.creado_en)) AS fecha_entrada,
         DATE_FORMAT(COALESCE(tp.fecha_prioridad, DATE(tp.creado_en)), '%d/%m/%Y') AS entrada_formato,
         tp.atendido_en,
         DATE(tp.atendido_en) AS fecha_salida,
         DATE_FORMAT(tp.atendido_en, '%d/%m/%Y %H:%i') AS salida_formato,
         uc.usuario AS creado_por_nombre,
         ua.usuario AS atendido_por_nombre
       FROM taller_prioridades tp
       LEFT JOIN unidades un ON ${expresionPlacaSql("un.placa")} = ${expresionPlacaSql("tp.placa")}
       LEFT JOIN usuarios uc ON uc.id = tp.creado_por
       LEFT JOIN usuarios ua ON ua.id = tp.atendido_por
       WHERE ${condiciones.join(" AND ")}
       ORDER BY tp.atendido_en DESC, tp.id DESC
       LIMIT 80`,
      params
    );

    const historiales = [];
    for (const row of rows) {
      const detalle = await obtenerDetalleHistorialPrioridad(row);
      historiales.push({
        ...row,
        dias_taller: calcularDiasTaller(row.fecha_entrada || row.creado_en, row.fecha_salida || row.atendido_en),
        mantenimientos: detalle.mantenimientos,
        repuestos: detalle.repuestos
      });
    }

    const resumen = historiales.reduce((acc, item) => {
      acc.salidas += 1;
      acc.dias += Number(item.dias_taller || 0);
      acc.mantenimientos += item.mantenimientos.length;
      acc.repuestos += item.repuestos.length;
      return acc;
    }, { salidas: 0, dias: 0, mantenimientos: 0, repuestos: 0 });

    res.render("taller_prioridades_historial", {
      user: req.session.user,
      historiales,
      resumen,
      filtros: { placa: placaFiltro, fecha_desde: fechaDesde, fecha_hasta: fechaHasta },
      sedeSeleccionada: sedesPermitidas.length ? "Sedes permitidas" : "TODAS",
      etiquetaEstadoRepuesto
    });
  } catch (error) {
    console.error("ERROR historial prioridades taller:", error);
    res.status(500).send("Error cargando historial de prioridades");
  }
});

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
      const condicionesPlaca = [];
      agregarFiltroPlacaSql(condicionesPlaca, params, "u.placa", placaFiltro);
      if (condicionesPlaca.length) {
        sql += ` AND ${condicionesPlaca[0]}`;
      }
    }

    sql += " ORDER BY COALESCE(u.varada, 0) DESC, u.sede, u.placa";
    const [unidades] = await pool.query(sql, params);

    const ultimosCorrectivos = await obtenerUltimosTrabajosAgrupados(sedesPermitidas);
    const fechaPrioridadHoy = fechaCostaRica();
    const fechaPrioridadDefault = fechaCostaRica(1);

    let prioridadesSql = `
      SELECT
        tp.id,
        tp.placa,
        COALESCE(NULLIF(tp.sede, ''), un.sede) AS sede,
        CASE
          WHEN ${SQL_ES_SEDE_TRANSPORTE}
            OR LOWER(TRIM(COALESCE(usr.usuario, ''))) LIKE '%pesado%'
          THEN 'PESADOS'
          ELSE 'MECANICO'
        END AS grupo_prioridad,
        COALESCE(tp.fecha_prioridad, DATE(tp.creado_en)) AS fecha_prioridad,
        DATE_FORMAT(COALESCE(tp.fecha_prioridad, DATE(tp.creado_en)), '%d/%m/%Y') AS fecha_prioridad_formato,
        DATEDIFF(?, COALESCE(tp.fecha_prioridad, DATE(tp.creado_en))) + 1 AS dias_pendiente,
        tp.observacion,
        tp.estado,
        tp.creado_en,
        usr.usuario AS creado_por_nombre
      FROM taller_prioridades tp
      LEFT JOIN usuarios usr ON usr.id = tp.creado_por
      LEFT JOIN unidades un ON UPPER(TRIM(un.placa)) = UPPER(TRIM(tp.placa))
      WHERE tp.estado = 'PENDIENTE'
        AND COALESCE(tp.fecha_prioridad, DATE(tp.creado_en)) <= ?
    `;
    let prioridadesParams = [fechaPrioridadHoy, fechaPrioridadHoy];
    if (sedesPermitidas.length > 0 && !esUsuarioPesados(req.session.user)) {
      prioridadesSql += " AND (UPPER(TRIM(COALESCE(NULLIF(tp.sede, ''), un.sede))) IN (?) OR tp.sede IS NULL OR tp.sede = '')";
      prioridadesParams.push(sedesPermitidas.map(sede => String(sede).trim().toUpperCase()));
    }
    if (esUsuarioPesados(req.session.user)) {
      prioridadesSql += `
        ORDER BY
          CASE
            WHEN ${SQL_ES_SEDE_TRANSPORTE}
              OR LOWER(TRIM(COALESCE(usr.usuario, ''))) LIKE '%pesado%'
            THEN 0
            ELSE 1
          END,
          COALESCE(tp.fecha_prioridad, DATE(tp.creado_en)) ASC,
          tp.creado_en DESC,
          tp.id DESC
        LIMIT 20
      `;
    } else {
      prioridadesSql += " ORDER BY COALESCE(tp.fecha_prioridad, DATE(tp.creado_en)) ASC, tp.creado_en DESC, tp.id DESC LIMIT 20";
    }
    const [prioridadesTodas] = await pool.query(prioridadesSql, prioridadesParams);
    const prioridadesPesadosTodas = prioridadesTodas.filter(p =>
      esPrioridadPesados(p) || (esUsuarioPesados(req.session.user) && !p.sede)
    );
    const prioridadesMecanicoTodas = prioridadesTodas.filter(p => !prioridadesPesadosTodas.some(pesado => pesado.id === p.id));
    const prioridades = esUsuarioPesados(req.session.user)
      ? prioridadesPesadosTodas
      : esUsuarioMecanico(req.session.user)
        ? prioridadesMecanicoTodas
        : prioridadesTodas;
    const prioridadesPesados = esUsuarioMecanico(req.session.user) ? [] : prioridadesPesadosTodas;
    const prioridadesMecanico = esUsuarioPesados(req.session.user) ? [] : prioridadesMecanicoTodas;

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
      fechaPrioridadHoy,
      fechaPrioridadDefault,
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
    const placa = normalizarPlaca(req.body.placa);
    const observacion = String(req.body.observacion || "").trim();
    const fechaPrioridad = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.fecha_prioridad || ""))
      ? req.body.fecha_prioridad
      : fechaCostaRica(1);
    const sedesPermitidas = expandirSedesTransporte(await obtenerSedesPermitidas(req));

    if (!placa || !observacion) {
      req.session.error = "Debe indicar placa y observación para la prioridad.";
      return res.redirect("/taller/dashboard");
    }

    const [[unidadPrioridad]] = await pool.query(
      `SELECT sede FROM unidades WHERE ${expresionPlacaSql("placa")} IN (?) LIMIT 1`,
      [variantesPlaca(placa)]
    );

    let sedeAsignada = unidadPrioridad?.sede || (
      req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS"
      ? req.session.sedeSeleccionada
      : req.session.user.sede || null
    );

    if (!unidadPrioridad?.sede && sedesPermitidas.length === 1) {
      sedeAsignada = sedesPermitidas[0];
    }

    if (!unidadPrioridad?.sede && esUsuarioPesados(req.session.user)) {
      sedeAsignada = esSedeTransporte(req.session.sedeSeleccionada)
        ? req.session.sedeSeleccionada
        : "Transportadora";
    }

    if (esUsuarioPesados(req.session.user) && !esSedeTransporte(sedeAsignada)) {
      req.session.error = "El usuario de Pesados solo puede agregar prioridades de Granel o Transportadora.";
      return res.redirect("/taller/dashboard");
    }

    if (esUsuarioMecanico(req.session.user) && esSedeTransporte(sedeAsignada)) {
      req.session.error = "El usuario mecánico solo puede agregar prioridades de taller/Cartago.";
      return res.redirect("/taller/dashboard");
    }

    await pool.query(
      `INSERT INTO taller_prioridades (placa, sede, fecha_prioridad, observacion, creado_por)
       VALUES (?, ?, ?, ?, ?)`,
      [placa, sedeAsignada, fechaPrioridad, observacion, req.session.user.id]
    );

    req.session.success = `Prioridad agregada para la unidad ${placa} el ${fechaPrioridad}.`;
    res.redirect("/taller/dashboard");
  } catch (error) {
    console.error("ERROR agregando prioridad taller:", error);
    req.session.error = "Error interno al agregar la prioridad.";
    res.redirect("/taller/dashboard");
  }
});

router.post("/prioridades/:id", async (req, res) => {
  try {
    if (!puedeGestionarPrioridades(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    await ensurePrioridadesTallerTable();
    const id = Number(req.params.id);
    const placa = normalizarPlaca(req.body.placa);
    const observacion = String(req.body.observacion || "").trim();
    const fechaPrioridad = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.fecha_prioridad || ""))
      ? req.body.fecha_prioridad
      : fechaCostaRica(0);
    const sedesPermitidas = expandirSedesTransporte(await obtenerSedesPermitidas(req));

    if (!Number.isInteger(id) || !placa || !observacion) {
      req.session.error = "Debe indicar placa y observación para actualizar la prioridad.";
      return res.redirect("/taller/dashboard");
    }

    const [[prioridadActual]] = await pool.query(
      `SELECT
         tp.id,
         tp.placa AS placa_actual,
         tp.sede AS sede_guardada,
         tp.observacion AS observacion_actual,
         COALESCE(NULLIF(tp.sede, ''), un.sede) AS sede,
         usr.usuario AS creado_por_nombre
       FROM taller_prioridades tp
       LEFT JOIN usuarios usr ON usr.id = tp.creado_por
       LEFT JOIN unidades un ON UPPER(TRIM(un.placa)) = UPPER(TRIM(tp.placa))
       WHERE tp.id = ?
         AND tp.estado = 'PENDIENTE'
       LIMIT 1`,
      [id]
    );

    if (!prioridadActual) {
      req.session.error = "No se encontró la prioridad pendiente.";
      return res.redirect("/taller/dashboard");
    }

    if (esUsuarioPesados(req.session.user) && !esPrioridadPesados(prioridadActual)) {
      req.session.error = "El usuario de Pesados solo puede editar prioridades de Granel o Transportadora.";
      return res.redirect("/taller/dashboard");
    }

    if (esUsuarioMecanico(req.session.user) && esPrioridadPesados(prioridadActual)) {
      req.session.error = "El usuario mecánico solo puede editar prioridades de taller/Cartago.";
      return res.redirect("/taller/dashboard");
    }

    if (
      sedesPermitidas.length > 0 &&
      prioridadActual.sede &&
      !sedesPermitidas
        .map(sede => String(sede).trim().toUpperCase())
        .includes(String(prioridadActual.sede).trim().toUpperCase())
    ) {
      req.session.error = "No tiene permiso para editar prioridades de esta sede.";
      return res.redirect("/taller/dashboard");
    }

    const [[unidadNueva]] = await pool.query(
      `SELECT id, sede FROM unidades WHERE ${expresionPlacaSql("placa")} IN (?) LIMIT 1`,
      [variantesPlaca(placa)]
    );

    let sedeAsignada = unidadNueva?.sede || prioridadActual.sede_guardada || prioridadActual.sede || null;

    if (!unidadNueva?.sede && sedesPermitidas.length === 1) {
      sedeAsignada = sedesPermitidas[0];
    }

    if (!unidadNueva?.sede && esUsuarioPesados(req.session.user)) {
      sedeAsignada = esSedeTransporte(req.session.sedeSeleccionada)
        ? req.session.sedeSeleccionada
        : (esSedeTransporte(sedeAsignada) ? sedeAsignada : "Transportadora");
    }

    if (esUsuarioPesados(req.session.user) && !esSedeTransporte(sedeAsignada)) {
      req.session.error = "El usuario de Pesados solo puede dejar prioridades en Granel o Transportadora.";
      return res.redirect("/taller/dashboard");
    }

    if (esUsuarioMecanico(req.session.user) && esSedeTransporte(sedeAsignada)) {
      req.session.error = "El usuario mecánico solo puede dejar prioridades de taller/Cartago.";
      return res.redirect("/taller/dashboard");
    }

    if (
      sedesPermitidas.length > 0 &&
      sedeAsignada &&
      !sedesPermitidas
        .map(sede => String(sede).trim().toUpperCase())
        .includes(String(sedeAsignada).trim().toUpperCase())
    ) {
      req.session.error = "No tiene permiso para mover la prioridad a esa sede.";
      return res.redirect("/taller/dashboard");
    }

    const [result] = await pool.query(
      `UPDATE taller_prioridades
       SET placa = ?,
           sede = ?,
           fecha_prioridad = ?,
           observacion = ?
       WHERE id = ?
         AND estado = 'PENDIENTE'`,
      [placa, sedeAsignada, fechaPrioridad, observacion, id]
    );

    req.session[result.affectedRows ? "success" : "error"] = result.affectedRows
      ? "Prioridad actualizada correctamente."
      : "No se encontró la prioridad o ya fue cerrada.";

    if (result.affectedRows) {
      try {
        await pool.query(
          `UPDATE logistica_taller
           SET placa = ?,
               unidad_id = ?,
               sede = ?,
               detalle_malo = CASE
                 WHEN detalle_malo IS NULL OR TRIM(detalle_malo) = '' OR detalle_malo = ? THEN ?
                 ELSE detalle_malo
               END
           WHERE prioridad_id = ?`,
          [
            placa,
            unidadNueva?.id || null,
            sedeAsignada,
            prioridadActual.observacion_actual || "",
            observacion,
            id
          ]
        );
      } catch (syncError) {
        if (syncError.code !== "ER_NO_SUCH_TABLE") {
          console.warn("No se pudo sincronizar prioridad con logística taller:", syncError.message);
        }
      }
    }
    res.redirect("/taller/dashboard");
  } catch (error) {
    console.error("ERROR actualizando prioridad taller:", error);
    req.session.error = "Error interno al actualizar la prioridad.";
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

    const [[prioridadActual]] = await pool.query(
      `SELECT
         tp.id,
         COALESCE(NULLIF(tp.sede, ''), un.sede) AS sede,
         usr.usuario AS creado_por_nombre
       FROM taller_prioridades tp
       LEFT JOIN usuarios usr ON usr.id = tp.creado_por
       LEFT JOIN unidades un ON UPPER(TRIM(un.placa)) = UPPER(TRIM(tp.placa))
       WHERE tp.id = ?
         AND tp.estado = 'PENDIENTE'
       LIMIT 1`,
      [id]
    );

    if (!prioridadActual) {
      req.session.error = "No se encontró la prioridad pendiente.";
      return res.redirect("/taller/dashboard");
    }

    if (esUsuarioPesados(req.session.user) && !esPrioridadPesados(prioridadActual)) {
      req.session.error = "El usuario de Pesados solo puede atender prioridades de Granel o Transportadora.";
      return res.redirect("/taller/dashboard");
    }

    if (esUsuarioMecanico(req.session.user) && esPrioridadPesados(prioridadActual)) {
      req.session.error = "El usuario mecánico solo puede atender prioridades de taller/Cartago.";
      return res.redirect("/taller/dashboard");
    }

    if (
      sedesPermitidas.length > 0 &&
      prioridadActual.sede &&
      !sedesPermitidas
        .map(sede => String(sede).trim().toUpperCase())
        .includes(String(prioridadActual.sede).trim().toUpperCase())
    ) {
      req.session.error = "No tiene permiso para atender prioridades de esta sede.";
      return res.redirect("/taller/dashboard");
    }

    const [result] = await pool.query(
      `UPDATE taller_prioridades
       SET estado = 'ATENDIDA',
           atendido_por = ?,
           atendido_en = NOW()
       WHERE id = ?
         AND estado = 'PENDIENTE'`,
      [req.session.user.id, id]
    );

    req.session[result.affectedRows ? "success" : "error"] = result.affectedRows
      ? "Unidad marcada como salida de taller. El registro quedó en historial."
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
