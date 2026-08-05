const express = require("express");
const router = express.Router();
const pool = require("../db");
const { enviarConfirmacionCita } = require("../utils/emailService");
const { esUsuarioTodasSedes } = require("../utils/sedes");

// =====================================================
// MIDDLEWARES DE AUTENTICACIÓN Y ROLES
// =====================================================
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (roles.includes(req.session.user.rol)) return next();
    return res.status(403).send("Acceso denegado: no tienes permisos para esta sección.");
  };
}

// Aplicar a todas las rutas de este router
router.use(requireAuth);
router.use(allowRoles("ADMIN", "TRAMITES"));

// =====================================================
// OBTENER SEDE FILTRO (nunca retorna undefined)
// =====================================================
function obtenerSedeFiltro(req) {
  if (esUsuarioTodasSedes(req.session.user)) {
    if (
      req.session.sedeSeleccionada &&
      req.session.sedeSeleccionada !== "TODAS"
    ) {
      return req.session.sedeSeleccionada;
    }
    return null;
  }
  const sede = req.session.sedeSeleccionada || req.session.user.sede;
  return sede || null;
}

const fechaRegex = /^\d{4}-\d{2}-\d{2}$/;

function validarFechaOpcional(valor, campo) {
  if (valor && !fechaRegex.test(valor)) {
    return `Formato de ${campo} inválido (YYYY-MM-DD)`;
  }
  return null;
}

function usuarioPuedeVerSede(req, sede) {
  const sedeFiltro = obtenerSedeFiltro(req);
  return sedeFiltro === null || sede === sedeFiltro;
}

async function obtenerTramiteAutorizado(req, id) {
  const [[tramite]] = await pool.query(
    `SELECT mt.*, u.placa
     FROM minae_tramites mt
     JOIN unidades u ON u.id = mt.unidad_id
     WHERE mt.id = ?
     LIMIT 1`,
    [id]
  );

  if (!tramite) {
    return { error: 404, mensaje: "Trámite no encontrado" };
  }

  if (!usuarioPuedeVerSede(req, tramite.sede)) {
    return { error: 403, mensaje: "No tienes permiso para editar este trámite." };
  }

  return { tramite };
}

// =====================================================
// LISTADO MINAE
// =====================================================
router.get("/", async (req, res) => {
  try {
    const fecha = req.query.fecha || "";
    const negocio = req.query.negocio || "";
    const sede = req.query.sede || "";
    const estado = req.query.estado || "";
    const cita = req.query.cita || "";

    const sedeFiltro = obtenerSedeFiltro(req);

    let sql = `
      SELECT 
        mt.*,
        u.placa
      FROM minae_tramites mt
      JOIN unidades u ON u.id = mt.unidad_id
      WHERE 1=1
    `;
    const params = [];

    if (sedeFiltro !== null) {
      sql += ` AND mt.sede = ?`;
      params.push(sedeFiltro);
    }

    if (sede && esUsuarioTodasSedes(req.session.user) && sedeFiltro === null) {
      sql += ` AND mt.sede = ?`;
      params.push(sede);
    }

    if (negocio) {
      sql += ` AND mt.negocio = ?`;
      params.push(negocio);
    }

    if (estado) {
      sql += ` AND mt.estado = ?`;
      params.push(estado);
    }

    if (cita !== "") {
      sql += ` AND mt.tiene_cita = ?`;
      params.push(cita === "1" ? 1 : 0);
    }

    if (fecha) {
      sql += ` AND DATE_FORMAT(mt.vencimiento, '%Y-%m') = ?`;
      params.push(fecha);
    }

    sql += ` ORDER BY mt.vencimiento ASC, u.placa ASC`;

    const [tramites] = await pool.query(sql, params);

    res.render("minae", {
      tramites,
      user: req.session.user,
      sedeSeleccionada: sedeFiltro || "TODAS",
      fechaSeleccionada: fecha,
      negocioSeleccionado: negocio,
      estadoSeleccionado: estado,
      sedeManualSeleccionada: sede,
      citaSeleccionada: cita,
    });
  } catch (error) {
    console.error("❌ Error MINAE:", error);
    res.status(500).send("Error cargando MINAE");
  }
});

