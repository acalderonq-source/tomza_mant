const express = require("express");
const pool = require("../db");
const { SEDES_TRANSPORTADORA_DETALLE, SEDES_GRANEL } = require("../utils/sedes");

const router = express.Router();
const SEDES_TRANSPORTADORA = [
  "Transportadora",
  ...SEDES_TRANSPORTADORA_DETALLE.filter(sede => !["Cisternas", "Carretas"].includes(sede))
];
const SEDES_CONTROL = [...new Set([...SEDES_TRANSPORTADORA, ...SEDES_GRANEL])];
const SEDES_GRANEL_NORMALIZADAS = new Set(SEDES_GRANEL.map(valor =>
  valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase()
));
const ROLES_PERMITIDOS = ["ADMIN", "TALLER", "PROVEEDURIA_TALLER"];

function autorizado(req, res, next) {
  const user = req.session.user;
  if (!user) return res.redirect("/login");
  if (!ROLES_PERMITIDOS.includes(user.rol)) return res.sendStatus(403);
  if (user.rol !== "PROVEEDURIA_TALLER" && user.departamentoActivo !== "TALLER") return res.sendStatus(403);
  next();
}

function calcularFechaProximoCambio(fechaCambio, kilometrosMes, intervaloKm) {
  const dias = Math.ceil((Number(intervaloKm) / Number(kilometrosMes)) * (365.2425 / 12));
  const fecha = new Date(`${fechaCambio}T12:00:00.000Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

function fechaValida(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ""))) return false;
  const value = new Date(`${fecha}T00:00:00.000Z`);
  return !Number.isNaN(value.getTime()) && value.toISOString().slice(0, 10) === fecha;
}

function fechaActualCostaRica() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function estadoProgramacion(fechaProximoCambio, hoy = fechaActualCostaRica()) {
  const objetivo = new Date(`${fechaProximoCambio}T00:00:00.000Z`);
  const hoyTexto = hoy instanceof Date ? hoy.toISOString().slice(0, 10) : hoy;
  const actual = new Date(`${hoyTexto}T00:00:00.000Z`);
  const dias = Math.ceil((objetivo - actual) / 86400000);
  if (dias < 0) return { clave: "vencido", etiqueta: `Vencido hace ${Math.abs(dias)} día(s)`, dias };
  if (dias === 0) return { clave: "hoy", etiqueta: "Toca hoy", dias };
  if (dias <= 30) return { clave: "proximo", etiqueta: `En ${dias} día(s)`, dias };
  return { clave: "programado", etiqueta: `En ${dias} día(s)`, dias };
}

function grupoUnidad(sede) {
  const clave = String(sede || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  return SEDES_GRANEL_NORMALIZADAS.has(clave) ? "granel" : "transportadora";
}

async function asegurarTablaProgramaciones() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS control_cambios_aceite_programaciones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      unidad_id INT NOT NULL,
      kilometros_mes DECIMAL(10,2) NOT NULL,
      intervalo_km INT NOT NULL,
      fecha_ultimo_cambio DATE NOT NULL,
      fecha_proximo_cambio DATE NOT NULL,
      observaciones VARCHAR(500) NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      creado_por INT NULL,
      actualizado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_control_cambios_aceite_unidad (unidad_id),
      INDEX idx_control_cambios_aceite_proximo (fecha_proximo_cambio, activo),
      INDEX idx_control_cambios_aceite_actualizado (actualizado_en)
    )
  `);
}

router.use(autorizado);

