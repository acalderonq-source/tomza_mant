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

function esUsuarioMecanicoLimitado(user) {
  const usuario = String(user?.usuario || "").trim().toLowerCase();
  return user?.rol === "MECANICO" ||
    usuario.startsWith("mecanico") ||
    usuario.startsWith("mecanicos");
}

function puedeGestionarAceite(user) {
  return ROLES_GESTION_ACEITE.includes(user?.rol) || esUsuarioMecanicoLimitado(user);
}

function unirSedesAceite(...listas) {
  return [...new Set(
    listas
      .flat()
      .map(sede => String(sede || "").trim())
      .filter(Boolean)
  )];
}

function sedesAceitePorUsuario(user) {
  const usuario = String(user?.usuario || "").trim().toLowerCase();
  const sedesPorUsuario = {
    mecanico_guapiles: ["Guapiles", "San Carlos"],
    mecanicos_guapiles: ["Guapiles", "San Carlos"],
    mecanico_la_cruz: ["La Cruz"],
    mecanicos_la_cruz: ["La Cruz"],
    mecanico_perez_zeledon: ["Perez Zeledon"],
    mecanicos_perez_zeledon: ["Perez Zeledon"],
    mecanico_rio_claro: ["Rio Claro"],
    mecanicos_rio_claro: ["Rio Claro"],
    mecanico_nicoya: ["Nicoya"],
    mecanicos_nicoya: ["Nicoya"],
    mecanico_limon: ["Transportadora", "Cabezales", "Cisternas", "Carretas", "Tandem", "Tándem"],
    mecanicos_limon: ["Transportadora", "Cabezales", "Cisternas", "Carretas", "Tandem", "Tándem"]
  };

  return sedesPorUsuario[usuario] || [];
}

async function getSedesPermitidasAceite(req) {
  const user = req.session.user || {};
  const sedesUsuario = sedesAceitePorUsuario(user);
  if (sedesUsuario.length) {
    return expandirSedesOperativasRepuestosAceites(sedesUsuario);
  }

  const sedesBase = getSedesPermitidas(req);
  if (!user.id) {
    return expandirSedesOperativasRepuestosAceites(sedesBase);
  }

  const [sedesDb] = await pool.query(
    `SELECT sede FROM usuarios WHERE id = ?
     UNION
     SELECT sede FROM usuarios_sedes WHERE usuario_id = ?`,
    [user.id, user.id]
  );

  return expandirSedesOperativasRepuestosAceites(
    unirSedesAceite(sedesBase, sedesDb.map(row => row.sede))
  );
}

