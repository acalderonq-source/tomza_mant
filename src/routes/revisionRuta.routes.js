const express = require("express");
const router = express.Router();
const pool = require("../db");
const { getSedesPermitidas } = require("../utils/sedes");
const { agregarFiltroPlacaSql } = require("../utils/placas");

const ROLES_REVISION_RUTA = ["ADMIN", "TALLER", "MECANICO", "SUPERVISOR", "SUPERVISOR_PESADO"];
const ROLES_CREAR_REVISION_RUTA = ["ADMIN", "MECANICO"];

const ITEMS_REVISION = [
  { clave: "luces", nombre: "Luces y direccionales" },
  { clave: "frenos", nombre: "Frenos" },
  { clave: "llantas", nombre: "Llantas" },
  { clave: "niveles", nombre: "Aceite, agua y fluidos" },
  { clave: "fugas", nombre: "Fugas visibles" },
  { clave: "bateria", nombre: "Batería" },
  { clave: "documentos", nombre: "Documentos y permisos" },
  { clave: "extintor", nombre: "Extintor" },
  { clave: "equipo_seguridad", nombre: "Conos, triángulos y equipo" },
  { clave: "espejos_vidrios", nombre: "Espejos y vidrios" },
  { clave: "limpiaparabrisas", nombre: "Limpiaparabrisas" },
  { clave: "mangueras_conexiones", nombre: "Mangueras y conexiones" }
];

const ESTADOS_VALIDOS = ["BIEN", "REGULAR", "MAL", "NO_APLICA"];
const MAX_FOTO_BASE64_LENGTH = 3 * 1024 * 1024;

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function puedeVerRevisionRuta(user) {
  return ROLES_REVISION_RUTA.includes(user.rol);
}

function puedeCrearRevisionRuta(user) {
  return ROLES_CREAR_REVISION_RUTA.includes(user.rol);
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function estadoValido(estado) {
  const valor = String(estado || "").trim().toUpperCase();
  return ESTADOS_VALIDOS.includes(valor) ? valor : "BIEN";
}

function etiquetaEstado(estado) {
  const etiquetas = {
    BIEN: "Bien",
    REGULAR: "Regular",
    MAL: "Mal",
    NO_APLICA: "No aplica"
  };
  return etiquetas[estado] || estado || "-";
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

async function ensureRevisionRutaTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS revisiones_ruta (
      id INT AUTO_INCREMENT PRIMARY KEY,
      unidad_id INT NOT NULL,
      sede VARCHAR(100) NOT NULL,
      fecha DATE NOT NULL,
      turno VARCHAR(50) NULL,
      kilometraje INT NULL,
      apto_ruta TINYINT(1) NOT NULL DEFAULT 1,
      observaciones_generales TEXT NULL,
      foto_nombre VARCHAR(255) NULL,
      foto_tipo VARCHAR(100) NULL,
      foto_base64 LONGTEXT NULL,
      creado_por INT NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_revision_ruta_fecha (fecha),
      INDEX idx_revision_ruta_sede_fecha (sede, fecha),
      INDEX idx_revision_ruta_unidad_fecha (unidad_id, fecha)
    )
  `);

  const columnasFoto = [
    ["foto_nombre", "VARCHAR(255) NULL"],
    ["foto_tipo", "VARCHAR(100) NULL"],
    ["foto_base64", "LONGTEXT NULL"]
  ];

  for (const [column, definition] of columnasFoto) {
    if (!(await columnExists("revisiones_ruta", column))) {
      await pool.query(`ALTER TABLE revisiones_ruta ADD COLUMN ${column} ${definition}`);
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS revisiones_ruta_detalle (
      id INT AUTO_INCREMENT PRIMARY KEY,
      revision_id INT NOT NULL,
      item_clave VARCHAR(80) NOT NULL,
      item_nombre VARCHAR(150) NOT NULL,
      estado ENUM('BIEN','REGULAR','MAL','NO_APLICA') NOT NULL DEFAULT 'BIEN',
      observacion TEXT NULL,
      foto_nombre VARCHAR(255) NULL,
      foto_tipo VARCHAR(100) NULL,
      foto_base64 LONGTEXT NULL,
      INDEX idx_revision_ruta_detalle_revision (revision_id),
      INDEX idx_revision_ruta_detalle_estado (estado)
    )
  `);

  const columnasFotoDetalle = [
    ["foto_nombre", "VARCHAR(255) NULL"],
    ["foto_tipo", "VARCHAR(100) NULL"],
    ["foto_base64", "LONGTEXT NULL"]
  ];

  for (const [column, definition] of columnasFotoDetalle) {
    if (!(await columnExists("revisiones_ruta_detalle", column))) {
      await pool.query(`ALTER TABLE revisiones_ruta_detalle ADD COLUMN ${column} ${definition}`);
    }
  }
}

