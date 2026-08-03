const express = require("express");
const fs = require("fs");
const path = require("path");
const ejs = require("ejs");
const pdf = require("html-pdf");
const pool = require("../db");
const { TODAS_SEDES } = require("../utils/sedes");

const router = express.Router();

const ESTADOS = ["SOLICITADA", "COTIZADA", "COMPRADA", "RECIBIDA"];
const PDF_TMP_DIR = path.join(process.cwd(), "tmp");
const ROLES_COTIZAR = ["ADMIN", "PROVEEDURIA_TALLER", "PROVEEDURIA"];
const ROLES_COMPRAR = ["ADMIN", "PROVEEDURIA_TALLER", "PROVEEDURIA"];
const ROLES_RECIBIR = ["ADMIN", "TALLER", "MECANICO"];
const ROLES_VER_COTIZACION = ["ADMIN", "TALLER", "PROVEEDURIA_TALLER", "PROVEEDURIA", "SUPERVISOR", "SUPERVISOR_PESADO", "MECANICO"];
const ROLES_SOLICITAR = ["ADMIN", "SUPERVISOR", "SUPERVISOR_PESADO", "TALLER", "MECANICO"];

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (roles.includes(req.session.user.rol)) return next();
    return res.status(403).send("No autorizado");
  };
}

function puedeGestionar(user) {
  return [...new Set([...ROLES_COTIZAR, ...ROLES_COMPRAR, ...ROLES_RECIBIR])].includes(user.rol);
}