function expandirSedesInventarioAceite(sedes) {
  const lista = Array.isArray(sedes) ? sedes : [sedes];
  return unirSedesAceite(lista.flatMap(expandirSedeInventarioAceite));
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

function claveSedeAceite(sede) {
  return String(sede || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function sedeInventarioAceite(sede) {
  const operativa = sedeOperativaRepuestosAceites(sede);
  return claveSedeAceite(operativa) === "SANCARLOS" ? "Guapiles" : operativa;
}

function expandirSedeInventarioAceite(sede) {
  const inventario = sedeInventarioAceite(sede);
  const sedes = expandirSedeOperativaRepuestosAceites(inventario);
  if (claveSedeAceite(inventario) === "GUAPILES") {
    return unirSedesAceite(sedes, ["San Carlos"]);
  }
  return sedes;
}

function etiquetaSedeInventarioAceite(sede) {
  return claveSedeAceite(sedeInventarioAceite(sede)) === "GUAPILES"
    ? "Guapiles / San Carlos"
    : etiquetaSedeOperativa(sede);
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

async function indexExists(tableName, indexName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [tableName, indexName]
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
      monto_total DECIMAL(14,2) NOT NULL DEFAULT 0,
      orden_compra_id INT NULL,
      orden_compra_numero VARCHAR(50) NULL,
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

  if (!(await columnExists("cambios_aceite_historial", "archivado_en"))) {
    await pool.query("ALTER TABLE cambios_aceite_historial ADD COLUMN archivado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER fecha");
  }

  if (!(await columnExists("aceite_estanones", "monto_total"))) {
    await pool.query("ALTER TABLE aceite_estanones ADD COLUMN monto_total DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER litros_restantes");
  }

  if (!(await columnExists("aceite_estanones", "orden_compra_id"))) {
    await pool.query("ALTER TABLE aceite_estanones ADD COLUMN orden_compra_id INT NULL AFTER monto_total");
  }

  if (!(await columnExists("aceite_estanones", "orden_compra_numero"))) {
    await pool.query("ALTER TABLE aceite_estanones ADD COLUMN orden_compra_numero VARCHAR(50) NULL AFTER orden_compra_id");
  }

  if (!(await indexExists("aceite_estanones", "idx_aceite_estanones_orden_compra"))) {
    await pool.query("CREATE INDEX idx_aceite_estanones_orden_compra ON aceite_estanones (orden_compra_id)");
  }
}

function puedeUsarSede(sede, sedesPermitidas) {
  return sedesPermitidas.length === 0 || sedesPermitidas.includes(sedeOperativaRepuestosAceites(sede));
}

async function consumirAceitePorSede(connection, { sede, litros, cambioAceiteId, unidadId, placa, userId }) {
  const sedeInventario = sedeInventarioAceite(sede);
  const sedesBusqueda = expandirSedeInventarioAceite(sede);
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
    throw new Error(`No hay suficiente aceite registrado en ${etiquetaSedeInventarioAceite(sede)}. Disponible: ${(disponible / GALON_A_LITROS).toFixed(2)} galones.`);
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
        sedeInventario,
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

async function obtenerConsumosAceiteDesde(connection, { sede, fechaCompra }) {
  const sedesBusqueda = expandirSedeInventarioAceite(sede);
  const [consumos] = await connection.query(
    `SELECT *
     FROM (
       SELECT
         ca.id AS cambio_id,
         ca.unidad_id,
         u.placa,
         ca.sede,
         ca.fecha,
         GREATEST(
           COALESCE(ca.litros_usados, ca.galones * ?) - COALESCE(am.litros_rebajados, 0),
           0
         ) AS litros_usados,
         'ACTUAL' AS origen
       FROM cambios_aceite ca
       JOIN unidades u ON u.id = ca.unidad_id
       LEFT JOIN (
         SELECT cambio_aceite_id, SUM(litros) AS litros_rebajados
         FROM aceite_movimientos
         WHERE tipo = 'SALIDA'
           AND cambio_aceite_id IS NOT NULL
         GROUP BY cambio_aceite_id
       ) am ON am.cambio_aceite_id = ca.id
       WHERE ca.sede IN (?)
         AND DATE(ca.fecha) >= ?
         AND ca.fecha <= NOW()

       UNION ALL

       SELECT
         cah.id AS cambio_id,
         cah.unidad_id,
         u.placa,
         cah.sede,
         COALESCE(cah.fecha, cah.archivado_en) AS fecha,
         COALESCE(cah.litros_usados, cah.galones * ?) AS litros_usados,
         'HISTORIAL' AS origen
       FROM cambios_aceite_historial cah
       JOIN unidades u ON u.id = cah.unidad_id
       WHERE cah.sede IN (?)
         AND DATE(COALESCE(cah.fecha, cah.archivado_en)) >= ?
         AND COALESCE(cah.fecha, cah.archivado_en) <= NOW()
         AND NOT EXISTS (
           SELECT 1
           FROM cambios_aceite ca_actual
           WHERE ca_actual.unidad_id = cah.unidad_id
             AND ca_actual.sede = cah.sede
             AND ABS(TIMESTAMPDIFF(SECOND, ca_actual.fecha, COALESCE(cah.fecha, cah.archivado_en))) <= 2
             AND ABS(COALESCE(ca_actual.litros_usados, ca_actual.galones * ?) - COALESCE(cah.litros_usados, cah.galones * ?)) <= 0.01
         )
     ) consumos
     WHERE litros_usados > 0
     ORDER BY fecha ASC, placa ASC, cambio_id ASC`,
    [GALON_A_LITROS, sedesBusqueda, fechaCompra, GALON_A_LITROS, sedesBusqueda, fechaCompra, GALON_A_LITROS, GALON_A_LITROS]
  );

  return consumos;
}

async function rebajarConsumosHistoricosEstanon(connection, { estanonId, sede, fechaCompra, litrosDisponibles, userId }) {
  const consumos = await obtenerConsumosAceiteDesde(connection, { sede, fechaCompra });
  let litrosRestantes = Number(litrosDisponibles || 0);
  let litrosRebajados = 0;
  let cambiosAplicados = 0;

  for (const consumo of consumos) {
    if (litrosRestantes <= 0.001) break;

    const litrosCambio = Number(consumo.litros_usados || 0);
    const litrosSalida = Math.min(litrosRestantes, litrosCambio);
    if (litrosSalida <= 0) continue;

    litrosRestantes = Math.max(0, litrosRestantes - litrosSalida);
    litrosRebajados += litrosSalida;
    cambiosAplicados += 1;

    const fechaCambio = consumo.fecha
      ? new Date(consumo.fecha).toLocaleDateString("es-CR", { timeZone: "America/Costa_Rica" })
      : fechaCompra;

    await connection.query(
      `INSERT INTO aceite_movimientos
       (estanon_id, cambio_aceite_id, sede, tipo, litros, descripcion, unidad_id, placa, creado_por)
       VALUES (?, ?, ?, 'SALIDA', ?, ?, ?, ?, ?)`,
      [
        estanonId,
        consumo.origen === "ACTUAL" ? consumo.cambio_id : null,
        sedeInventarioAceite(sede),
        litrosSalida,
        `Rebajo automático por cambio de aceite ${consumo.placa} del ${fechaCambio}`,
        consumo.unidad_id,
        consumo.placa,
        userId || null
      ]
    );
  }

  await connection.query(
    `UPDATE aceite_estanones
     SET litros_restantes = ?,
         estado = CASE WHEN ? <= 0.001 THEN 'AGOTADO' ELSE 'ACTIVO' END
     WHERE id = ?`,
    [litrosRestantes, litrosRestantes, estanonId]
  );

  return {
    litrosRestantes,
    litrosRebajados,
    cambiosAplicados,
    cambiosEncontrados: consumos.length
  };
}

async function sincronizarCambiosPendientesAceite(sedesPermitidas, userId) {
  if (!sedesPermitidas.length) return;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [pendientes] = await connection.query(
      `SELECT
         ca.id,
         ca.unidad_id,
         u.placa,
         ca.sede,
         ca.fecha,
         GREATEST(
           COALESCE(ca.litros_usados, ca.galones * ?) - COALESCE(SUM(CASE WHEN am.tipo = 'SALIDA' THEN am.litros ELSE 0 END), 0),
           0
         ) AS litros_pendientes
       FROM cambios_aceite ca
       JOIN unidades u ON u.id = ca.unidad_id
       LEFT JOIN aceite_movimientos am ON am.cambio_aceite_id = ca.id
       WHERE ca.sede IN (?)
       GROUP BY ca.id, ca.unidad_id, u.placa, ca.sede, ca.fecha, ca.litros_usados, ca.galones
       HAVING litros_pendientes > 0.001
       ORDER BY ca.fecha ASC, ca.id ASC`,
      [GALON_A_LITROS, sedesPermitidas]
    );

    for (const pendiente of pendientes) {
      const sedeInventario = sedeInventarioAceite(pendiente.sede);
      const sedesBusqueda = expandirSedeInventarioAceite(pendiente.sede);
      const [estanones] = await connection.query(
        `SELECT id, litros_restantes
         FROM aceite_estanones
         WHERE sede IN (?)
           AND estado = 'ACTIVO'
           AND litros_restantes > 0
           AND fecha_compra <= DATE(?)
         ORDER BY fecha_compra ASC, id ASC
         FOR UPDATE`,
        [sedesBusqueda, pendiente.fecha]
      );

      let litrosPendientes = Number(pendiente.litros_pendientes || 0);
      for (const estanon of estanones) {
        if (litrosPendientes <= 0.001) break;

        const restanteActual = Number(estanon.litros_restantes || 0);
        const litrosSalida = Math.min(restanteActual, litrosPendientes);
        const nuevoRestante = Math.max(0, restanteActual - litrosSalida);

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
            pendiente.id,
            sedeInventario,
            litrosSalida,
            `Rebajo sincronizado por cambio de aceite ${pendiente.placa}`,
            pendiente.unidad_id,
            pendiente.placa,
            userId || null
          ]
        );

        litrosPendientes -= litrosSalida;
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function obtenerOrdenesAceiteRecientes() {
  const [ordenes] = await pool.query(
    `SELECT
       o.id,
       o.po_numero,
       DATE_FORMAT(o.fecha, '%d/%m/%Y') AS fecha_formato,
       o.fecha,
       o.total,
       o.placa_unidad,
       o.factura,
       p.nombre AS proveedor_nombre
     FROM ordenes_compra o
     LEFT JOIN proveedores p ON p.id = o.proveedor_id
     WHERE UPPER(CONCAT_WS(' ', o.placa_unidad, o.observaciones, o.factura, p.nombre)) REGEXP 'ACEITE|ACEITES|MOBIL|MOVIL|PICO|LIASA'
     ORDER BY o.fecha DESC, o.id DESC
     LIMIT 150`
  );
  return ordenes;
}

async function obtenerGastoAceitePorPlaca(sedesPermitidas) {
  const [rows] = await pool.query(
    `SELECT
       am.placa,
       COALESCE(u.sede, am.sede) AS sede,
       COUNT(DISTINCT COALESCE(am.cambio_aceite_id, am.id)) AS cambios,
       COALESCE(SUM(am.litros), 0) AS litros,
       COALESCE(SUM(
         am.litros *
         CASE
           WHEN COALESCE(ae.monto_total, 0) > 0 AND COALESCE(entrada.litros_entrada, ae.litros_capacidad, 0) > 0
             THEN ae.monto_total / COALESCE(entrada.litros_entrada, ae.litros_capacidad)
           ELSE 0
         END
       ), 0) AS gasto,
       COALESCE(SUM(CASE WHEN COALESCE(ae.monto_total, 0) <= 0 THEN am.litros ELSE 0 END), 0) AS litros_sin_costo,
       GROUP_CONCAT(
         DISTINCT COALESCE(ae.orden_compra_numero, CONCAT('Estañón ', ae.id))
         ORDER BY ae.fecha_compra ASC, ae.id ASC
         SEPARATOR ', '
       ) AS ordenes
     FROM aceite_movimientos am
     JOIN aceite_estanones ae ON ae.id = am.estanon_id
     LEFT JOIN (
       SELECT estanon_id, SUM(litros) AS litros_entrada
       FROM aceite_movimientos
       WHERE tipo = 'ENTRADA'
       GROUP BY estanon_id
     ) entrada ON entrada.estanon_id = ae.id
     LEFT JOIN unidades u ON u.id = am.unidad_id
     WHERE am.sede IN (?)
       AND am.tipo = 'SALIDA'
       AND NULLIF(TRIM(am.placa), '') IS NOT NULL
     GROUP BY am.placa, COALESCE(u.sede, am.sede)
     ORDER BY gasto DESC, litros DESC, am.placa ASC
     LIMIT 300`,
    [sedesPermitidas]
  );
  return rows;
}

router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    await ensureAceiteTables();
    const sedesPermitidas = await getSedesPermitidasAceite(req);
    const sedesInventario = expandirSedesInventarioAceite(sedesPermitidas);
    const sedesGestion = sedesOperativasVisibles((await obtenerTodasSedes(pool)).filter(sede => puedeUsarSede(sede, sedesPermitidas)));
    await sincronizarCambiosPendientesAceite(sedesPermitidas, req.session.user.id || null);

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
        COALESCE(am.litros_rebajados, 0) AS litros_rebajados,
        ca.proximo_km,
        ca.observaciones,
        us.nombre AS mecanico
      FROM cambios_aceite ca
      JOIN unidades u ON u.id = ca.unidad_id
      LEFT JOIN usuarios us ON us.id = ca.creado_por
      LEFT JOIN (
        SELECT cambio_aceite_id, SUM(litros) AS litros_rebajados
        FROM aceite_movimientos
        WHERE tipo = 'SALIDA'
          AND cambio_aceite_id IS NOT NULL
        GROUP BY cambio_aceite_id
      ) am ON am.cambio_aceite_id = ca.id
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
      [sedesInventario]
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
      [sedesInventario]
    );

    const ordenesAceite = await obtenerOrdenesAceiteRecientes();
    const gastoPorPlaca = await obtenerGastoAceitePorPlaca(sedesInventario);

    const resumen = estanones.reduce((acc, item) => {
      const capacidad = Number(item.litros_capacidad || CAPACIDAD_ESTANON_LITROS);
      const restantes = Number(item.litros_restantes || 0);
      acc.capacidad += capacidad;
      acc.restantes += restantes;
      acc.consumidos += Number(item.litros_consumidos || 0);
      acc.costoRegistrado += Number(item.monto_total || 0);
      if (item.estado === "ACTIVO") acc.activos += 1;
      if (restantes <= capacidad * 0.2 && item.estado === "ACTIVO") acc.bajos += 1;
      return acc;
    }, { capacidad: 0, restantes: 0, consumidos: 0, costoRegistrado: 0, activos: 0, bajos: 0 });

    resumen.gastoAsignadoPlacas = gastoPorPlaca.reduce((sum, item) => sum + Number(item.gasto || 0), 0);

    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render("aceite_listado", {
      cambios,
      estanones,
      movimientos,
      gastoPorPlaca,
      ordenesAceite,
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
    const sedesPermitidas = await getSedesPermitidasAceite(req);

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
  let connection;
  try {
    if (!puedeGestionarAceite(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    await ensureAceiteTables();
    const sedesPermitidas = await getSedesPermitidasAceite(req);
    const sedeSolicitada = sedeOperativaRepuestosAceites(req.body.sede);
    const sede = sedeInventarioAceite(sedeSolicitada);
    const fechaCompra = fechaValida(req.body.fecha_compra);
    const descripcion = String(req.body.descripcion || "").trim() || "Estañón de aceite 55 galones";
    const galonesCapacidad = parseMonto(req.body.galones_capacidad || req.body.litros_capacidad) || CAPACIDAD_ESTANON_GALONES;
    const galonesIniciales = parseMonto(req.body.galones_iniciales || req.body.litros_iniciales) || galonesCapacidad;
    const litrosCapacidad = galonesALitros(galonesCapacidad);
    const litrosIniciales = galonesALitros(galonesIniciales);
    const ordenCompraId = Number(req.body.orden_compra_id || 0);
    let montoTotal = parseMonto(req.body.monto_total);
    let ordenCompraNumero = null;

    if (!sedeSolicitada || !puedeUsarSede(sedeSolicitada, sedesPermitidas)) {
      req.session.error = "Seleccione una sede permitida para el estañón.";
      return res.redirect("/aceite");
    }

    if (galonesIniciales <= 0 || galonesIniciales > galonesCapacidad) {
      req.session.error = "Los galones iniciales deben ser mayores a cero y no superar la capacidad.";
      return res.redirect("/aceite");
    }

    if (ordenCompraId > 0) {
      const [[orden]] = await pool.query(
        "SELECT id, po_numero, total FROM ordenes_compra WHERE id = ? LIMIT 1",
        [ordenCompraId]
      );
      if (!orden) {
        req.session.error = "La orden de aceite seleccionada no existe.";
        return res.redirect("/aceite");
      }
      ordenCompraNumero = orden.po_numero || `OC-${orden.id}`;
      if (montoTotal <= 0) montoTotal = parseMonto(orden.total);
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO aceite_estanones
       (sede, descripcion, fecha_compra, litros_capacidad, litros_restantes, monto_total, orden_compra_id, orden_compra_numero, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sede,
        descripcion,
        fechaCompra,
        litrosCapacidad,
        litrosIniciales,
        montoTotal,
        ordenCompraId > 0 ? ordenCompraId : null,
        ordenCompraNumero,
        req.session.user.id || null
      ]
    );

    await connection.query(
      `INSERT INTO aceite_movimientos
       (estanon_id, sede, tipo, litros, descripcion, creado_por)
       VALUES (?, ?, 'ENTRADA', ?, ?, ?)`,
      [result.insertId, sede, litrosIniciales, descripcion, req.session.user.id || null]
    );

    const rebajo = await rebajarConsumosHistoricosEstanon(connection, {
      estanonId: result.insertId,
      sede,
      fechaCompra,
      litrosDisponibles: litrosIniciales,
      userId: req.session.user.id || null
    });

    await connection.commit();

    const galonesRebajados = rebajo.litrosRebajados / GALON_A_LITROS;
    const galonesRestantes = rebajo.litrosRestantes / GALON_A_LITROS;
    req.session.success = rebajo.cambiosAplicados > 0
      ? `Estañón agregado para ${etiquetaSedeInventarioAceite(sede)} con ${galonesIniciales.toFixed(2)} galones. Se rebajaron automáticamente ${galonesRebajados.toFixed(2)} galones de ${rebajo.cambiosAplicados} cambio(s) desde ${fechaCompra}. Disponible ahora: ${galonesRestantes.toFixed(2)} galones.`
      : `Estañón agregado para ${etiquetaSedeInventarioAceite(sede)} con ${galonesIniciales.toFixed(2)} galones. No había cambios registrados desde ${fechaCompra} para rebajar.`;
    res.redirect("/aceite");
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("ERROR agregando estañón:", error);
    req.session.error = "No se pudo agregar el estañón.";
    res.redirect("/aceite");
  } finally {
    if (connection) connection.release();
  }
});

router.post("/estanones/:id/costo", async (req, res) => {
  try {
    if (!puedeGestionarAceite(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    await ensureAceiteTables();
    const id = Number(req.params.id);
    const sedesPermitidas = await getSedesPermitidasAceite(req);
    const montoTotal = parseMonto(req.body.monto_total);
    const ordenCompraId = Number(req.body.orden_compra_id || 0);
    let ordenCompraNumero = String(req.body.orden_compra_numero || "").trim().slice(0, 50) || null;

    if (!Number.isInteger(id) || id <= 0) {
      req.session.error = "Estañón no válido.";
      return res.redirect("/aceite");
    }

    const [[estanon]] = await pool.query(
      "SELECT id, sede FROM aceite_estanones WHERE id = ? LIMIT 1",
      [id]
    );
    if (!estanon || !puedeUsarSede(estanon.sede, sedesPermitidas)) {
      return res.status(403).send("No autorizado para ese estañón");
    }

    if (ordenCompraId > 0) {
      const [[orden]] = await pool.query(
        "SELECT id, po_numero FROM ordenes_compra WHERE id = ? LIMIT 1",
        [ordenCompraId]
      );
      if (!orden) {
        req.session.error = "La orden de compra indicada no existe.";
        return res.redirect("/aceite");
      }
      ordenCompraNumero = orden.po_numero || `OC-${orden.id}`;
    }

    await pool.query(
      `UPDATE aceite_estanones
       SET monto_total = ?,
           orden_compra_id = ?,
           orden_compra_numero = ?
       WHERE id = ?`,
      [montoTotal, ordenCompraId > 0 ? ordenCompraId : null, ordenCompraNumero, id]
    );

    req.session.success = "Costo del estañón actualizado. El gasto por placa se recalculó.";
    res.redirect("/aceite");
  } catch (error) {
    console.error("ERROR actualizando costo de estañón:", error);
    req.session.error = "No se pudo actualizar el costo del estañón.";
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
    const sedesPermitidas = await getSedesPermitidasAceite(req);

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
    req.session.success = `Cambio de aceite guardado y se rebajaron ${galonesUsados.toFixed(2)} galones de ${etiquetaSedeInventarioAceite(unidad.sede)}.`;
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