router.use(requireAuth);

router.use((req, res, next) => {
  if (!puedeVerRevisionRuta(req.session.user)) {
    return res.status(403).send("No autorizado");
  }
  next();
});

// ===================== LISTADO =====================
router.get("/", async (req, res) => {
  try {
    await ensureRevisionRutaTables();

    const sedesPermitidas = getSedesPermitidas(req);
    const fechaFiltro = req.query.fecha || hoyISO();
    const placaFiltro = String(req.query.placa || "").trim();
    const estadoFiltro = String(req.query.estado || "").trim();

    let sql = `
      SELECT
        rr.id,
        rr.sede,
        rr.fecha,
        DATE_FORMAT(rr.fecha, '%d/%m/%Y') AS fecha_formato,
        rr.turno,
        rr.kilometraje,
        rr.apto_ruta,
        rr.observaciones_generales,
        rr.foto_nombre,
        rr.foto_tipo,
        rr.foto_base64,
        DATE_FORMAT(rr.creado_en, '%d/%m/%Y %H:%i') AS creado_formato,
        u.placa,
        us.nombre AS creado_por_nombre,
        COALESCE(resumen_detalle.malos, 0) AS malos,
        COALESCE(resumen_detalle.regulares, 0) AS regulares
      FROM revisiones_ruta rr
      JOIN unidades u ON u.id = rr.unidad_id
      LEFT JOIN usuarios us ON us.id = rr.creado_por
      LEFT JOIN (
        SELECT
          revision_id,
          SUM(CASE WHEN estado = 'MAL' THEN 1 ELSE 0 END) AS malos,
          SUM(CASE WHEN estado = 'REGULAR' THEN 1 ELSE 0 END) AS regulares
        FROM revisiones_ruta_detalle
        GROUP BY revision_id
      ) resumen_detalle ON resumen_detalle.revision_id = rr.id
      WHERE rr.sede IN (?)
    `;
    const params = [sedesPermitidas];

    if (fechaFiltro) {
      sql += " AND rr.fecha = ?";
      params.push(fechaFiltro);
    }

    if (placaFiltro) {
      const condicionesPlaca = [];
      agregarFiltroPlacaSql(condicionesPlaca, params, "u.placa", placaFiltro);
      if (condicionesPlaca.length) {
        sql += ` AND ${condicionesPlaca[0]}`;
      }
    }

    if (estadoFiltro === "apto") {
      sql += " AND rr.apto_ruta = 1";
    } else if (estadoFiltro === "no_apto") {
      sql += " AND rr.apto_ruta = 0";
    }

    sql += " ORDER BY rr.fecha DESC, rr.creado_en DESC";

    const [revisiones] = await pool.query(sql, params);
    const detallesPorRevision = {};

    if (revisiones.length) {
      const ids = revisiones.map(r => r.id);
      const [detalles] = await pool.query(
        `
        SELECT revision_id, item_nombre, estado, observacion, foto_base64
        FROM revisiones_ruta_detalle
        WHERE revision_id IN (?)
        ORDER BY id ASC
        `,
        [ids]
      );

      detalles.forEach(detalle => {
        if (!detallesPorRevision[detalle.revision_id]) detallesPorRevision[detalle.revision_id] = [];
        detallesPorRevision[detalle.revision_id].push(detalle);
      });
    }

    revisiones.forEach(revision => {
      const detalles = detallesPorRevision[revision.id] || [];
      const observaciones = [];

      if (revision.observaciones_generales) {
        observaciones.push(`General: ${revision.observaciones_generales}`);
      }

      detalles.forEach(detalle => {
        const observacion = String(detalle.observacion || "").trim();
        if (observacion) {
          observaciones.push(`${detalle.item_nombre}: ${observacion}`);
        }
      });

      revision.observaciones_resumen = observaciones.length ? observaciones.join(" · ") : "—";
      revision.tiene_observaciones = observaciones.length > 0;
    });

    res.render("revision_ruta_listado", {
      revisiones,
      detallesPorRevision,
      filtros: { fecha: fechaFiltro, placa: placaFiltro, estado: estadoFiltro },
      resumen: {
        total: revisiones.length,
        aptas: revisiones.filter(r => Number(r.apto_ruta) === 1).length,
        noAptas: revisiones.filter(r => Number(r.apto_ruta) === 0).length
      },
      puedeCrear: puedeCrearRevisionRuta(req.session.user),
      etiquetaEstado,
      user: req.session.user
    });
  } catch (error) {
    console.error("ERROR listado revision ruta:", error);
    res.status(500).send("Error interno");
  }
});

