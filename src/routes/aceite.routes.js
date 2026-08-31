const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  etiquetaSedeOperativa,
  expandirSedeOperativaRepuestosAceites,
  expandirSedesOperativasRepuestosAceites,
  getSedesPermitidas,
  obtenerTodasSedes,
  sedeOperativaRepuestosAceites,
  sedesOperativasVisibles
} = require("../utils/sedes");

const ROLES_GESTION_ACEITE = ["ADMIN", "TALLER", "MECANICO"];
const CAPACIDAD_ESTANON_GALONES = 55;
const GALON_A_LITROS = 3.78541;
const CAPACIDAD_ESTANON_LITROS = CAPACIDAD_ESTANON_GALONES * GALON_A_LITROS;

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function puedeGestionarAceite(user) {
  return ROLES_GESTION_ACEITE.includes(user?.rol);
}

function parseMonto(value) {
  if (value === null || typeof value === "undefined") return 0;
  const texto = String(value)
    .replace(/\s/g, "")
    .trim();
  const normalizado = texto.includes(",")
    ? texto.replace(/\./g, "").replace(",", ".")
    : texto;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}

function fechaCostaRica() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function fechaValida(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? value : fechaCostaRica();
}

function galonesALitros(galones) {
  return Number(galones || 0) * GALON_A_LITROS;
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

async function ensureAceiteTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cambios_aceite (
      id INT AUTO_INCREMENT PRIMARY KEY,
      unidad_id INT NOT NULL UNIQUE,
      sede VARCHAR(100) NOT NULL,
      km_actual INT NOT NULL,
      galones DECIMAL(10,2) NOT NULL DEFAULT 0,
      litros_usados DECIMAL(10,2) NULL,
      proximo_km INT NOT NULL,
      observaciones TEXT NULL,
      creado_por INT NULL,
      fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_cambios_aceite_sede (sede),
      INDEX idx_cambios_aceite_fecha (fecha)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cambios_aceite_historial (
      id INT AUTO_INCREMENT PRIMARY KEY,
      unidad_id INT NOT NULL,
      sede VARCHAR(100) NOT NULL,
      km_actual INT NOT NULL,
      galones DECIMAL(10,2) NOT NULL DEFAULT 0,
      litros_usados DECIMAL(10,2) NULL,
      proximo_km INT NOT NULL,
      observaciones TEXT NULL,
      creado_por INT NULL,
      fecha TIMESTAMP NULL,
      archivado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_hist_aceite_unidad (unidad_id),
      INDEX idx_hist_aceite_sede (sede)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aceite_estanones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sede VARCHAR(100) NOT NULL,
      descripcion VARCHAR(180) NULL,
      fecha_compra DATE NOT NULL,
      litros_capacidad DECIMAL(10,2) NOT NULL DEFAULT 208.20,
      litros_restantes DECIMAL(10,2) NOT NULL DEFAULT 208.20,
      estado ENUM('ACTIVO','AGOTADO','CERRADO') NOT NULL DEFAULT 'ACTIVO',
      creado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_aceite_estanones_sede_estado (sede, estado),
      INDEX idx_aceite_estanones_fecha (fecha_compra)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aceite_movimientos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      estanon_id INT NOT NULL,
      cambio_aceite_id INT NULL,
      sede VARCHAR(100) NOT NULL,
      tipo ENUM('ENTRADA','SALIDA','AJUSTE') NOT NULL,
      litros DECIMAL(10,2) NOT NULL,
      descripcion VARCHAR(255) NULL,
      unidad_id INT NULL,
      placa VARCHAR(50) NULL,
      creado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_aceite_mov_estanon (estanon_id),
      INDEX idx_aceite_mov_sede (sede),
      INDEX idx_aceite_mov_fecha (creado_en)
    )
  `);

  if (!(await columnExists("cambios_aceite", "litros_usados"))) {
    await pool.query("ALTER TABLE cambios_aceite ADD COLUMN litros_usados DECIMAL(10,2) NULL AFTER galones");
  }

  if (!(await columnExists("cambios_aceite_historial", "litros_usados"))) {
    await pool.query("ALTER TABLE cambios_aceite_historial ADD COLUMN litros_usados DECIMAL(10,2) NULL AFTER galones");
  }

  if (!(await columnExists("cambios_aceite_historial", "fecha"))) {
    await pool.query("ALTER TABLE cambios_aceite_historial ADD COLUMN fecha TIMESTAMP NULL AFTER creado_por");
  }
}

function puedeUsarSede(sede, sedesPermitidas) {
  return sedesPermitidas.length === 0 || sedesPermitidas.includes(sedeOperativaRepuestosAceites(sede));
}

async function consumirAceitePorSede(connection, { sede, litros, cambioAceiteId, unidadId, placa, userId }) {
  const sedeOperativa = sedeOperativaRepuestosAceites(sede);
  const sedesBusqueda = expandirSedeOperativaRepuestosAceites(sedeOperativa);
  const [estanones] = await connection.query(
    `SELECT id, litros_restantes
     FROM aceite_estanones
     WHERE sede IN (?)
       AND estado = 'ACTIVO'
       AND litros_restantes > 0
     ORDER BY fecha_compra ASC, id ASC
     FOR UPDATE`,
    [sedesBusqueda]
  );

  const disponible = estanones.reduce((total, item) => total + Number(item.litros_restantes || 0), 0);
  if (disponible + 0.001 < litros) {
    throw new Error(`No hay suficiente aceite registrado en ${etiquetaSedeOperativa(sedeOperativa)}. Disponible: ${(disponible / GALON_A_LITROS).toFixed(2)} galones.`);
  }

  let pendiente = litros;
  for (const estanon of estanones) {
    if (pendiente <= 0) break;
    const restanteActual = Number(estanon.litros_restantes || 0);
    const consumo = Math.min(restanteActual, pendiente);
    const nuevoRestante = Math.max(0, restanteActual - consumo);

    await connection.query(
      `UPDATE aceite_estanones
       SET litros_restantes = ?,
           estado = CASE WHEN ? <= 0.001 THEN 'AGOTADO' ELSE estado END
       WHERE id = ?`,
      [nuevoRestante, nuevoRestante, estanon.id]
    );

    await connection.query(
      `INSERT INTO aceite_movimientos
       (estanon_id, cambio_aceite_id, sede, tipo, litros, descripcion, unidad_id, placa, creado_por)
       VALUES (?, ?, ?, 'SALIDA', ?, ?, ?, ?, ?)`,
      [
        estanon.id,
        cambioAceiteId,
        sedeOperativa,
        consumo,
        `Cambio de aceite ${placa}`,
        unidadId,
        placa,
        userId
      ]
    );

    pendiente -= consumo;
  }
}

router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    await ensureAceiteTables();
    const sedesPermitidas = expandirSedesOperativasRepuestosAceites(getSedesPermitidas(req));
    const sedesGestion = sedesOperativasVisibles((await obtenerTodasSedes(pool)).filter(sede => puedeUsarSede(sede, sedesPermitidas)));

    const [cambios] = await pool.query(
      `SELECT
        ca.id,
        DATE_FORMAT(ca.fecha, '%d/%m/%Y %H:%i') AS fecha_formato,
        u.placa,
        ca.sede,
        ca.km_actual,
        ca.galones,
        ca.galones AS galones_usados,
        COALESCE(ca.litros_usados, ca.galones * ${GALON_A_LITROS}) AS litros_usados,
        ca.proximo_km,
        ca.observaciones,
        us.nombre AS mecanico
      FROM cambios_aceite ca
      JOIN unidades u ON u.id = ca.unidad_id
      LEFT JOIN usuarios us ON us.id = ca.creado_por
      WHERE ca.sede IN (?)
      ORDER BY ca.fecha DESC
      LIMIT 120`,
      [sedesPermitidas]
    );

    const [estanones] = await pool.query(
      `SELECT
         ae.*,
         DATE_FORMAT(ae.fecha_compra, '%d/%m/%Y') AS fecha_compra_formato,
         COALESCE(SUM(CASE WHEN am.tipo = 'SALIDA' THEN am.litros ELSE 0 END), 0) AS litros_consumidos,
         COUNT(CASE WHEN am.tipo = 'SALIDA' THEN 1 END) AS salidas
       FROM aceite_estanones ae
       LEFT JOIN aceite_movimientos am ON am.estanon_id = ae.id
       WHERE ae.sede IN (?)
       GROUP BY ae.id
       ORDER BY ae.estado = 'ACTIVO' DESC, ae.sede ASC, ae.fecha_compra DESC, ae.id DESC`,
      [sedesPermitidas]
    );

    const [movimientos] = await pool.query(
      `SELECT
         am.*,
         DATE_FORMAT(am.creado_en, '%d/%m/%Y %H:%i') AS fecha_formato,
         u.nombre AS usuario_nombre
       FROM aceite_movimientos am
       LEFT JOIN usuarios u ON u.id = am.creado_por
       WHERE am.sede IN (?)
       ORDER BY am.creado_en DESC, am.id DESC
       LIMIT 80`,
      [sedesPermitidas]
    );

    const resumen = estanones.reduce((acc, item) => {
      const capacidad = Number(item.litros_capacidad || CAPACIDAD_ESTANON_LITROS);
      const restantes = Number(item.litros_restantes || 0);
      acc.capacidad += capacidad;
      acc.restantes += restantes;
      acc.consumidos += Number(item.litros_consumidos || 0);
      if (item.estado === "ACTIVO") acc.activos += 1;
      if (restantes <= capacidad * 0.2 && item.estado === "ACTIVO") acc.bajos += 1;
      return acc;
    }, { capacidad: 0, restantes: 0, consumidos: 0, activos: 0, bajos: 0 });

    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("aceite_listado", {
      cambios,
      estanones,
      movimientos,
      resumen,
      sedesGestion,
      capacidadEstandar: CAPACIDAD_ESTANON_LITROS,
      capacidadEstandarGalones: CAPACIDAD_ESTANON_GALONES,
      galonALitros: GALON_A_LITROS,
      fechaHoy: fechaCostaRica(),
      puedeGestionar: puedeGestionarAceite(req.session.user),
      etiquetaSede: etiquetaSedeOperativa,
      success,
      error,
      user: req.session.user
    });
  } catch (error) {
    console.error("ERROR listado cambios de aceite:", error);
    res.status(500).send("Error interno");
  }
});

router.get("/nuevo", async (req, res) => {
  try {
    if (!puedeGestionarAceite(req.session.user)) {
      return res.redirect("/aceite");
    }

    await ensureAceiteTables();
    const sedesPermitidas = expandirSedesOperativasRepuestosAceites(getSedesPermitidas(req));

    const [unidades] = await pool.query(
      "SELECT id, placa, sede FROM unidades WHERE sede IN (?) ORDER BY sede, placa",
      [sedesPermitidas]
    );

    res.render("aceite_nuevo", { unidades, user: req.session.user });
  } catch (error) {
    console.error("ERROR form aceite:", error);
    res.status(500).send("Error interno");
  }
});

router.post("/estanones", async (req, res) => {
  try {
    if (!puedeGestionarAceite(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    await ensureAceiteTables();
    const sedesPermitidas = expandirSedesOperativasRepuestosAceites(getSedesPermitidas(req));
    const sede = sedeOperativaRepuestosAceites(req.body.sede);
    const fechaCompra = fechaValida(req.body.fecha_compra);
    const descripcion = String(req.body.descripcion || "").trim() || "Estañón de aceite 55 galones";
    const galonesCapacidad = parseMonto(req.body.galones_capacidad || req.body.litros_capacidad) || CAPACIDAD_ESTANON_GALONES;
    const galonesIniciales = parseMonto(req.body.galones_iniciales || req.body.litros_iniciales) || galonesCapacidad;
    const litrosCapacidad = galonesALitros(galonesCapacidad);
    const litrosIniciales = galonesALitros(galonesIniciales);

    if (!sede || !puedeUsarSede(sede, sedesPermitidas)) {
      req.session.error = "Seleccione una sede permitida para el estañón.";
      return res.redirect("/aceite");
    }

    if (galonesIniciales <= 0 || galonesIniciales > galonesCapacidad) {
      req.session.error = "Los galones iniciales deben ser mayores a cero y no superar la capacidad.";
      return res.redirect("/aceite");
    }

    const [result] = await pool.query(
      `INSERT INTO aceite_estanones
       (sede, descripcion, fecha_compra, litros_capacidad, litros_restantes, creado_por)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sede, descripcion, fechaCompra, litrosCapacidad, litrosIniciales, req.session.user.id || null]
    );

    await pool.query(
      `INSERT INTO aceite_movimientos
       (estanon_id, sede, tipo, litros, descripcion, creado_por)
       VALUES (?, ?, 'ENTRADA', ?, ?, ?)`,
      [result.insertId, sede, litrosIniciales, descripcion, req.session.user.id || null]
    );

    req.session.success = `Estañón agregado para ${etiquetaSedeOperativa(sede)} con ${galonesIniciales.toFixed(2)} galones.`;
    res.redirect("/aceite");
  } catch (error) {
    console.error("ERROR agregando estañón:", error);
    req.session.error = "No se pudo agregar el estañón.";
    res.redirect("/aceite");
  }
});