// =====================================================
// FORM NUEVO TRÁMITE
// =====================================================
router.get("/nuevo", async (req, res) => {
  try {
    const sedeFiltro = obtenerSedeFiltro(req);
    let sql = `SELECT id, placa, sede, negocio FROM unidades WHERE activa = 1`;
    const params = [];
    if (sedeFiltro !== null) {
      sql += ` AND sede = ?`;
      params.push(sedeFiltro);
    }
    sql += ` ORDER BY sede, placa`;
    const [unidades] = await pool.query(sql, params);
    res.render("minae_nuevo", { unidades, user: req.session.user });
  } catch (error) {
    console.error("❌ Error nuevo MINAE:", error);
    res.status(500).send("Error cargando formulario MINAE");
  }
});

// =====================================================
// GUARDAR NUEVO TRÁMITE
// =====================================================
router.post("/nuevo", async (req, res) => {
  try {
    const {
      unidad_id,
      tipo,
      cr,
      estado,
      fecha_envio,
      vencimiento,
      presentacion,
      subsane,
      ot,
      empresa,
      lugar,
      hora,
      observacion,
      tiene_cita,
      fecha_cita,
      hora_cita,
      lugar_cita,
    } = req.body;

    if (!unidad_id || isNaN(parseInt(unidad_id))) {
      return res.status(400).send("ID de unidad inválido");
    }
    if (!tipo) {
      return res.status(400).send("El campo 'tipo' es obligatorio");
    }

    const errorFecha =
      validarFechaOpcional(fecha_envio, "fecha_envio") ||
      validarFechaOpcional(vencimiento, "vencimiento") ||
      validarFechaOpcional(presentacion, "presentacion") ||
      validarFechaOpcional(subsane, "subsane") ||
      validarFechaOpcional(fecha_cita, "fecha_cita");
    if (errorFecha) {
      return res.status(400).send(errorFecha);
    }

    const [[unidad]] = await pool.query(
      `SELECT id, sede, negocio FROM unidades WHERE id = ? LIMIT 1`,
      [unidad_id]
    );
    if (!unidad) return res.status(404).send("Unidad no encontrada");

    const tieneCitaValue = tiene_cita === "on" || tiene_cita === "true" || tiene_cita === true ? 1 : 0;

    await pool.query(
      `INSERT INTO minae_tramites (
        unidad_id, sede, negocio,
        tipo, cr, estado,
        fecha_envio, vencimiento, presentacion, subsane,
        ot, empresa, lugar, hora,
        observacion,
        tiene_cita, fecha_cita, hora_cita, lugar_cita,
        creado_por
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        unidad.id, unidad.sede, unidad.negocio,
        tipo, cr || null, estado || "PENDIENTE",
        fecha_envio || null, vencimiento || null, presentacion || null, subsane || null,
        ot || null, empresa || null, lugar || null, hora || null,
        observacion || null,
        tieneCitaValue, fecha_cita || null, hora_cita || null, lugar_cita || null,
        req.session.user.id,
      ]
    );
    res.redirect("/minae");
  } catch (error) {
    console.error("❌ Error guardando MINAE:", error);
    res.status(500).send("Error guardando MINAE");
  }
});

// =====================================================
// FORMULARIO PARA ACTUALIZAR DATOS DEL TRÁMITE
// =====================================================
router.get("/:id/editar", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).send("ID de trámite inválido");
    }

    const resultado = await obtenerTramiteAutorizado(req, id);
    if (resultado.error) {
      return res.status(resultado.error).send(resultado.mensaje);
    }

    res.render("minae_editar", {
      tramite: resultado.tramite,
      user: req.session.user,
    });
  } catch (error) {
    console.error("❌ Error cargando edición MINAE:", error);
    res.status(500).send("Error cargando edición MINAE");
  }
});

// =====================================================
// GUARDAR DATOS ACTUALIZADOS DEL TRÁMITE
// =====================================================
router.post("/:id/editar", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).send("ID de trámite inválido");
    }

    const resultado = await obtenerTramiteAutorizado(req, id);
    if (resultado.error) {
      return res.status(resultado.error).send(resultado.mensaje);
    }

    const {
      tipo,
      cr,
      estado,
      fecha_envio,
      vencimiento,
      presentacion,
      subsane,
      ot,
      empresa,
      lugar,
      hora,
      observacion,
    } = req.body;

    if (!tipo) {
      return res.status(400).send("El campo 'tipo' es obligatorio");
    }

    const errorFecha =
      validarFechaOpcional(fecha_envio, "fecha_envio") ||
      validarFechaOpcional(vencimiento, "vencimiento") ||
      validarFechaOpcional(presentacion, "presentacion") ||
      validarFechaOpcional(subsane, "subsane");
    if (errorFecha) {
      return res.status(400).send(errorFecha);
    }

    await pool.query(
      `UPDATE minae_tramites
       SET tipo = ?,
           cr = ?,
           estado = ?,
           fecha_envio = ?,
           vencimiento = ?,
           presentacion = ?,
           subsane = ?,
           ot = ?,
           empresa = ?,
           lugar = ?,
           hora = ?,
           observacion = ?
       WHERE id = ?`,
      [
        tipo,
        cr || null,
        estado || "PENDIENTE",
        fecha_envio || null,
        vencimiento || null,
        presentacion || null,
        subsane || null,
        ot || null,
        empresa || null,
        lugar || null,
        hora || null,
        observacion || null,
        id,
      ]
    );

    res.redirect("/minae");
  } catch (error) {
    console.error("❌ Error actualizando MINAE:", error);
    res.status(500).send("Error actualizando MINAE");
  }
});

// =====================================================
// FORMULARIO PARA EDITAR CITA DE UN TRÁMITE
// =====================================================
router.get("/:id/cita", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM minae_tramites WHERE id = ?", [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).send("Trámite no encontrado");
    }
    res.render("minae_cita", { tramite: rows[0], user: req.session.user });
  } catch (error) {
    console.error("❌ Error cargando formulario de cita:", error);
    res.status(500).send("Error interno");
  }
});

// =====================================================
// GUARDAR CITA DEL TRÁMITE (con correo adicional)
// =====================================================
router.post("/:id/cita", async (req, res) => {
  try {
    const { fecha_cita, hora_cita, lugar_cita, email_notificacion } = req.body;
    const id = req.params.id;

    // Actualizar la cita y reiniciar flags de recordatorios
    await pool.query(
      `UPDATE minae_tramites 
       SET tiene_cita = 1, 
           fecha_cita = ?, 
           hora_cita = ?, 
           lugar_cita = ?,
           email_notificacion = ?,
           recordatorio_15d_enviado = 0,
           recordatorio_2d_enviado = 0
       WHERE id = ?`,
      [fecha_cita || null, hora_cita || null, lugar_cita || null, email_notificacion || null, id]
    );

    // Obtener datos completos del trámite (incluyendo placa)
    const [[tramite]] = await pool.query(
      `SELECT mt.*, u.placa 
       FROM minae_tramites mt 
       JOIN unidades u ON u.id = mt.unidad_id 
       WHERE mt.id = ?`,
      [id]
    );

    // Enviar confirmación a dmartinez.s@tomza.com + email adicional
    await enviarConfirmacionCita(tramite, fecha_cita, hora_cita, lugar_cita, email_notificacion);

    res.redirect("/minae");
  } catch (error) {
    console.error("❌ Error guardando cita:", error);
    res.status(500).send("Error guardando la cita");
  }
});

module.exports = router;
