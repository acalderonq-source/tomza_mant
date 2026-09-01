const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  agregarTallerParaMecanico,
  clasificarSubgrupoTransportadora,
  etiquetaSede,
  esSedeTransporte,
  esUsuarioTodasSedes,
  expandirSedesEquivalentes,
  obtenerTodasSedes,
  obtenerSedesTransporte,
  sedeGranelDesdeUsuario
} = require("../utils/sedes");
const { agregarFiltroPlacaSql } = require("../utils/placas");

const SEDES_CILINDREROS = [
  "ALAJUELA",
  "CARTAGO",
  "GUAPILES",
  "LA CRUZ",
  "NICOYA",
  "OROTINA",
  "PEREZ ZELEDON",
  "RIO CLARO",
  "SAN CARLOS"
];

const ORDEN_NEGOCIOS_UNIDADES = ["CILINDREROS", "GRANELES", "TRANSPORTADORA", "OTROS"];

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
    ["marca", "VARCHAR(100) NULL"],
    ["modelo", "VARCHAR(120) NULL"],
    ["anio", "INT NULL"],
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
      return expandirSedesEquivalentes(req.session.sedeSeleccionada);
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
      return expandirSedesEquivalentes(req.session.sedeSeleccionada);
    }
    return expandirSedesEquivalentes(sedeGranelUsuario);
  }

  if (esUsuarioPesados) {
    if (
      req.session.sedeSeleccionada &&
      req.session.sedeSeleccionada !== "TODAS" &&
      esSedeTransporte(req.session.sedeSeleccionada)
    ) {
      return expandirSedesEquivalentes(req.session.sedeSeleccionada);
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
    return expandirSedesEquivalentes(req.session.sedeSeleccionada);
  }

  return expandirSedesEquivalentes(todasLasSedes);
}

async function obtenerSedesEditables(req) {
  if (esUsuarioTodasSedes(req.session.user)) {
    return obtenerTodasSedes(pool);
  }

  return obtenerSedesPermitidas(req);
}

function redirectUnidades(req, res, mensajes = {}) {
  const referer = String(req.get("referer") || "");
  let pathname = "/unidades";
  const params = new URLSearchParams();

  try {
    const url = new URL(referer);
    if (url.pathname === "/unidades") {
      pathname = url.pathname;
      url.searchParams.forEach((value, key) => {
        if (!["success", "error"].includes(key)) params.set(key, value);
      });
    }
  } catch (_) {
    ["estado", "varado", "placa"].forEach(key => {
      const value = String(req.body[key] || req.query[key] || "").trim();
      if (value) params.set(key, value);
    });
  }

  if (mensajes.success) params.set("success", mensajes.success);
  if (mensajes.error) params.set("error", mensajes.error);

  res.redirect(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
}

function puedeVerUnidad(unidad, sedesPermitidas) {
  return sedesPermitidas.length === 0 || sedesPermitidas.includes(unidad.sede);
}

function normalizarPlacaUnidad(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function construirPlacaUnidad({ placa, prefijo, numero } = {}) {
  const prefijoLimpio = normalizarPlacaUnidad(prefijo);
  const numeroLimpio = normalizarPlacaUnidad(numero);
  const usaSelectorPrefijo = prefijo !== null && typeof prefijo !== "undefined";

  if (numeroLimpio) {
    const numeroSinPrefijo = numeroLimpio.replace(/^(CL|EE|C|S)(?=\d)/, "");
    if (usaSelectorPrefijo) {
      return `${prefijoLimpio}${numeroSinPrefijo}`;
    }
    if (/^(CL|EE|C|S)\d{1,}$/.test(numeroLimpio)) {
      return numeroLimpio;
    }
    return `${prefijoLimpio}${numeroSinPrefijo}`;
  }

  return normalizarPlacaUnidad(placa);
}

function escapeIdentifier(identifier) {
  return `\`${String(identifier || "").replace(/`/g, "``")}\``;
}