// ===================== FORM NUEVO =====================
router.get("/nuevo", async (req, res) => {
  try {
    await ensureRevisionRutaTables();

    if (!puedeCrearRevisionRuta(req.session.user)) {
      return res.redirect("/revision-ruta");
    }

    const sedesPermitidas = getSedesPermitidas(req);
    const [unidades] = await pool.query(
      "SELECT id, placa, sede FROM unidades WHERE sede IN (?) AND COALESCE(activa, 1) = 1 ORDER BY sede, placa",
      [sedesPermitidas]
    );

    res.render("revision_ruta_nuevo", {
      unidades,
      items: ITEMS_REVISION,
      hoy: hoyISO(),
      user: req.session.user
    });
  } catch (error) {
    console.error("ERROR form revision ruta:", error);
    res.status(500).send("Error interno");
  }
});

// ===================== GUARDAR =====================
router.post("/", async (req, res) => {
  let connection;

  try {
    await ensureRevisionRutaTables();

    if (!puedeCrearRevisionRuta(req.session.user)) {
      return res.status(403).send("No autorizado para crear revisiones.");
    }

    const {
      unidad_id,
      fecha,
      turno,
      kilometraje,
      observaciones_generales,
    } = req.body;
    if (!unidad_id) return res.status(400).send("Debe seleccionar una unidad.");
    if (!fecha) return res.status(400).send("Debe colocar la fecha de revisión.");

    const sedesPermitidas = getSedesPermitidas(req);
    const [[unidad]] = await pool.query(
      "SELECT id, sede FROM unidades WHERE id = ? LIMIT 1",
      [unidad_id]
    );

    if (!unidad || !sedesPermitidas.includes(unidad.sede)) {
      return res.status(403).send("No autorizado para esa unidad.");
    }

    const estados = req.body.estados || {};
    const observaciones = req.body.observaciones || {};
    const fotosBase64 = req.body.fotos_base64 || {};
    const fotosNombre = req.body.fotos_nombre || {};
    const fotosTipo = req.body.fotos_tipo || {};
    const detalles = ITEMS_REVISION.map(item => ({
      ...item,
      estado: estadoValido(estados[item.clave]),
      observacion: String(observaciones[item.clave] || "").trim() || null,
      foto_base64: String(fotosBase64[item.clave] || "").trim() || null,
      foto_nombre: String(fotosNombre[item.clave] || "").trim() || null,
      foto_tipo: String(fotosTipo[item.clave] || "").trim() || null
    }));
    const tieneMal = detalles.some(detalle => detalle.estado === "MAL");
    const aptoRuta = tieneMal ? 0 : Number(req.body.apto_ruta || 1);

    const fotoInvalida = detalles.some(detalle =>
      detalle.foto_base64 &&
      (!String(detalle.foto_tipo || "").startsWith("image/") || detalle.foto_base64.length > MAX_FOTO_BASE64_LENGTH)
    );

    if (fotoInvalida) {
      return res.status(400).send("Una foto no es válida o es demasiado grande.");
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [result] = await connection.query(
      `
      INSERT INTO revisiones_ruta
        (unidad_id, sede, fecha, turno, kilometraje, apto_ruta, observaciones_generales, creado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        unidad_id,
        unidad.sede,
        fecha,
        turno || "Mañana",
        kilometraje || null,
        aptoRuta,
        observaciones_generales || null,
        req.session.user.id
      ]
    );

    const revisionId = result.insertId;
    for (const detalle of detalles) {
      await connection.query(
        `
        INSERT INTO revisiones_ruta_detalle
          (revision_id, item_clave, item_nombre, estado, observacion, foto_nombre, foto_tipo, foto_base64)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          revisionId,
          detalle.clave,
          detalle.nombre,
          detalle.estado,
          detalle.observacion,
          detalle.foto_base64 ? detalle.foto_nombre || `foto_${detalle.clave}.jpg` : null,
          detalle.foto_base64 ? detalle.foto_tipo || "image/jpeg" : null,
          detalle.foto_base64
        ]
      );
    }

    await connection.commit();
    res.redirect("/revision-ruta");
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("ERROR guardar revision ruta:", error);
    res.status(500).send("Error interno");
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
