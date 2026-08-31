const express = require("express");
const path = require("path");
const PdfPrinter = require("pdfmake");
const pool = require("../db");
const {
  agregarTallerParaMecanico,
  esSedeGranel,
  esSedeTransporte,
  esUsuarioPesados,
  esUsuarioTodasSedes,
  expandirSedesEquivalentes,
  obtenerSedesTransporte,
  TODAS_SEDES,
  sedeGranelDesdeUsuario
} = require("../utils/sedes");
const { agregarFiltroPlacaSql } = require("../utils/placas");

const router = express.Router();

const ESTADOS = ["SOLICITADA", "COTIZADA", "COMPRADA", "RECIBIDA"];
const ROLES_COTIZAR = ["ADMIN", "PROVEEDURIA_TALLER", "PROVEEDURIA"];
const ROLES_COMPRAR = ["ADMIN", "PROVEEDURIA_TALLER", "PROVEEDURIA"];
const ROLES_RECIBIR = ["ADMIN", "TALLER", "MECANICO"];
const ROLES_VER_COTIZACION = ["ADMIN", "TALLER", "PROVEEDURIA_TALLER", "PROVEEDURIA", "SUPERVISOR", "SUPERVISOR_PESADO", "MECANICO"];
const ROLES_SOLICITAR = ["ADMIN", "SUPERVISOR", "SUPERVISOR_PESADO", "TALLER", "MECANICO"];
const ROLES_EDITAR = ["ADMIN", "TALLER", "MECANICO", "SUPERVISOR", "SUPERVISOR_PESADO", "PROVEEDURIA_TALLER", "PROVEEDURIA"];
const PDF_FONTS = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique"
  }
};
const printer = new PdfPrinter(PDF_FONTS);

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

function puedeEditar(user) {
  return ROLES_EDITAR.includes(user.rol);
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
  const sedeGranelUsuario = sedeGranelDesdeUsuario(user);

  if (esUsuarioTodasSedes(user)) {
    if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
      return expandirSedesEquivalentes(req.session.sedeSeleccionada);
    }
    return expandirSedesEquivalentes(TODAS_SEDES);
  }

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

  if (esUsuarioPesados(user)) {
    if (
      req.session.sedeSeleccionada &&
      req.session.sedeSeleccionada !== "TODAS" &&
      esSedeTransporte(req.session.sedeSeleccionada)
    ) {
      return expandirSedesEquivalentes(req.session.sedeSeleccionada);
    }
    return expandirSedesEquivalentes(await obtenerSedesTransporte(pool));
  }

  const [extras] = await pool.query(
    "SELECT sede FROM usuarios_sedes WHERE usuario_id = ?",
    [user.id]
  );

  const sedes = agregarTallerParaMecanico(user, [user.sede, ...extras.map(e => e.sede)]);

  if (req.session.sedeSeleccionada && sedes.includes(req.session.sedeSeleccionada)) {
    return expandirSedesEquivalentes(req.session.sedeSeleccionada);
  }

  return expandirSedesEquivalentes(sedes);
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
  const ids = normalizarIds(filtros.ids);
  const sedesSeleccionadas = Array.isArray(filtros.sedes)
    ? expandirSedesEquivalentes(filtros.sedes.filter(sede => sedesPermitidas.includes(sede)))
    : [];

  if (ids.length) {
    condiciones.push("s.id IN (?)");
    params.push(ids);
  }
  if (sedesPermitidas.length) {
    condiciones.push("s.sede IN (?)");
    params.push(sedesPermitidas);
  }
  if (sedesSeleccionadas.length) {
    condiciones.push("s.sede IN (?)");
    params.push(sedesSeleccionadas);
  } else if (filtros.sede && sedesPermitidas.includes(filtros.sede)) {
    condiciones.push("s.sede IN (?)");
    params.push(expandirSedesEquivalentes(filtros.sede));
  }
  if (filtros.estado && ESTADOS.includes(filtros.estado)) {
    condiciones.push("s.estado = ?");
    params.push(filtros.estado);
  }
  if (filtros.placa && filtros.placa.trim()) {
    agregarFiltroPlacaSql(condiciones, params, "s.placa", filtros.placa);
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
  const sedeNormalizada = String(sede || "").trim().toLowerCase().replace(/\s+/g, "_");
  return ["alajuela", "san_carlos", "orotina", "granel_alajuela"].includes(sedeNormalizada) ? "ALAJUELA" : "CARTAGO";
}