async function obtenerUsosUnidad(unidadId) {
  const tablasIgnoradas = new Set(["unidades_sede_historial"]);
  const [columnas] = await pool.query(
    `SELECT TABLE_NAME AS tableName
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND COLUMN_NAME = 'unidad_id'
       AND TABLE_NAME <> 'unidades'
     ORDER BY TABLE_NAME`
  );

  const usos = [];
  for (const columna of columnas) {
    const tableName = columna.tableName;
    if (tablasIgnoradas.has(tableName)) continue;

    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS total FROM ${escapeIdentifier(tableName)} WHERE unidad_id = ?`,
      [unidadId]
    );
    const total = Number(row.total || 0);
    if (total > 0) usos.push({ tableName, total });
  }

  return usos;
}

function normalizarClaveNegocio(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function clasificarNegocioUnidad(unidad) {
  const sede = normalizarClaveNegocio(unidad.sede);
  const placa = String(unidad.placa || "").toUpperCase().replace(/\s+/g, "");

  if (sede.includes("GRANEL")) {
    return {
      negocio: "GRANELES",
      subgrupo: etiquetaSede(unidad.sede) || "Granel"
    };
  }

  if (sede === "TRANSPORTADORA" || placa.startsWith("EE") || ["CABEZAL", "CABEZALES", "CISTERNA", "CISTERNAS", "CARRETA", "CARRETAS", "GRUA", "GRUAS", "TANDEM", "TAMDEN"].some(valor => sede.includes(valor))) {
    return {
      negocio: "TRANSPORTADORA",
      subgrupo: clasificarSubgrupoTransportadora({ sede: unidad.sede, placa: unidad.placa })
    };
  }

  if (SEDES_CILINDREROS.includes(sede)) {
    return {
      negocio: "CILINDREROS",
      subgrupo: etiquetaSede(unidad.sede) || unidad.sede || "Sin sede"
    };
  }

  return {
    negocio: "OTROS",
    subgrupo: etiquetaSede(unidad.sede) || unidad.sede || "Otros"
  };
}

function crearResumenGrupoUnidades(nombre, subgrupoBase = []) {
  const subgrupos = new Map();
  subgrupoBase.forEach(subgrupo => {
    subgrupos.set(subgrupo, {
      nombre: subgrupo,
      total: 0,
      activas: 0,
      inactivas: 0,
      varadas: 0,
      unidades: []
    });
  });

  return {
    nombre,
    total: 0,
    activas: 0,
    inactivas: 0,
    varadas: 0,
    subgrupos
  };
}

function obtenerCambiosUnidadesDesdeBody(body = {}) {
  const cambios = body.unidades && typeof body.unidades === "object" ? { ...body.unidades } : {};

  Object.entries(body || {}).forEach(([key, value]) => {
    const match = key.match(/^unidades\[(\d+)\]\[([^\]]+)\]$/);
    if (!match) return;

    const [, id, field] = match;
    cambios[id] = cambios[id] || {};
    cambios[id][field] = value;
  });

  return cambios;
}

function agruparUnidadesPorNegocio(unidades) {
  const subgruposBase = {
    CILINDREROS: ["Alajuela", "Cartago", "Guapiles", "La Cruz", "Nicoya", "Orotina", "Perez Zeledon", "Rio Claro", "San Carlos"],
    GRANELES: ["Granel Cartago", "Granel Alajuela", "Granel La Cruz", "Granel Guapiles", "Granel Perez Zeledon"],
    TRANSPORTADORA: ["Cabezales", "Cisternas", "Carretas", "Grúas", "Tándem"],
    OTROS: ["Taller", "Tecnicos", "Otros"]
  };

  const grupos = new Map();
  ORDEN_NEGOCIOS_UNIDADES.forEach(nombre => {
    grupos.set(nombre, crearResumenGrupoUnidades(nombre, subgruposBase[nombre] || []));
  });

  unidades.forEach(unidad => {
    const clasificacion = clasificarNegocioUnidad(unidad);
    if (!grupos.has(clasificacion.negocio)) {
      grupos.set(clasificacion.negocio, crearResumenGrupoUnidades(clasificacion.negocio));
    }

    const grupo = grupos.get(clasificacion.negocio);
    grupo.total += 1;
    if (Number(unidad.activa) === 1) grupo.activas += 1;
    else grupo.inactivas += 1;
    if (Number(unidad.varada) === 1) grupo.varadas += 1;

    if (!grupo.subgrupos.has(clasificacion.subgrupo)) {
      grupo.subgrupos.set(clasificacion.subgrupo, {
        nombre: clasificacion.subgrupo,
        total: 0,
        activas: 0,
        inactivas: 0,
        varadas: 0,
        unidades: []
      });
    }

    const subgrupo = grupo.subgrupos.get(clasificacion.subgrupo);
    subgrupo.total += 1;
    if (Number(unidad.activa) === 1) subgrupo.activas += 1;
    else subgrupo.inactivas += 1;
    if (Number(unidad.varada) === 1) subgrupo.varadas += 1;
    subgrupo.unidades.push(unidad);
  });

  return [...grupos.values()].map(grupo => ({
    ...grupo,
    subgrupos: [...grupo.subgrupos.values()]
      .map(subgrupo => ({
        ...subgrupo,
        unidades: subgrupo.unidades.sort((a, b) => String(a.placa).localeCompare(String(b.placa), "es"))
      }))
      .filter(subgrupo => subgrupo.total > 0)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
  }));
}

async function obtenerUnidadAutorizada(req, id) {
  const sedesPermitidas = await obtenerSedesPermitidas(req);
  const [[unidad]] = await pool.query(
    `SELECT id, placa, sede, activa, varada, razon_varada, marca, modelo, anio
     FROM unidades
     WHERE id = ?
     LIMIT 1`,
    [id]
  );

  if (!unidad) {
    return { error: 404, mensaje: "Unidad no encontrada" };
  }

  if (!esUsuarioTodasSedes(req.session.user) && !puedeVerUnidad(unidad, sedesPermitidas)) {
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
      SELECT id, placa, sede, activa, varada, razon_varada, marca, modelo, anio
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
    const unidadesPorNegocio = agruparUnidadesPorNegocio(unidades);
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
      unidadesPorNegocio,
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

    const { sede } = req.body;
    const marca = String(req.body.marca || "").trim() || null;
    const modelo = String(req.body.modelo || "").trim() || null;
    const anio = req.body.anio ? parseInt(req.body.anio, 10) : null;
    const placaNormalizada = construirPlacaUnidad({
      placa: req.body.placa,
      prefijo: req.body.placa_prefijo,
      numero: req.body.placa_numero
    });

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

    if (anio !== null && (Number.isNaN(anio) || anio < 1980 || anio > 2100)) {
      return redirectUnidades(req, res, {
        error: "El año de la unidad no es válido."
      });
    }

    const [[existente]] = await pool.query(
      "SELECT id, placa, sede, activa FROM unidades WHERE placa = ? LIMIT 1",
      [placaNormalizada]
    );

    if (existente) {
      const sedesPermitidas = await obtenerSedesPermitidas(req);

      if (!esUsuarioTodasSedes(req.session.user) && !puedeVerUnidad(existente, sedesPermitidas)) {
        return redirectUnidades(req, res, {
          error: `La unidad ${placaNormalizada} ya existe en otra sede.`
        });
      }

      await pool.query(
        `UPDATE unidades
         SET sede = ?,
             activa = 1,
             marca = COALESCE(?, marca),
             modelo = COALESCE(?, modelo),
             anio = COALESCE(?, anio)
         WHERE id = ?`,
        [sedeAsignada, marca, modelo, anio, existente.id]
      );

      return redirectUnidades(req, res, {
        success: `La unidad ${placaNormalizada} ya existía. Se actualizó y quedó activa.`
      });
    }

    await pool.query(
      `INSERT INTO unidades
       (placa, sede, marca, modelo, anio, activa, varada, razon_varada)
       VALUES (?, ?, ?, ?, ?, 1, 0, NULL)`,
      [placaNormalizada, sedeAsignada, marca, modelo, anio]
    );

    return redirectUnidades(req, res, {
      success: `Unidad ${placaNormalizada} agregada correctamente.`
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      const placaNormalizada = construirPlacaUnidad({
        placa: req.body.placa,
        prefijo: req.body.placa_prefijo,
        numero: req.body.placa_numero
      });
      return redirectUnidades(req, res, {
        error: `La unidad ${placaNormalizada} ya está registrada.`
      });
    }

    console.error("ERROR agregar unidad:", error);
    res.status(500).send("Error interno");
  }
}

// ===================== AGREGAR UNIDAD =====================
router.post("/", agregarUnidad);
router.post("/agregar", agregarUnidad);

// ===================== GUARDAR CAMBIOS DEL LISTADO =====================
router.post("/guardar-masivo", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureUnidadEstadoColumns();

    if (!puedeEditarUnidades(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    const cambios = obtenerCambiosUnidadesDesdeBody(req.body);
    const ids = Object.keys(cambios)
      .map(id => parseInt(id, 10))
      .filter(id => !Number.isNaN(id));

    if (!ids.length) {
      return redirectUnidades(req, res, {
        error: "No hay unidades para guardar."
      });
    }

    const sedesPermitidas = await obtenerSedesPermitidas(req);
    const sedesEditables = await obtenerSedesEditables(req);
    const [actuales] = await pool.query(
      `SELECT id, placa, sede, activa, varada, razon_varada, marca, modelo, anio
       FROM unidades
       WHERE id IN (?)`,
      [ids]
    );

    await conn.beginTransaction();

    let actualizadas = 0;
    for (const unidad of actuales) {
      if (!esUsuarioTodasSedes(req.session.user) && !puedeVerUnidad(unidad, sedesPermitidas)) {
        continue;
      }

      const cambio = cambios[String(unidad.id)] || {};
      const placaNueva = construirPlacaUnidad({
        placa: cambio.placa || unidad.placa,
        prefijo: cambio.placa_prefijo,
        numero: cambio.placa_numero
      });
      const sedeNueva = String(cambio.sede || "").trim();
      const marcaNueva = String(cambio.marca || "").trim();
      const modeloNueva = String(cambio.modelo || "").trim();
      const anioTexto = String(cambio.anio || "").trim();
      const anioNuevo = anioTexto ? parseInt(anioTexto, 10) : null;

      if (!placaNueva) {
        await conn.rollback();
        return redirectUnidades(req, res, {
          error: `La placa de ${unidad.placa} no puede quedar vacía.`
        });
      }

      if (!sedeNueva || !sedesEditables.includes(sedeNueva)) {
        await conn.rollback();
        return redirectUnidades(req, res, {
          error: `Seleccione una sede permitida para ${unidad.placa}.`
        });
      }

      if (anioTexto && (Number.isNaN(anioNuevo) || anioNuevo < 1980 || anioNuevo > 2100)) {
        await conn.rollback();
        return redirectUnidades(req, res, {
          error: `El año de ${unidad.placa} no es válido.`
        });
      }

      let activa = cambio.activa === "0" ? 0 : 1;
      let varada = cambio.varada === "1" ? 1 : 0;
      let razon = String(cambio.razon_varada || "").trim();

      if (varada === 0) {
        razon = "";
      }

      if (activa === 0) {
        varada = 0;
        razon = "";
      }

      if (varada === 1) {
        activa = 1;
        if (!razon) {
          await conn.rollback();
          return redirectUnidades(req, res, {
            error: `Debe indicar la razón de varada para ${unidad.placa}.`
          });
        }
      }

      const cambioPlaca = String(unidad.placa || "") !== placaNueva;
      const cambioSede = String(unidad.sede || "") !== sedeNueva;
      const cambioEstado = Number(unidad.activa || 0) !== activa;
      const cambioVarada = Number(unidad.varada || 0) !== varada;
      const cambioRazon = String(unidad.razon_varada || "") !== razon;
      const cambioMarca = String(unidad.marca || "") !== marcaNueva;
      const cambioModelo = String(unidad.modelo || "") !== modeloNueva;
      const cambioAnio = (unidad.anio === null || unidad.anio === undefined ? null : Number(unidad.anio)) !== anioNuevo;

      if (!cambioPlaca && !cambioSede && !cambioEstado && !cambioVarada && !cambioRazon && !cambioMarca && !cambioModelo && !cambioAnio) {
        continue;
      }

      if (cambioPlaca) {
        const [[duplicada]] = await conn.query(
          "SELECT id, placa FROM unidades WHERE placa = ? AND id <> ? LIMIT 1",
          [placaNueva, unidad.id]
        );

        if (duplicada) {
          await conn.rollback();
          return redirectUnidades(req, res, {
            error: `No se pudo cambiar ${unidad.placa} a ${placaNueva}, porque esa placa ya existe.`
          });
        }
      }

      await conn.query(
        `UPDATE unidades
         SET placa = ?,
             sede = ?,
             marca = ?,
             modelo = ?,
             anio = ?,
             activa = ?,
             varada = ?,
             razon_varada = ?
         WHERE id = ?`,
        [placaNueva, sedeNueva, marcaNueva || null, modeloNueva || null, anioNuevo, activa, varada, razon || null, unidad.id]
      );

      if (cambioSede) {
        await conn.query(
          `INSERT INTO unidades_sede_historial
           (unidad_id, placa, sede_anterior, sede_nueva, usuario_id, usuario_nombre)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            unidad.id,
            placaNueva,
            unidad.sede || null,
            sedeNueva,
            req.session.user.id || null,
            req.session.user.usuario || req.session.user.nombre || req.session.user.rol || null
          ]
        );
      }

      actualizadas += 1;
    }

    await conn.commit();
    return redirectUnidades(req, res, {
      success: actualizadas
        ? `${actualizadas} unidad(es) actualizada(s) correctamente.`
        : "No había cambios nuevos para guardar."
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("ERROR guardando unidades masivo:", error);
    res.status(500).send("Error interno");
  } finally {
    conn.release();
  }
});

