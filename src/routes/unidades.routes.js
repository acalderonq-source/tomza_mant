const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  agregarTallerParaMecanico,
  etiquetaSede,
  esSedeTransporte,
  esUsuarioTodasSedes,
  obtenerTodasSedes,
  obtenerSedesTransporte,
  sedeGranelDesdeUsuario
} = require("../utils/sedes");
const { agregarFiltroPlacaSql, normalizarPlaca } = require("../utils/placas");

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

router.use(requireAuth);

function puedeEditarUnidades(user) {
  return ["ADMIN", "TALLER", "MECANICO"].includes(user.rol);
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
    ["razon_varada", "TEXT NULL"],
  ];

  for (const [column, definition] of columns) {
    if (!(await columnExists("unidades", column))) {
      await pool.query(`ALTER TABLE unidades ADD COLUMN ${column} ${definition}`);
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS unidades_sede_historial (
      id INT AUTO_INCREMENT PRIMARY KEY,
      unidad_id INT NOT NULL,
      placa VARCHAR(80) NOT NULL,
      sede_anterior VARCHAR(100) NULL,
      sede_nueva VARCHAR(100) NOT NULL,
      usuario_id INT NULL,
      usuario_nombre VARCHAR(120) NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_unidad_fecha (unidad_id, creado_en),
      INDEX idx_placa_fecha (placa, creado_en),
      INDEX idx_sede_nueva (sede_nueva),
      CONSTRAINT fk_unidades_sede_historial_unidad
        FOREIGN KEY (unidad_id) REFERENCES unidades(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function obtenerSedesPermitidas(req) {
  const user = req.session.user;

  if (esUsuarioTodasSedes(user)) {
    if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
      return [req.session.sedeSeleccionada];
    }
    return [];
  }

  const esUsuarioPesados = user.rol === "SUPERVISOR_PESADO" ||
    String(user.usuario || "").trim().toLowerCase() === "pesados";
  const sedeGranelUsuario = sedeGranelDesdeUsuario(user);

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

  if (esUsuarioPesados) {
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
  const todasLasSedes = agregarTallerParaMecanico(user, [user.sede, ...sedesExtras]);

  if (
    req.session.sedeSeleccionada &&
    todasLasSedes.includes(req.session.sedeSeleccionada)
  ) {
    return [req.session.sedeSeleccionada];
  }

  return todasLasSedes;
}

async function obtenerSedesEditables(req) {
  if (esUsuarioTodasSedes(req.session.user)) {
    return obtenerTodasSedes(pool);
  }

  return obtenerSedesPermitidas(req);
}

function redirectUnidades(req, res) {
  const params = new URLSearchParams();
  ["estado", "varado", "placa"].forEach(key => {
    const value = String(req.body[key] || req.query[key] || "").trim();
    if (value) params.set(key, value);
  });
  res.redirect(`/unidades${params.toString() ? `?${params.toString()}` : ""}`);
}

function puedeVerUnidad(unidad, sedesPermitidas) {
  return sedesPermitidas.length === 0 || sedesPermitidas.includes(unidad.sede);
}

function normalizarPlacaUnidad(value) {
  return normalizarPlaca(value) || "";
}

async function obtenerUnidadAutorizada(req, id) {
  const sedesPermitidas = await obtenerSedesPermitidas(req);
  const [[unidad]] = await pool.query(
    `SELECT id, placa, sede, activa, varada, razon_varada
     FROM unidades
     WHERE id = ?
     LIMIT 1`,
    [id]
  );

  if (!unidad) {
    return { error: 404, mensaje: "Unidad no encontrada" };
  }

  if (!puedeVerUnidad(unidad, sedesPermitidas)) {
    return { error: 403, mensaje: "No tienes permiso para cambiar esta unidad." };
  }

  return { unidad };
}

// ===================== LISTADO DE UNIDADES =====================
router.get("/", async (req, res) => {
  try {
    await ensureUnidadEstadoColumns();

    const user = req.session.user;
    const sedesPermitidas = await obtenerSedesPermitidas(req);
    const estadoFiltro = req.query.estado || "activas";
    const varadoFiltro = req.query.varado || "";
    const placaFiltro = String(req.query.placa || "").trim();

    let sql = `
      SELECT id, placa, sede, activa, varada, razon_varada
      FROM unidades
      WHERE 1=1
    `;
    const params = [];

    if (sedesPermitidas.length > 0) {
      sql += " AND sede IN (?)";
      params.push(sedesPermitidas);
    }

    if (estadoFiltro === "activas") {
      sql += " AND activa = 1";
    } else if (estadoFiltro === "inactivas") {
      sql += " AND activa = 0";
    }

    if (varadoFiltro === "1") {
      sql += " AND varada = 1";
    } else if (varadoFiltro === "0") {
      sql += " AND varada = 0";
    }

    if (placaFiltro) {
      const condicionesPlaca = [];
      agregarFiltroPlacaSql(condicionesPlaca, params, "placa", placaFiltro);
      if (condicionesPlaca.length) {
        sql += ` AND ${condicionesPlaca[0]}`;
      }
    }

    sql += " ORDER BY activa DESC, varada DESC, sede ASC, placa ASC";

    const [unidades] = await pool.query(sql, params);
    const sedesFormulario = await obtenerTodasSedes(pool);
    const sedesEditables = await obtenerSedesEditables(req);

    let resumenSql = `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN activa = 1 THEN 1 ELSE 0 END) AS activas,
        SUM(CASE WHEN activa = 0 THEN 1 ELSE 0 END) AS inactivas,
        SUM(CASE WHEN varada = 1 THEN 1 ELSE 0 END) AS varadas
      FROM unidades
      WHERE 1=1
    `;
    const resumenParams = [];

    if (sedesPermitidas.length > 0) {
      resumenSql += " AND sede IN (?)";
      resumenParams.push(sedesPermitidas);
    }

    const [[resumen]] = await pool.query(resumenSql, resumenParams);

    res.render("unidades", {
      unidades,
      user,
      sedeSeleccionada: req.session.sedeSeleccionada || "TODAS",
      sedesFormulario,
      sedesEditables,
      etiquetaSede,
      puedeEditar: puedeEditarUnidades(user),
      success: req.query.success || "",
      error: req.query.error || "",
      filtros: {
        estado: estadoFiltro,
        varado: varadoFiltro,
        placa: placaFiltro,
      },
      resumen: {
        total: Number(resumen.total || 0),
        activas: Number(resumen.activas || 0),
        inactivas: Number(resumen.inactivas || 0),
        varadas: Number(resumen.varadas || 0),
      },
    });
  } catch (error) {
    console.error("ERROR /unidades:", error);
    res.status(500).send("Error interno");
  }
});

async function agregarUnidad(req, res) {
  try {
    await ensureUnidadEstadoColumns();

    if (!puedeEditarUnidades(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    const { placa, sede } = req.body;
    const placaNormalizada = normalizarPlacaUnidad(placa);

    if (!placaNormalizada) {
      return res.status(400).send("La placa es obligatoria");
    }

    const sedeAsignada =
      esUsuarioTodasSedes(req.session.user) && sede
        ? sede
        : req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS"
          ? req.session.sedeSeleccionada
          : req.session.user.sede;

    if (!sedeAsignada) {
      return res.status(400).send("No se pudo determinar la sede de la unidad");
    }

    const [[existente]] = await pool.query(
      "SELECT id, placa, sede, activa FROM unidades WHERE placa = ? LIMIT 1",
      [placaNormalizada]
    );

    if (existente) {
      const sedesPermitidas = await obtenerSedesPermitidas(req);

      if (!puedeVerUnidad(existente, sedesPermitidas)) {
        return res.redirect(
          `/unidades?error=${encodeURIComponent(`La unidad ${placaNormalizada} ya existe en otra sede.`)}&placa=${encodeURIComponent(placaNormalizada)}&estado=todas`
        );
      }

      await pool.query(
        `UPDATE unidades
         SET sede = ?,
             activa = 1
         WHERE id = ?`,
        [sedeAsignada, existente.id]
      );

      return res.redirect(
        `/unidades?success=${encodeURIComponent(`La unidad ${placaNormalizada} ya existía. Se actualizó y quedó activa.`)}&placa=${encodeURIComponent(placaNormalizada)}&estado=todas`
      );
    }

    await pool.query(
      "INSERT INTO unidades (placa, sede, activa, varada, razon_varada) VALUES (?, ?, 1, 0, NULL)",
      [placaNormalizada, sedeAsignada]
    );

    res.redirect(
      `/unidades?success=${encodeURIComponent(`Unidad ${placaNormalizada} agregada correctamente.`)}&placa=${encodeURIComponent(placaNormalizada)}`
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      const placaNormalizada = normalizarPlacaUnidad(req.body.placa);
      return res.redirect(
        `/unidades?error=${encodeURIComponent(`La unidad ${placaNormalizada} ya está registrada.`)}&placa=${encodeURIComponent(placaNormalizada)}&estado=todas`
      );
    }

    console.error("ERROR agregar unidad:", error);
    res.status(500).send("Error interno");
  }
}

// ===================== AGREGAR UNIDAD =====================
router.post("/", agregarUnidad);
router.post("/agregar", agregarUnidad);

// ===================== ACTIVAR / INACTIVAR UNIDAD =====================
router.post("/:id/estado", async (req, res) => {
  try {
    await ensureUnidadEstadoColumns();

    if (!puedeEditarUnidades(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).send("ID de unidad inválido");
    }

    const resultado = await obtenerUnidadAutorizada(req, id);
    if (resultado.error) {
      return res.status(resultado.error).send(resultado.mensaje);
    }

    const activa = req.body.activa === "1" ? 1 : 0;

    await pool.query(
      `UPDATE unidades
       SET activa = ?,
           varada = CASE WHEN ? = 0 THEN 0 ELSE varada END,
           razon_varada = CASE WHEN ? = 0 THEN NULL ELSE razon_varada END
       WHERE id = ?`,
      [activa, activa, activa, id]
    );

    res.redirect("/unidades");
  } catch (error) {
    console.error("ERROR actualizando estado unidad:", error);
    res.status(500).send("Error interno");
  }
});

// ===================== CAMBIAR SEDE =====================
router.post("/:id/sede", async (req, res) => {
  try {
    await ensureUnidadEstadoColumns();

    if (!puedeEditarUnidades(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).send("ID de unidad invalido");
    }

    const resultado = await obtenerUnidadAutorizada(req, id);
    if (resultado.error) {
      return res.status(resultado.error).send(resultado.mensaje);
    }

    const sedeNueva = String(req.body.sede || "").trim();
    const sedesEditables = await obtenerSedesEditables(req);

    if (!sedeNueva || !sedesEditables.includes(sedeNueva)) {
      return res.redirect(
        `/unidades?error=${encodeURIComponent("Seleccione una sede permitida.")}`
      );
    }

    const unidad = resultado.unidad;

    if (String(unidad.sede || "") === sedeNueva) {
      return redirectUnidades(req, res);
    }

    await pool.query(
      `UPDATE unidades
       SET sede = ?
       WHERE id = ?`,
      [sedeNueva, id]
    );

    await pool.query(
      `INSERT INTO unidades_sede_historial
       (unidad_id, placa, sede_anterior, sede_nueva, usuario_id, usuario_nombre)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        unidad.placa,
        unidad.sede || null,
        sedeNueva,
        req.session.user.id || null,
        req.session.user.usuario || req.session.user.nombre || req.session.user.rol || null
      ]
    );

    return res.redirect(
      `/unidades?success=${encodeURIComponent(`Sede actualizada para ${unidad.placa}.`)}&placa=${encodeURIComponent(unidad.placa)}&estado=todas`
    );
  } catch (error) {
    console.error("ERROR actualizando sede unidad:", error);
    res.status(500).send("Error interno");
  }
});

// ===================== MARCAR / LIMPIAR VARADA =====================
router.post("/:id/varada", async (req, res) => {
  try {
    await ensureUnidadEstadoColumns();

    if (!puedeEditarUnidades(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).send("ID de unidad inválido");
    }

    const resultado = await obtenerUnidadAutorizada(req, id);
    if (resultado.error) {
      return res.status(resultado.error).send(resultado.mensaje);
    }

    const varada = req.body.varada === "1" ? 1 : 0;
    const razon = String(req.body.razon_varada || "").trim();

    if (varada === 1 && !razon) {
      return res.status(400).send("Debe indicar la razón por la que la unidad está varada");
    }

    await pool.query(
      `UPDATE unidades
       SET varada = ?,
           razon_varada = ?,
           activa = CASE WHEN ? = 1 THEN 1 ELSE activa END
       WHERE id = ?`,
      [varada, varada ? razon : null, varada, id]
    );

    res.redirect("/unidades");
  } catch (error) {
    console.error("ERROR actualizando unidad varada:", error);
    res.status(500).send("Error interno");
  }
});

module.exports = router;