router.get("/", async (req, res) => {
  try {
    await asegurarTablaProgramaciones();
    const filtro = ["transportadora", "granel"].includes(String(req.query.tipo || "").toLowerCase())
      ? String(req.query.tipo).toLowerCase()
      : "todas";
    const sedesFiltro = filtro === "granel"
      ? SEDES_GRANEL
      : filtro === "transportadora"
        ? SEDES_TRANSPORTADORA
        : SEDES_CONTROL;
    const [unidades] = await pool.query(
      `SELECT u.id, u.placa, u.sede,
              p.kilometros_mes, p.intervalo_km,
              DATE_FORMAT(p.fecha_ultimo_cambio, '%Y-%m-%d') AS fecha_ultimo_cambio,
              DATE_FORMAT(p.fecha_proximo_cambio, '%Y-%m-%d') AS fecha_proximo_cambio,
              p.observaciones
       FROM unidades u
       LEFT JOIN control_cambios_aceite_programaciones p ON p.unidad_id = u.id AND p.activo = 1
       WHERE COALESCE(u.activa, 1) = 1 AND u.sede IN (?)
       ORDER BY u.sede, u.placa`,
      [sedesFiltro]
    );

    const hoy = fechaActualCostaRica();
    const registros = unidades.map(unidad => ({
      ...unidad,
      grupo: grupoUnidad(unidad.sede),
      estado: unidad.fecha_proximo_cambio ? estadoProgramacion(unidad.fecha_proximo_cambio, hoy) : null
    }));
    const resumen = registros.reduce((total, unidad) => {
      if (!unidad.fecha_proximo_cambio) total.sinProgramar += 1;
      else if (["vencido", "hoy"].includes(unidad.estado.clave)) total.urgentes += 1;
      else if (unidad.estado.clave === "proximo") total.proximos += 1;
      total.programadas += Number(Boolean(unidad.fecha_proximo_cambio));
      return total;
    }, { unidades: registros.length, programadas: 0, sinProgramar: 0, urgentes: 0, proximos: 0 });

    res.render("control_cambios_aceite", {
      unidades: registros,
      resumen,
      filtro,
      success: req.session.controlAceiteSuccess,
      error: req.session.controlAceiteError,
      user: req.session.user
    });
    delete req.session.controlAceiteSuccess;
    delete req.session.controlAceiteError;
  } catch (error) {
    console.error("Error cargando programación de cambios de aceite:", error);
    res.status(500).send("No se pudo cargar el control de cambios de aceite.");
  }
});

router.post("/:unidadId", async (req, res) => {
  const { unidadId } = req.params;
  const tipo = ["transportadora", "granel"].includes(String(req.body.tipo || "").toLowerCase())
    ? String(req.body.tipo).toLowerCase()
    : "todas";
  const returnUrl = `/control-cambios-aceite${tipo === "todas" ? "" : `?tipo=${tipo}`}`;
  const kilometrosMes = Number(req.body.kilometros_mes);
  const intervaloKm = Number(req.body.intervalo_km);
  const fechaCambio = String(req.body.fecha_ultimo_cambio || "");
  const observaciones = String(req.body.observaciones || "").trim().slice(0, 500);

  if (!/^\d+$/.test(unidadId) || !Number.isFinite(kilometrosMes) || kilometrosMes <= 0 || kilometrosMes > 100000 ||
      !Number.isInteger(intervaloKm) || intervaloKm < 1000 || intervaloKm > 100000 || !fechaValida(fechaCambio) || fechaCambio > fechaActualCostaRica()) {
    req.session.controlAceiteError = "Revise el promedio mensual, el intervalo en kilómetros y la fecha del último cambio.";
    return res.redirect(returnUrl);
  }

  try {
    await asegurarTablaProgramaciones();
    const [[unidad]] = await pool.query(
      "SELECT id FROM unidades WHERE id = ? AND COALESCE(activa, 1) = 1 AND sede IN (?) LIMIT 1",
      [unidadId, SEDES_CONTROL]
    );
    if (!unidad) return res.sendStatus(404);

    const proximoCambio = calcularFechaProximoCambio(fechaCambio, kilometrosMes, intervaloKm);
    await pool.query(
      `INSERT INTO control_cambios_aceite_programaciones
        (unidad_id, kilometros_mes, intervalo_km, fecha_ultimo_cambio, fecha_proximo_cambio, observaciones, creado_por, actualizado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        kilometros_mes = VALUES(kilometros_mes),
        intervalo_km = VALUES(intervalo_km),
        fecha_ultimo_cambio = VALUES(fecha_ultimo_cambio),
        fecha_proximo_cambio = VALUES(fecha_proximo_cambio),
        observaciones = VALUES(observaciones),
        activo = 1,
        actualizado_por = VALUES(actualizado_por)`,
      [unidadId, kilometrosMes, intervaloKm, fechaCambio, proximoCambio, observaciones || null, req.session.user.id || null, req.session.user.id || null]
    );
    req.session.controlAceiteSuccess = "Programación guardada. La próxima fecha se calculó con el promedio mensual y el intervalo indicados.";
  } catch (error) {
    console.error("Error guardando programación de cambios de aceite:", error);
    req.session.controlAceiteError = "No se pudo guardar la programación.";
  }
  res.redirect(returnUrl);
});

module.exports = router;
module.exports.calcularFechaProximoCambio = calcularFechaProximoCambio;
module.exports.estadoProgramacion = estadoProgramacion;
module.exports.fechaValida = fechaValida;
module.exports.asegurarTablaProgramaciones = asegurarTablaProgramaciones;
module.exports.grupoUnidad = grupoUnidad;
module.exports.sedesTransportadora = SEDES_TRANSPORTADORA;
module.exports.sedesGranel = SEDES_GRANEL;