function descripcionLlanta(solicitud) {
  return [
    solicitud.medida,
    solicitud.marca_sugerida,
    solicitud.posicion
  ].filter(Boolean).join(", ");
}

function negocioLlanta(solicitud) {
  const sede = String(solicitud.sede || "").trim();
  const placa = String(solicitud.placa || "").trim().toUpperCase();

  if (esSedeGranel(sede)) return "Granel";
  if (sede.toUpperCase() === "TRANSPORTADORA" || /^S\d{5,6}$/.test(placa)) return "Transportadora";
  if (["TALLER", "TECNICOS"].includes(sede.toUpperCase())) return "Otros";
  return "Cilindros";
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
    "Orotina",
    "Alajuela",
    "San Carlos",
    "Rio Claro"
  ];
  const ordenEntrega = { CARTAGO: 1, ALAJUELA: 2 };

  const filas = solicitudes
    .map(solicitud => ({
      ...solicitud,
      negocio: negocioLlanta(solicitud),
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

function pdfStreamToBuffer(pdfDoc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    pdfDoc.on("data", chunk => chunks.push(chunk));
    pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
    pdfDoc.on("error", reject);
    pdfDoc.end();
  });
}

function crearCeldasEncabezado(texto) {
  return {
    text: texto,
    bold: true,
    color: "#ffffff",
    alignment: "center",
    fillColor: "#244573",
    margin: [4, 3, 4, 3]
  };
}

function contarFilasCedi(filas, indice) {
  const cedi = filas[indice].cedi;
  let total = 0;
  for (let i = indice; i < filas.length && filas[i].cedi === cedi; i += 1) {
    total += 1;
  }
  return total;
}

function crearTablaCotizacion(cotizacion) {
  const body = [[
    crearCeldasEncabezado("CEDI"),
    crearCeldasEncabezado("Entregar"),
    crearCeldasEncabezado("Placa"),
    crearCeldasEncabezado("Cantidad"),
    crearCeldasEncabezado("Descripción")
  ]];

  if (!cotizacion.grupos.length) {
    body.push([
      { text: "No hay solicitudes para descargar.", colSpan: 5, alignment: "center", margin: [0, 18, 0, 18] },
      {},
      {},
      {},
      {}
    ]);
  }

  cotizacion.grupos.forEach(grupo => {
    grupo.filas.forEach((fila, indice) => {
      const primeraFilaEntrega = indice === 0;
      const primeraFilaCedi = indice === 0 || grupo.filas[indice - 1].cedi !== fila.cedi;
      const descripcion = fila.descripcion || fila.motivo || "Llanta solicitada";
      const entregar = grupo.entregar || fila.entregar || "";

      const row = [];
      if (primeraFilaCedi) {
        row.push({
          text: fila.cedi || "",
          rowSpan: contarFilasCedi(grupo.filas, indice),
          alignment: "center",
          margin: [0, 8, 0, 0]
        });
      } else {
        row.push({});
      }

      if (primeraFilaEntrega) {
        row.push({
          text: entregar,
          rowSpan: grupo.filas.length,
          bold: true,
          alignment: "center",
          fillColor: entregar === "ALAJUELA" ? "#f8cbad" : "#fff59d",
          margin: [0, Math.max(8, Math.min(30, grupo.filas.length * 4)), 0, 0]
        });
      } else {
        row.push({});
      }

      row.push(
        { text: fila.placa || "", bold: true, alignment: "center", margin: [2, 3, 2, 3] },
        { text: String(fila.cantidad || ""), alignment: "center", margin: [2, 3, 2, 3] },
        { text: descripcion, margin: [4, 3, 4, 3] }
      );
      body.push(row);
    });
  });

  body.push([
    { text: "", border: [false, false, false, false], colSpan: 2 },
    {},
    { text: "Total de unidades", bold: true, alignment: "right", fillColor: "#d9eaf7", margin: [4, 4, 4, 4] },
    { text: String(cotizacion.totalUnidades || 0), bold: true, alignment: "center", fillColor: "#d9eaf7", margin: [4, 4, 4, 4] },
    { text: "", border: [false, false, false, false] }
  ]);

  return {
    table: {
      headerRows: 1,
      widths: [72, 86, 82, 62, "*"],
      body
    },
    layout: {
      hLineColor: () => "#1f2937",
      vLineColor: () => "#1f2937",
      hLineWidth: () => 0.7,
      vLineWidth: () => 0.7,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0
    }
  };
}

function generarPdfCotizacionLlantas(cotizacion, opciones = {}) {
  const logoPath = path.join(process.cwd(), "public", "img", "logo_tomza.jpg");
  const fechaGeneracion = opciones.fechaGeneracion || new Date().toLocaleDateString("es-CR");
  const docDefinition = {
    pageSize: "LETTER",
    pageMargins: [28, 24, 28, 28],
    defaultStyle: { font: "Helvetica", fontSize: 10, color: "#111827" },
    content: [
      {
        table: {
          widths: ["*"],
          body: [[{ text: "Gas Tomza de Costa Rica S.A", bold: true, color: "#ffffff", alignment: "center", fontSize: 13, margin: [0, 3, 0, 3] }]]
        },
        layout: {
          fillColor: () => "#244573",
          hLineColor: () => "#111827",
          vLineColor: () => "#111827"
        }
      },
      {
        columns: [
          { image: logoPath, fit: [170, 70], margin: [0, 8, 0, 2] },
          { text: fechaGeneracion, alignment: "right", bold: true, margin: [0, 22, 4, 0] }
        ]
      },
      {
        text: "La lima, Cartago\n3-101-349880\nTelefono: 2201-6000",
        alignment: "center",
        margin: [0, 0, 0, 0]
      },
      {
        text: "facelectronica@tomza.com     efernandez.m@tomza.com",
        alignment: "center",
        color: "#0563c1",
        decoration: "underline",
        fontSize: 8,
        margin: [0, 0, 0, 3]
      },
      crearTablaCotizacion(cotizacion)
    ]
  };

  const pdfDoc = printer.createPdfKitDocument(docDefinition);
  return pdfStreamToBuffer(pdfDoc);
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

    const condicionesUnidades = ["placa IS NOT NULL", "TRIM(placa) <> ''"];
    const paramsUnidades = [];

    if (sedesPermitidas.length) {
      condicionesUnidades.push("sede IN (?)");
      paramsUnidades.push(sedesPermitidas);
    }

    const [unidades] = await pool.query(
      `SELECT id, placa, sede
       FROM unidades
       WHERE ${condicionesUnidades.join(" AND ")}
       ORDER BY sede, placa`,
      paramsUnidades
    );

    res.render("llantas/index", {
      user: req.session.user,
      solicitudes,
      unidades,
      sedesPermitidas,
      estados: ESTADOS,
      filtros: { sede, estado, placa },
      puedeGestionar: puedeGestionar(req.session.user),
      puedeEditarSolicitud: puedeEditar(req.session.user),
      negocioLlanta,
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
    const ids = req.query.solicitud_ids;
    const sedes = Array.isArray(req.query.sedes)
      ? req.query.sedes
      : req.query.sedes
        ? [req.query.sedes]
        : [];
    const { where, params } = construirFiltrosSolicitudes(sedesPermitidas, { ids, sede, sedes, estado, placa, semana });

    const [solicitudes] = await pool.query(`
      SELECT s.*, u.usuario AS solicitado_por_usuario
      FROM solicitudes_llantas s
      LEFT JOIN usuarios u ON u.id = s.solicitado_por
      ${where}
      ORDER BY s.sede, s.placa, s.fecha_solicitud DESC
    `, params);

    const buffer = await generarPdfCotizacionLlantas(prepararCotizacion(solicitudes), {
      fechaGeneracion: new Date().toLocaleDateString("es-CR"),
      titulo: "Cotización de llantas"
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=cotizacion_llantas.pdf");
    res.send(buffer);
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

router.post("/:id/editar", allowRoles(...ROLES_EDITAR), async (req, res) => {
  try {
    await ensureTables();
    const id = req.params.id;
    const { solicitud, error } = await cargarSolicitudAutorizada(req, id);
    if (error === "not_found") return res.status(404).send("Solicitud no encontrada");
    if (error === "forbidden") return res.status(403).send("No autorizado para esta sede");

    const {
      unidad_id,
      medida,
      cantidad,
      posicion,
      marca_sugerida,
      motivo,
      observaciones,
      estado
    } = req.body;

    const sedesPermitidas = await obtenerSedesPermitidas(req);
    const [[unidad]] = await pool.query("SELECT id, placa, sede FROM unidades WHERE id = ?", [unidad_id || solicitud.unidad_id]);
    if (!unidad) return res.status(404).send("Unidad no encontrada");
    if (!sedesPermitidas.includes(unidad.sede)) return res.status(403).send("No autorizado para esta sede");

    const estadoNormalizado = puedeGestionar(req.session.user) && ESTADOS.includes(estado)
      ? estado
      : solicitud.estado;
    const cantidadNormalizada = parseInt(cantidad, 10) || 1;
    const medidaNormalizada = String(medida || "").trim();

    if (!medidaNormalizada || cantidadNormalizada < 1) {
      return res.status(400).send("Debe indicar medida y cantidad.");
    }

    await pool.query(
      `UPDATE solicitudes_llantas
       SET unidad_id = ?,
           placa = ?,
           sede = ?,
           medida = ?,
           cantidad = ?,
           posicion = ?,
           marca_sugerida = ?,
           motivo = ?,
           observaciones = ?,
           estado = ?
       WHERE id = ?`,
      [
        unidad.id,
        unidad.placa,
        unidad.sede,
        medidaNormalizada,
        cantidadNormalizada,
        posicion || null,
        marca_sugerida || null,
        motivo || null,
        observaciones || null,
        estadoNormalizado,
        id
      ]
    );

    if (estadoNormalizado !== solicitud.estado) {
      await registrarHistorial(id, solicitud.estado, estadoNormalizado, req.session.user.id, "Solicitud editada");
    }

    res.redirect(redirectConFiltros(req));
  } catch (error) {
    console.error("Error editando solicitud de llanta:", error);
    res.status(500).send("Error editando solicitud");
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

router.post("/:id/eliminar", allowRoles(...ROLES_EDITAR), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await ensureTables();
    const id = req.params.id;
    const { solicitud, error } = await cargarSolicitudAutorizada(req, id);
    if (error === "not_found") return res.status(404).send("Solicitud no encontrada");
    if (error === "forbidden") return res.status(403).send("No autorizado para esta sede");

    await connection.beginTransaction();
    await connection.query("DELETE FROM solicitudes_llantas_historial WHERE solicitud_id = ?", [id]);
    const [result] = await connection.query("DELETE FROM solicitudes_llantas WHERE id = ?", [id]);
    await connection.commit();

    if (!result.affectedRows) {
      return res.status(404).send("Solicitud no encontrada");
    }

    res.redirect(redirectConFiltros(req));
  } catch (error) {
    await connection.rollback();
    console.error("Error eliminando solicitud de llanta:", error);
    res.status(500).send("Error eliminando solicitud");
  } finally {
    connection.release();
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

    const buffer = await generarPdfCotizacionLlantas(prepararCotizacion([solicitud]), {
      fechaGeneracion: new Date().toLocaleDateString("es-CR"),
      titulo: `Cotización de llanta ${solicitud.placa}`
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=cotizacion_llanta_${solicitud.placa}_${solicitud.id}.pdf`);
    res.send(buffer);
  } catch (error) {
    console.error("Error generando PDF de cotización:", error);
    res.status(500).send("Error generando PDF");
  }
});

module.exports = router;