function permisosLlantas(user) {
  return {
    puedeCotizar: ROLES_COTIZAR.includes(user.rol),
    puedeComprar: ROLES_COMPRAR.includes(user.rol),
    puedeRecibir: ROLES_RECIBIR.includes(user.rol)
  };
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS solicitudes_llantas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      unidad_id INT NULL,
      placa VARCHAR(50) NOT NULL,
      sede VARCHAR(100) NOT NULL,
      medida VARCHAR(100) NOT NULL,
      cantidad INT NOT NULL DEFAULT 1,
      posicion VARCHAR(100) NULL,
      marca_sugerida VARCHAR(100) NULL,
      motivo TEXT NULL,
      observaciones TEXT NULL,
      estado VARCHAR(30) NOT NULL DEFAULT 'SOLICITADA',
      proveedor VARCHAR(150) NULL,
      precio_unitario DECIMAL(12,2) NULL,
      monto_total DECIMAL(12,2) NULL,
      cotizacion_notas TEXT NULL,
      solicitado_por INT NULL,
      cotizado_por INT NULL,
      comprado_por INT NULL,
      recibido_por INT NULL,
      fecha_solicitud DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_cotizada DATETIME NULL,
      fecha_comprada DATETIME NULL,
      fecha_recibida DATETIME NULL,
      INDEX idx_sede_estado (sede, estado),
      INDEX idx_unidad (unidad_id),
      INDEX idx_fecha (fecha_solicitud)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS solicitudes_llantas_historial (
      id INT AUTO_INCREMENT PRIMARY KEY,
      solicitud_id INT NOT NULL,
      estado_anterior VARCHAR(30) NULL,
      estado_nuevo VARCHAR(30) NOT NULL,
      comentario TEXT NULL,
      usuario_id INT NULL,
      fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_solicitud (solicitud_id)
    )
  `);
}

async function obtenerSedesPermitidas(req) {
  const user = req.session.user;

  if (user.rol === "ADMIN") {
    if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
      return [req.session.sedeSeleccionada];
    }
    return TODAS_SEDES;
  }

  const [extras] = await pool.query(
    "SELECT sede FROM usuarios_sedes WHERE usuario_id = ?",
    [user.id]
  );

  const sedes = [
    ...new Set([
      user.sede,
      ...extras.map(e => e.sede)
    ])
  ].filter(Boolean);

  if (req.session.sedeSeleccionada && sedes.includes(req.session.sedeSeleccionada)) {
    return [req.session.sedeSeleccionada];
  }

  return sedes;
}

async function registrarHistorial(solicitudId, estadoAnterior, estadoNuevo, usuarioId, comentario = null) {
  await pool.query(
    `INSERT INTO solicitudes_llantas_historial
     (solicitud_id, estado_anterior, estado_nuevo, usuario_id, comentario)
     VALUES (?, ?, ?, ?, ?)`,
    [solicitudId, estadoAnterior, estadoNuevo, usuarioId, comentario]
  );
}

async function cargarSolicitudAutorizada(req, id) {
  const [[solicitud]] = await pool.query("SELECT * FROM solicitudes_llantas WHERE id = ?", [id]);
  if (!solicitud) return { error: "not_found" };

  const sedesPermitidas = await obtenerSedesPermitidas(req);
  if (!sedesPermitidas.includes(solicitud.sede)) return { error: "forbidden" };

  return { solicitud };
}

function redirectConFiltros(req) {
  const params = new URLSearchParams();
  ["sede", "estado", "placa"].forEach(key => {
    if (req.body[key]) params.set(key, req.body[key]);
  });
  const query = params.toString();
  return "/llantas" + (query ? `?${query}` : "");
}

function normalizarArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizarIds(value) {
  return normalizarArray(value)
    .map(id => parseInt(id, 10))
    .filter(Number.isInteger);
}

function construirFiltrosSolicitudes(sedesPermitidas, filtros = {}) {
  const condiciones = [];
  const params = [];
  const sedesSeleccionadas = Array.isArray(filtros.sedes)
    ? filtros.sedes.filter(sede => sedesPermitidas.includes(sede))
    : [];

  if (sedesPermitidas.length) {
    condiciones.push("s.sede IN (?)");
    params.push(sedesPermitidas);
  }
  if (sedesSeleccionadas.length) {
    condiciones.push("s.sede IN (?)");
    params.push(sedesSeleccionadas);
  } else if (filtros.sede && sedesPermitidas.includes(filtros.sede)) {
    condiciones.push("s.sede = ?");
    params.push(filtros.sede);
  }
  if (filtros.estado && ESTADOS.includes(filtros.estado)) {
    condiciones.push("s.estado = ?");
    params.push(filtros.estado);
  }
  if (filtros.placa && filtros.placa.trim()) {
    condiciones.push("s.placa LIKE ?");
    params.push(`%${filtros.placa.trim().toUpperCase()}%`);
  }
  if (filtros.semana && /^\d{4}-\d{2}-\d{2}$/.test(filtros.semana)) {
    condiciones.push("s.fecha_solicitud >= ? AND s.fecha_solicitud < DATE_ADD(?, INTERVAL 7 DAY)");
    params.push(filtros.semana, filtros.semana);
  }

  return {
    where: condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "",
    params
  };
}

function nombreCedi(sede) {
  if (sede === "Perez Zeledon") return "PZ";
  return sede || "";
}

function destinoEntrega(sede) {
  return ["Alajuela", "San Carlos", "Rio Claro"].includes(sede) ? "ALAJUELA" : "CARTAGO";
}

function descripcionLlanta(solicitud) {
  return [
    solicitud.medida,
    solicitud.marca_sugerida,
    solicitud.posicion
  ].filter(Boolean).join(", ");
}

function prepararCotizacion(solicitudes) {
  const ordenSedes = [
    "Cartago",
    "Perez Zeledon",
    "Guapiles",
    "La Cruz",
    "Transportadora",
    "Granel",
    "Tecnicos",
    "Taller",
    "Nicoya",
    "Alajuela",
    "San Carlos",
    "Rio Claro"
  ];
  const ordenEntrega = { CARTAGO: 1, ALAJUELA: 2 };

  const filas = solicitudes
    .map(solicitud => ({
      ...solicitud,
      cedi: nombreCedi(solicitud.sede),
      entregar: destinoEntrega(solicitud.sede),
      descripcion: descripcionLlanta(solicitud)
    }))
    .sort((a, b) => {
      const entregaA = ordenEntrega[a.entregar] || 99;
      const entregaB = ordenEntrega[b.entregar] || 99;
      if (entregaA !== entregaB) return entregaA - entregaB;

      const sedeA = ordenSedes.indexOf(a.sede);
      const sedeB = ordenSedes.indexOf(b.sede);
      if (sedeA !== sedeB) return (sedeA === -1 ? 99 : sedeA) - (sedeB === -1 ? 99 : sedeB);

      return String(a.placa).localeCompare(String(b.placa));
    });

  const grupos = [];
  filas.forEach(fila => {
    let grupo = grupos[grupos.length - 1];
    if (!grupo || grupo.entregar !== fila.entregar) {
      grupo = { entregar: fila.entregar, filas: [] };
      grupos.push(grupo);
    }
    grupo.filas.push(fila);
  });

  return {
    grupos,
    totalUnidades: filas.reduce((total, fila) => total + (parseInt(fila.cantidad, 10) || 0), 0)
  };
}

function opcionesPdf() {
  fs.mkdirSync(PDF_TMP_DIR, { recursive: true });
  return {
    format: "Letter",
    orientation: "portrait",
    border: "8mm",
    directory: PDF_TMP_DIR
  };
}

router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    await ensureTables();

    const sedesPermitidas = await obtenerSedesPermitidas(req);
    const { sede, estado, placa } = req.query;
    const { where, params } = construirFiltrosSolicitudes(sedesPermitidas, { sede, estado, placa });
    const [solicitudes] = await pool.query(`
      SELECT 
        s.*,
        us.usuario AS solicitado_por_usuario,
        uc.usuario AS cotizado_por_usuario,
        uco.usuario AS comprado_por_usuario,
        ur.usuario AS recibido_por_usuario
      FROM solicitudes_llantas s
      LEFT JOIN usuarios us ON us.id = s.solicitado_por
      LEFT JOIN usuarios uc ON uc.id = s.cotizado_por
      LEFT JOIN usuarios uco ON uco.id = s.comprado_por
      LEFT JOIN usuarios ur ON ur.id = s.recibido_por
      ${where}
      ORDER BY FIELD(s.estado, 'SOLICITADA', 'COTIZADA', 'COMPRADA', 'RECIBIDA'), s.fecha_solicitud DESC
    `, params);

    const [unidades] = await pool.query(
      `SELECT id, placa, sede FROM unidades WHERE sede IN (?) ORDER BY sede, placa`,
      [sedesPermitidas.length ? sedesPermitidas : ["__SIN_SEDE__"]]
    );

    res.render("llantas/index", {
      user: req.session.user,
      solicitudes,
      unidades,
      sedesPermitidas,
      estados: ESTADOS,
      filtros: { sede, estado, placa },
      puedeGestionar: puedeGestionar(req.session.user),
      ...permisosLlantas(req.session.user)
    });
  } catch (error) {
    console.error("Error cargando solicitudes de llantas:", error);
    res.status(500).send("Error cargando solicitudes de llantas");
  }
});

router.get("/cotizacion.pdf", allowRoles(...ROLES_VER_COTIZACION), async (req, res) => {
  try {
    await ensureTables();
    const sedesPermitidas = await obtenerSedesPermitidas(req);
    const { sede, estado, placa, semana } = req.query;
    const sedes = Array.isArray(req.query.sedes)
      ? req.query.sedes
      : req.query.sedes
        ? [req.query.sedes]
        : [];
    const { where, params } = construirFiltrosSolicitudes(sedesPermitidas, { sede, sedes, estado, placa, semana });

    const [solicitudes] = await pool.query(`
      SELECT s.*, u.usuario AS solicitado_por_usuario
      FROM solicitudes_llantas s
      LEFT JOIN usuarios u ON u.id = s.solicitado_por
      ${where}
      ORDER BY s.sede, s.placa, s.fecha_solicitud DESC
    `, params);

    const templatePath = path.join(__dirname, "../views/llantas/cotizacion_pdf.ejs");
    const html = await ejs.renderFile(templatePath, {
      ...prepararCotizacion(solicitudes),
      logoPath: path.join(__dirname, "../../public/img/logo_tomza.jpg").replace(/\\/g, "/"),
      fechaGeneracion: new Date().toLocaleDateString("es-CR"),
      titulo: "Cotización de llantas"
    });

    pdf.create(html, opcionesPdf()).toBuffer((err, buffer) => {
      if (err) {
        console.error("Error generando cotización de llantas:", err);
        return res.status(500).send("Error generando PDF");
      }
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=cotizacion_llantas.pdf");
      res.send(buffer);
    });
  } catch (error) {
    console.error("Error generando PDF de cotización:", error);
    res.status(500).send("Error generando PDF");
  }
});

router.post("/cotizar-multiple", allowRoles(...ROLES_COTIZAR), async (req, res) => {
  try {
    await ensureTables();
    const ids = normalizarIds(req.body.solicitud_ids);
    if (!ids.length) return res.redirect(redirectConFiltros(req));

    for (const id of ids) {
      const { solicitud, error } = await cargarSolicitudAutorizada(req, id);
      if (error || solicitud.estado !== "SOLICITADA") continue;

      await pool.query(
        `UPDATE solicitudes_llantas
         SET estado = 'COTIZADA',
             cotizado_por = ?,
             fecha_cotizada = NOW()
         WHERE id = ?`,
        [req.session.user.id, id]
      );

      await registrarHistorial(id, solicitud.estado, "COTIZADA", req.session.user.id, "Cotización registrada en lote semanal");
    }

    res.redirect(redirectConFiltros(req));
  } catch (error) {
    console.error("Error cotizando solicitudes en lote:", error);
    res.status(500).send("Error cotizando solicitudes");
  }
});

router.post("/comprar-multiple", allowRoles(...ROLES_COMPRAR), async (req, res) => {
  try {
    await ensureTables();
    const ids = normalizarIds(req.body.solicitud_ids);
    if (!ids.length) return res.redirect(redirectConFiltros(req));

    for (const id of ids) {
      const { solicitud, error } = await cargarSolicitudAutorizada(req, id);
      if (error || !["SOLICITADA", "COTIZADA"].includes(solicitud.estado)) continue;

      await pool.query(
        `UPDATE solicitudes_llantas
         SET estado = 'COMPRADA', comprado_por = ?, fecha_comprada = NOW()
         WHERE id = ?`,
        [req.session.user.id, id]
      );

      await registrarHistorial(id, solicitud.estado, "COMPRADA", req.session.user.id, "Marcada como comprada en lote semanal");
    }

    res.redirect(redirectConFiltros(req));
  } catch (error) {
    console.error("Error comprando solicitudes en lote:", error);
    res.status(500).send("Error marcando compras");
  }
});

router.post("/solicitar", allowRoles(...ROLES_SOLICITAR), async (req, res) => {
  try {
    await ensureTables();
    const { unidad_id, medida, cantidad, posicion, marca_sugerida, motivo, observaciones } = req.body;
    if (!unidad_id || !medida || !cantidad) return res.status(400).send("Datos incompletos");

    const sedesPermitidas = await obtenerSedesPermitidas(req);
    const [[unidad]] = await pool.query("SELECT id, placa, sede FROM unidades WHERE id = ?", [unidad_id]);
    if (!unidad) return res.status(404).send("Unidad no encontrada");
    if (!sedesPermitidas.includes(unidad.sede)) return res.status(403).send("No autorizado para esta sede");

    const [result] = await pool.query(
      `INSERT INTO solicitudes_llantas
       (unidad_id, placa, sede, medida, cantidad, posicion, marca_sugerida, motivo, observaciones, solicitado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        unidad.id,
        unidad.placa,
        unidad.sede,
        medida,
        parseInt(cantidad, 10) || 1,
        posicion || null,
        marca_sugerida || null,
        motivo || null,
        observaciones || null,
        req.session.user.id
      ]
    );

    await registrarHistorial(result.insertId, null, "SOLICITADA", req.session.user.id, "Solicitud creada");
    res.redirect("/llantas");
  } catch (error) {
    console.error("Error creando solicitud de llanta:", error);
    res.status(500).send("Error creando solicitud");
  }
});

