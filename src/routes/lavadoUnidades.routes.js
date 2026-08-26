const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const pool = require("../db");
const { getSedesPermitidas } = require("../utils/sedes");
const { agregarFiltroPlacaSql } = require("../utils/placas");

const ROLES_LAVADO_VER = ["ADMIN", "TALLER", "MECANICO"];
const ROLES_LAVADO_CREAR = ["ADMIN", "TALLER", "MECANICO"];
const MAX_FOTO_BASE64_LENGTH = 3 * 1024 * 1024;

const FOTOS_LAVADO = [
  { clave: "adelante", nombre: "Adelante" },
  { clave: "medio_izquierdo", nombre: "Medio lado izquierdo" },
  { clave: "medio_derecho", nombre: "Medio lado derecho" },
  { clave: "atras", nombre: "Atrás" },
  { clave: "cabina", nombre: "Cabina" }
];

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function puedeVerLavado(user) {
  return ROLES_LAVADO_VER.includes(user?.rol);
}

function puedeCrearLavado(user) {
  return ROLES_LAVADO_CREAR.includes(user?.rol);
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureLavadoTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lavado_unidades (
      id INT AUTO_INCREMENT PRIMARY KEY,
      numero_lavado VARCHAR(30) NOT NULL UNIQUE,
      unidad_id INT NOT NULL,
      placa VARCHAR(80) NOT NULL,
      sede VARCHAR(100) NOT NULL,
      fecha DATE NOT NULL,
      observaciones TEXT NULL,
      creado_por INT NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_lavado_fecha (fecha),
      INDEX idx_lavado_sede_fecha (sede, fecha),
      INDEX idx_lavado_unidad_fecha (unidad_id, fecha),
      CONSTRAINT fk_lavado_unidad
        FOREIGN KEY (unidad_id) REFERENCES unidades(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lavado_unidades_fotos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lavado_id INT NOT NULL,
      angulo_clave VARCHAR(80) NOT NULL,
      angulo_nombre VARCHAR(120) NOT NULL,
      foto_nombre VARCHAR(255) NULL,
      foto_tipo VARCHAR(100) NULL,
      foto_base64 LONGTEXT NOT NULL,
      foto_hash CHAR(64) NOT NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_lavado_foto_hash (foto_hash),
      INDEX idx_lavado_fotos_lavado (lavado_id),
      CONSTRAINT fk_lavado_fotos_lavado
        FOREIGN KEY (lavado_id) REFERENCES lavado_unidades(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

function normalizarFotoBase64(value) {
  return String(value || "").trim();
}

function hashFoto(fotoBase64) {
  const normalizada = normalizarFotoBase64(fotoBase64);
  return crypto.createHash("sha256").update(normalizada).digest("hex");
}

async function siguienteNumeroLavado(connection, fecha) {
  const year = String(fecha || hoyISO()).slice(0, 4);
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS total FROM lavado_unidades WHERE numero_lavado LIKE ?",
    [`LAV-${year}-%`]
  );
  return `LAV-${year}-${String(Number(row.total || 0) + 1).padStart(4, "0")}`;
}

router.use(requireAuth);

router.use((req, res, next) => {
  if (!puedeVerLavado(req.session.user)) {
    return res.status(403).send("No autorizado");
  }
  next();
});

router.get("/", async (req, res) => {
  try {
    await ensureLavadoTables();

    const sedesPermitidas = getSedesPermitidas(req);
    const fechaDesde = req.query.fecha_desde || hoyISO();
    const fechaHasta = req.query.fecha_hasta || hoyISO();
    const placaFiltro = String(req.query.placa || "").trim();

    let sql = `
      SELECT
        lu.id,
        lu.numero_lavado,
        lu.placa,
        lu.sede,
        lu.fecha,
        DATE_FORMAT(lu.fecha, '%d/%m/%Y') AS fecha_formato,
        lu.observaciones,
        DATE_FORMAT(lu.creado_en, '%d/%m/%Y %H:%i') AS creado_formato,
        us.nombre AS creado_por_nombre,
        COALESCE(foto_resumen.fotos_total, 0) AS fotos_total,
        foto_resumen.foto_portada
      FROM lavado_unidades lu
      LEFT JOIN usuarios us ON us.id = lu.creado_por
      LEFT JOIN (
        SELECT lavado_id, COUNT(*) AS fotos_total, MIN(foto_base64) AS foto_portada
        FROM lavado_unidades_fotos
        GROUP BY lavado_id
      ) foto_resumen ON foto_resumen.lavado_id = lu.id
      WHERE lu.sede IN (?)
    `;
    const params = [sedesPermitidas];

    if (fechaDesde) {
      sql += " AND lu.fecha >= ?";
      params.push(fechaDesde);
    }

    if (fechaHasta) {
      sql += " AND lu.fecha <= ?";
      params.push(fechaHasta);
    }

    if (placaFiltro) {
      const condicionesPlaca = [];
      agregarFiltroPlacaSql(condicionesPlaca, params, "lu.placa", placaFiltro);
      if (condicionesPlaca.length) sql += ` AND ${condicionesPlaca[0]}`;
    }

    sql += " ORDER BY lu.fecha DESC, lu.creado_en DESC";

    const [lavados] = await pool.query(sql, params);
    const fotosPorLavado = {};

    if (lavados.length) {
      const [fotos] = await pool.query(
        `SELECT lavado_id, angulo_nombre, foto_base64
         FROM lavado_unidades_fotos
         WHERE lavado_id IN (?)
         ORDER BY id ASC`,
        [lavados.map(item => item.id)]
      );

      fotos.forEach(foto => {
        if (!fotosPorLavado[foto.lavado_id]) fotosPorLavado[foto.lavado_id] = [];
        fotosPorLavado[foto.lavado_id].push(foto);
      });
    }

    res.render("lavado_unidades/index", {
      lavados,
      fotosPorLavado,
      filtros: { fecha_desde: fechaDesde, fecha_hasta: fechaHasta, placa: placaFiltro },
      puedeCrear: puedeCrearLavado(req.session.user),
      success: req.query.success || "",
      error: req.query.error || "",
      user: req.session.user
    });
  } catch (error) {
    console.error("ERROR listado lavado unidades:", error);
    res.status(500).send("Error interno");
  }
});

router.get("/nuevo", async (req, res) => {
  try {
    await ensureLavadoTables();

    if (!puedeCrearLavado(req.session.user)) {
      return res.redirect("/lavado-unidades");
    }

    const sedesPermitidas = getSedesPermitidas(req);
    const [unidades] = await pool.query(
      `SELECT id, placa, sede
       FROM unidades
       WHERE sede IN (?) AND COALESCE(activa, 1) = 1
       ORDER BY sede, placa`,
      [sedesPermitidas]
    );

    res.render("lavado_unidades/nuevo", {
      unidades,
      fotos: FOTOS_LAVADO,
      hoy: hoyISO(),
      error: req.query.error || "",
      user: req.session.user
    });
  } catch (error) {
    console.error("ERROR form lavado unidades:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/", async (req, res) => {
  let connection;

  try {
    await ensureLavadoTables();

    if (!puedeCrearLavado(req.session.user)) {
      return res.status(403).send("No autorizado para crear lavados.");
    }

    const unidadId = parseInt(req.body.unidad_id, 10);
    const fecha = String(req.body.fecha || "").trim();
    const observaciones = String(req.body.observaciones || "").trim() || null;

    if (!unidadId) return res.status(400).send("Debe seleccionar una unidad.");
    if (!fecha) return res.status(400).send("Debe colocar la fecha del lavado.");

    const sedesPermitidas = getSedesPermitidas(req);
    const [[unidad]] = await pool.query(
      "SELECT id, placa, sede FROM unidades WHERE id = ? LIMIT 1",
      [unidadId]
    );

    if (!unidad || !sedesPermitidas.includes(unidad.sede)) {
      return res.status(403).send("No autorizado para esa unidad.");
    }

    const fotosBase64 = req.body.fotos_base64 || {};
    const fotosNombre = req.body.fotos_nombre || {};
    const fotosTipo = req.body.fotos_tipo || {};
    const fotos = FOTOS_LAVADO.map(item => {
      const fotoBase64 = normalizarFotoBase64(fotosBase64[item.clave]);
      return {
        ...item,
        foto_base64: fotoBase64,
        foto_nombre: String(fotosNombre[item.clave] || "").trim() || `lavado_${item.clave}.jpg`,
        foto_tipo: String(fotosTipo[item.clave] || "").trim() || "image/jpeg",
        foto_hash: fotoBase64 ? hashFoto(fotoBase64) : ""
      };
    });

    const faltantes = fotos.filter(foto => !foto.foto_base64);
    if (faltantes.length) {
      return res.status(400).send(`Debe subir foto de: ${faltantes.map(foto => foto.nombre).join(", ")}.`);
    }

    const fotoInvalida = fotos.some(foto =>
      !String(foto.foto_tipo || "").startsWith("image/") ||
      foto.foto_base64.length > MAX_FOTO_BASE64_LENGTH
    );

    if (fotoInvalida) {
      return res.status(400).send("Una foto no es válida o es demasiado grande.");
    }

    const hashes = fotos.map(foto => foto.foto_hash);
    if (new Set(hashes).size !== hashes.length) {
      return res.status(400).send("Hay fotos repetidas dentro de esta misma orden de lavado.");
    }

    const [duplicadas] = await pool.query(
      `SELECT
         lf.angulo_nombre,
         lu.numero_lavado,
         lu.placa,
         DATE_FORMAT(lu.fecha, '%d/%m/%Y') AS fecha_formato
       FROM lavado_unidades_fotos lf
       JOIN lavado_unidades lu ON lu.id = lf.lavado_id
       WHERE lf.foto_hash IN (?)`,
      [hashes]
    );

    if (duplicadas.length) {
      const duplicada = duplicadas[0];
      return res.status(400).send(
        `Esa foto ya fue usada en ${duplicada.numero_lavado} (${duplicada.placa}, ${duplicada.fecha_formato}). Tome una foto nueva.`
      );
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const numeroLavado = await siguienteNumeroLavado(connection, fecha);
    const [result] = await connection.query(
      `INSERT INTO lavado_unidades
       (numero_lavado, unidad_id, placa, sede, fecha, observaciones, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [numeroLavado, unidad.id, unidad.placa, unidad.sede, fecha, observaciones, req.session.user.id || null]
    );

    const lavadoId = result.insertId;

    for (const foto of fotos) {
      await connection.query(
        `INSERT INTO lavado_unidades_fotos
         (lavado_id, angulo_clave, angulo_nombre, foto_nombre, foto_tipo, foto_base64, foto_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          lavadoId,
          foto.clave,
          foto.nombre,
          foto.foto_nombre,
          foto.foto_tipo,
          foto.foto_base64,
          foto.foto_hash
        ]
      );
    }

    await connection.commit();
    res.redirect(`/lavado-unidades?success=${encodeURIComponent(`Orden ${numeroLavado} guardada correctamente.`)}`);
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).send("Una de las fotos ya existe en una orden de lavado anterior. Tome fotos nuevas.");
    }
    console.error("ERROR guardar lavado unidades:", error);
    res.status(500).send("Error interno");
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