router.post("/", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    if (!puedeGestionarAceite(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    await ensureAceiteTables();
    const { unidad_id, km_actual, proximo_km, observaciones } = req.body;
    const galonesUsados = parseMonto(req.body.galones_usados || req.body.galones || req.body.litros_usados);
    const litrosUsados = galonesALitros(galonesUsados);
    const sedesPermitidas = expandirSedesOperativasRepuestosAceites(getSedesPermitidas(req));

    if (!unidad_id || !km_actual || !proximo_km || galonesUsados <= 0) {
      req.session.error = "Complete la unidad, kilometraje, próximo cambio y galones usados.";
      return res.redirect("/aceite/nuevo");
    }

    const [[unidad]] = await pool.query(
      "SELECT id, placa, sede FROM unidades WHERE id = ?",
      [unidad_id]
    );

    if (!unidad || !puedeUsarSede(unidad.sede, sedesPermitidas)) {
      return res.status(403).send("No autorizado para esa unidad");
    }

    await connection.beginTransaction();

    await connection.query(
      `INSERT INTO cambios_aceite_historial
       (unidad_id, sede, km_actual, galones, litros_usados, proximo_km, observaciones, creado_por, fecha)
       SELECT unidad_id, sede, km_actual, galones, litros_usados, proximo_km, observaciones, creado_por, fecha
       FROM cambios_aceite
       WHERE unidad_id = ?`,
      [unidad_id]
    );

    const [result] = await connection.query(
      `INSERT INTO cambios_aceite
        (unidad_id, sede, km_actual, galones, litros_usados, proximo_km, observaciones, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        id = LAST_INSERT_ID(id),
        sede = VALUES(sede),
        km_actual = VALUES(km_actual),
        galones = VALUES(galones),
        litros_usados = VALUES(litros_usados),
        proximo_km = VALUES(proximo_km),
        observaciones = VALUES(observaciones),
        creado_por = VALUES(creado_por),
        fecha = CURRENT_TIMESTAMP`,
      [
        unidad_id,
        sedeOperativaRepuestosAceites(unidad.sede),
        km_actual,
        galonesUsados,
        litrosUsados,
        proximo_km,
        observaciones || null,
        req.session.user.id
      ]
    );

    await consumirAceitePorSede(connection, {
      sede: sedeOperativaRepuestosAceites(unidad.sede),
      litros: litrosUsados,
      cambioAceiteId: result.insertId,
      unidadId: unidad.id,
      placa: unidad.placa,
      userId: req.session.user.id || null
    });

    await connection.commit();
    req.session.success = `Cambio de aceite guardado y se rebajaron ${galonesUsados.toFixed(2)} galones de ${etiquetaSedeOperativa(unidad.sede)}.`;
    res.redirect("/aceite");
  } catch (error) {
    await connection.rollback();
    console.error("ERROR guardar cambio de aceite:", error);
    req.session.error = error.message || "Error interno al guardar el cambio de aceite.";
    res.redirect("/aceite");
  } finally {
    connection.release();
  }
});

module.exports = router;