router.post("/:id/cotizar", allowRoles(...ROLES_COTIZAR), async (req, res) => {
  try {
    await ensureTables();
    const id = req.params.id;
    const { solicitud, error } = await cargarSolicitudAutorizada(req, id);
    if (error === "not_found") return res.status(404).send("Solicitud no encontrada");
    if (error === "forbidden") return res.status(403).send("No autorizado para esta sede");

    await pool.query(
      `UPDATE solicitudes_llantas
       SET estado = 'COTIZADA',
           cotizado_por = ?,
           fecha_cotizada = NOW()
       WHERE id = ?`,
      [req.session.user.id, id]
    );

    await registrarHistorial(id, solicitud.estado, "COTIZADA", req.session.user.id, "Cotización registrada");
    res.redirect(redirectConFiltros(req));
  } catch (error) {
    console.error("Error cotizando solicitud:", error);
    res.status(500).send("Error cotizando solicitud");
  }
});

router.post("/:id/comprar", allowRoles(...ROLES_COMPRAR), async (req, res) => {
  try {
    await ensureTables();
    const id = req.params.id;
    const { solicitud, error } = await cargarSolicitudAutorizada(req, id);
    if (error === "not_found") return res.status(404).send("Solicitud no encontrada");
    if (error === "forbidden") return res.status(403).send("No autorizado para esta sede");

    await pool.query(
      `UPDATE solicitudes_llantas
       SET estado = 'COMPRADA', comprado_por = ?, fecha_comprada = NOW()
       WHERE id = ?`,
      [req.session.user.id, id]
    );

    await registrarHistorial(id, solicitud.estado, "COMPRADA", req.session.user.id, "Marcada como comprada");
    res.redirect(redirectConFiltros(req));
  } catch (error) {
    console.error("Error marcando compra:", error);
    res.status(500).send("Error marcando compra");
  }
});

