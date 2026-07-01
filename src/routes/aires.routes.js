const express = require("express");
const router = express.Router();
const pool = require("../db");
const { getSedesPermitidas } = require("../utils/sedes");

const ROLES_GESTION_AIRE = ["ADMIN", "TALLER", "MECANICO"];

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function puedeGestionarAires(user) {
  return ROLES_GESTION_AIRE.includes(user.rol);
}

async function ensureAiresTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aires_acondicionados (
      id INT AUTO_INCREMENT PRIMARY KEY,
      unidad_id INT NOT NULL,
      sede VARCHAR(100) NOT NULL,
      tipo_trabajo ENUM('REPARACION','CARGA','MANTENIMIENTO') NOT NULL,
      fecha DATE NOT NULL,
      realizado_por VARCHAR(150) NOT NULL,
      proximo_mantenimiento DATE NULL,
      observaciones TEXT NULL,
      creado_por INT NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_aires_unidad_fecha (unidad_id, fecha),
      INDEX idx_aires_sede_fecha (sede, fecha),
      INDEX idx_aires_proximo (proximo_mantenimiento)
    )
  `);
}

function normalizarTipoTrabajo(tipo) {
  const valor = String(tipo || "").trim().toUpperCase();
  return ["REPARACION", "CARGA", "MANTENIMIENTO"].includes(valor) ? valor : "";
}

function etiquetaTipoTrabajo(tipo) {
  const etiquetas = {
    REPARACION: "Reparación",
    CARGA: "Carga",
    MANTENIMIENTO: "Mantenimiento"
  };
  return etiquetas[tipo] || tipo || "-";
}

function fechaClave(valor) {
  if (!valor) return "";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}

router.use(requireAuth);

// ===================== LISTADO =====================
router.get("/", async (req, res) => {
  try {
    await ensureAiresTable();

    const sedesPermitidas = getSedesPermitidas(req);
    const placaFiltro = String(req.query.placa || "").trim();
    const tipoFiltro = normalizarTipoTrabajo(req.query.tipo);
    const hoy = new Date().toISOString().slice(0, 10);

    let sql = `
      SELECT
        aa.id,
        aa.unidad_id,
        aa.sede,
        aa.tipo_trabajo,
        DATE_FORMAT(aa.fecha, '%d/%m/%Y') AS fecha_formato,
        DATE_FORMAT(aa.proximo_mantenimiento, '%d/%m/%Y') AS proximo_formato,
        aa.proximo_mantenimiento,
        aa.realizado_por,
        aa.observaciones,
        u.placa
      FROM aires_acondicionados aa
      JOIN unidades u ON u.id = aa.unidad_id
      WHERE aa.sede IN (?)
    `;
    const params = [sedesPermitidas];

    if (placaFiltro) {
      sql += " AND u.placa LIKE ?";
      params.push(`%${placaFiltro.toUpperCase()}%`);
    }

    if (tipoFiltro) {
      sql += " AND aa.tipo_trabajo = ?";
      params.push(tipoFiltro);
    }

    sql += " ORDER BY aa.fecha DESC, aa.id DESC";

    const [registros] = await pool.query(sql, params);
    registros.forEach(registro => {
      registro.proximo_key = fechaClave(registro.proximo_mantenimiento);
      registro.proximo_vencido = Boolean(registro.proximo_key && registro.proximo_key < hoy);
    });
    const total = registros.length;
    const proximos = registros.filter(r => r.proximo_key && r.proximo_key >= hoy).length;
    const vencidos = registros.filter(r => r.proximo_vencido).length;

    res.render("aires_listado", {
      registros,
      filtros: { placa: placaFiltro, tipo: tipoFiltro },
      resumen: { total, proximos, vencidos },
      puedeEditar: puedeGestionarAires(req.session.user),
      etiquetaTipoTrabajo,
      hoy,
      user: req.session.user
    });
  } catch (error) {
    console.error("ERROR listado aires acondicionados:", error);
    res.status(500).send("Error interno");
  }
});

// ===================== FORM NUEVO =====================
router.get("/nuevo", async (req, res) => {
  try {
    await ensureAiresTable();

    if (!puedeGestionarAires(req.session.user)) {
      return res.redirect("/aires");
    }

    const sedesPermitidas = getSedesPermitidas(req);
    const [unidades] = await pool.query(
      "SELECT id, placa, sede FROM unidades WHERE sede IN (?) AND COALESCE(activa, 1) = 1 ORDER BY sede, placa",
      [sedesPermitidas]
    );

    const [mecanicos] = await pool.query(
      "SELECT nombre FROM mecanicos WHERE activo = 1 AND sede IN (?) ORDER BY nombre",
      [sedesPermitidas]
    );

    res.render("aires_nuevo", {
      unidades,
      mecanicos,
      hoy: new Date().toISOString().slice(0, 10),
      user: req.session.user
    });
  } catch (error) {
    console.error("ERROR form aires acondicionados:", error);
    res.status(500).send("Error interno");
  }
});

// ===================== GUARDAR =====================
router.post("/", async (req, res) => {
  try {
    await ensureAiresTable();

    if (!puedeGestionarAires(req.session.user)) {
      return res.status(403).send("No autorizado");
    }

    const {
      unidad_id,
      tipo_trabajo,
      fecha,
      realizado_por,
      proximo_mantenimiento,
      observaciones
    } = req.body;

    const tipoNormalizado = normalizarTipoTrabajo(tipo_trabajo);
    const responsable = String(realizado_por || "").trim();

    if (!unidad_id) return res.status(400).send("Debe seleccionar una unidad.");
    if (!tipoNormalizado) return res.status(400).send("Debe seleccionar el tipo de trabajo.");
    if (!fecha) return res.status(400).send("Debe colocar la fecha del trabajo.");
    if (!responsable) return res.status(400).send("Debe colocar quién hizo el trabajo.");

    const sedesPermitidas = getSedesPermitidas(req);
    const [[unidad]] = await pool.query(
      "SELECT id, sede FROM unidades WHERE id = ? LIMIT 1",
      [unidad_id]
    );

    if (!unidad || !sedesPermitidas.includes(unidad.sede)) {
      return res.status(403).send("No autorizado para esa unidad.");
    }

    await pool.query(
      `
      INSERT INTO aires_acondicionados
        (unidad_id, sede, tipo_trabajo, fecha, realizado_por, proximo_mantenimiento, observaciones, creado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        unidad_id,
        unidad.sede,
        tipoNormalizado,
        fecha,
        responsable,
        proximo_mantenimiento || null,
        observaciones || null,
        req.session.user.id
      ]
    );

    res.redirect("/aires");
  } catch (error) {
    console.error("ERROR guardar aire acondicionado:", error);
    res.status(500).send("Error interno");
  }
});

module.exports = router;