// ===================== ELIMINAR UNIDAD =====================
router.post("/:id/eliminar", async (req, res) => {
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

    const unidad = resultado.unidad;
    const usos = await obtenerUsosUnidad(id);
    const totalUsos = usos.reduce((total, uso) => total + uso.total, 0);

    if (totalUsos > 0) {
      const detalle = usos
        .slice(0, 4)
        .map(uso => `${uso.total} en ${uso.tableName}`)
        .join(", ");
      return redirectUnidades(req, res, {
        error: `No se puede eliminar ${unidad.placa} porque tiene historial registrado (${detalle}). Puede dejarla inactiva para que no se use.`
      });
    }

    await pool.query("DELETE FROM unidades WHERE id = ?", [id]);

    return redirectUnidades(req, res, {
      success: `Unidad ${unidad.placa} eliminada correctamente.`
    });
  } catch (error) {
    if (error.code === "ER_ROW_IS_REFERENCED_2" || error.code === "ER_ROW_IS_REFERENCED") {
      return redirectUnidades(req, res, {
        error: "No se pudo eliminar la unidad porque tiene registros relacionados. Déjela inactiva para conservar el historial."
      });
    }

    console.error("ERROR eliminando unidad:", error);
    res.status(500).send("Error interno");
  }
});

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

    return redirectUnidades(req, res, {
      success: "Estado de unidad actualizado."
    });
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
      return redirectUnidades(req, res, {
        error: "Seleccione una sede permitida."
      });
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

    return redirectUnidades(req, res, {
      success: `Sede actualizada para ${unidad.placa}.`
    });
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

    return redirectUnidades(req, res, {
      success: varada ? "Unidad marcada como varada." : "Unidad quitada de varada."
    });
  } catch (error) {
    console.error("ERROR actualizando unidad varada:", error);
    res.status(500).send("Error interno");
  }
});

module.exports = router;