router.post("/:id/recibir", allowRoles(...ROLES_RECIBIR), async (req, res) => {
  try {
    await ensureTables();
    const id = req.params.id;
    const { solicitud, error } = await cargarSolicitudAutorizada(req, id);
    if (error === "not_found") return res.status(404).send("Solicitud no encontrada");
    if (error === "forbidden") return res.status(403).send("No autorizado para esta sede");

    await pool.query(
      `UPDATE solicitudes_llantas
       SET estado = 'RECIBIDA', recibido_por = ?, fecha_recibida = NOW()
       WHERE id = ?`,
      [req.session.user.id, id]
    );

    await registrarHistorial(id, solicitud.estado, "RECIBIDA", req.session.user.id, "Llanta recibida en sede");
    res.redirect(redirectConFiltros(req));
  } catch (error) {
    console.error("Error marcando recepción:", error);
    res.status(500).send("Error marcando recepción");
  }
});

router.get("/:id/cotizacion.pdf", allowRoles(...ROLES_VER_COTIZACION), async (req, res) => {
  try {
    await ensureTables();
    const [[solicitud]] = await pool.query(`
      SELECT s.*, u.usuario AS solicitado_por_usuario
      FROM solicitudes_llantas s
      LEFT JOIN usuarios u ON u.id = s.solicitado_por
      WHERE s.id = ?
    `, [req.params.id]);

    if (!solicitud) return res.status(404).send("Solicitud no encontrada");
    const sedesPermitidas = await obtenerSedesPermitidas(req);
    if (!sedesPermitidas.includes(solicitud.sede)) return res.status(403).send("No autorizado para esta sede");

    const templatePath = path.join(__dirname, "../views/llantas/cotizacion_pdf.ejs");
    const html = await ejs.renderFile(templatePath, {
      ...prepararCotizacion([solicitud]),
      logoPath: path.join(__dirname, "../../public/img/logo_tomza.jpg").replace(/\\/g, "/"),
      fechaGeneracion: new Date().toLocaleDateString("es-CR"),
      titulo: `Cotización de llanta ${solicitud.placa}`
    });

    pdf.create(html, opcionesPdf()).toBuffer((err, buffer) => {
      if (err) {
        console.error("Error generando cotización de llanta:", err);
        return res.status(500).send("Error generando PDF");
      }
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=cotizacion_llanta_${solicitud.placa}_${solicitud.id}.pdf`);
      res.send(buffer);
    });
  } catch (error) {
    console.error("Error generando PDF de cotización:", error);
    res.status(500).send("Error generando PDF");
  }
});

module.exports = router;
