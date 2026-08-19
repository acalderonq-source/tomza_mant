const express = require("express");
const router = express.Router();
const pool = require("../db");
const { etiquetaSede, esUsuarioTodasSedes, getSedesPermitidas } = require("../utils/sedes");

const ROLES_KPIS = ["ADMIN", "TALLER", "PROVEEDURIA_TALLER"];

const FAMILIAS_ESPECIALIDAD = [
  {
    nombre: "Frenos y seguridad",
    color: "#dc2626",
    palabras: ["freno", "frenos", "fibra", "fibras", "clutch", "embrague", "direccion", "dirección", "pito", "seguridad", "alarma"]
  },
  {
    nombre: "Motor y transmisión",
    color: "#7c3aed",
    palabras: ["motor", "caja", "transmision", "transmisión", "turbo", "inyector", "inyectores", "arrancador", "compresor", "bomba", "culata", "cabezal", "radiador"]
  },
  {
    nombre: "Aceites y fluidos",
    color: "#0f766e",
    palabras: ["aceite", "engrase", "fuga", "fugas", "hidraulico", "hidráulico", "liquido", "líquido", "agua", "diesel", "filtro"]
  },
  {
    nombre: "Eléctrico y luces",
    color: "#2563eb",
    palabras: ["luz", "luces", "electrico", "eléctrico", "bateria", "batería", "alternador", "sensor", "tacometro", "tacómetro", "velocimetro", "velocímetro", "marcha"]
  },
  {
    nombre: "Llantas y suspensión",
    color: "#d97706",
    palabras: ["llanta", "llantas", "rotula", "rótula", "resorte", "suspension", "suspensión", "eje", "hoja", "muelle"]
  },
  {
    nombre: "Carrocería y estética",
    color: "#be123c",
    palabras: ["cabina", "puerta", "cajon", "cajón", "golpe", "pintar", "pintura", "calcomania", "calcomanía", "rotulacion", "rotulación", "asiento", "bumper", "parabrisas"]
  },
  {
    nombre: "Preventivo general",
    color: "#16a34a",
    palabras: ["revision general", "revisión general", "preventivo", "ajuste", "revisar", "mantenimiento", "pedales"]
  }
];

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function puedeVerKpis(user) {
  return ROLES_KPIS.includes(user?.rol);
}

function fechaCostaRica(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function inicioMesCostaRica() {
  const hoy = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Costa_Rica" }));
  hoy.setDate(1);
  return fechaCostaRica(hoy);
}

function normalizarTexto(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resumenTrabajo(value) {
  const texto = String(value || "")
    .replace(/\s*\|\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.-]+|[\s,.-]+$/g, "")
    .trim();
  if (!texto) return "Trabajo no especificado";
  return texto.length > 92 ? `${texto.slice(0, 89)}...` : texto;
}

function clasificarTrabajo(texto) {
  const normalizado = normalizarTexto(texto);
  const familia = FAMILIAS_ESPECIALIDAD.find(item =>
    item.palabras.some(palabra => normalizado.includes(normalizarTexto(palabra)))
  );
  return familia || { nombre: "Otros trabajos", color: "#64748b", palabras: [] };
}

function incrementarMapa(map, key, value = 1) {
  map.set(key, (map.get(key) || 0) + value);
}

function mayoresConteos(map, limite = 3) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"))
    .slice(0, limite)
    .map(([nombre, total]) => ({ nombre, total }));
}

function resolverSedes(req) {
  const user = req.session.user;
  if (esUsuarioTodasSedes(user)) {
    if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
      return [req.session.sedeSeleccionada];
    }
    return [];
  }
  return getSedesPermitidas(req).filter(Boolean);
}

function procesarKpis(rows) {
  const porMecanico = new Map();
  const familiasGlobal = new Map();
  const registrosVistos = new Set();
  let totalPreventivos = 0;
  let totalCorrectivos = 0;
  let duplicadosOmitidos = 0;

  rows.forEach(row => {
    const id = row.mecanico_id;
    const tipo = String(row.tipo || "").toUpperCase();
    const trabajo = resumenTrabajo(row.trabajo);
    const fechaClave = String(row.fecha || "").slice(0, 10);
    const placaClave = normalizarTexto(row.placa);
    const claveUnica = [
      tipo,
      row.mecanico_id,
      fechaClave,
      placaClave,
      normalizarTexto(trabajo)
    ].join("|");

    if (registrosVistos.has(claveUnica)) {
      duplicadosOmitidos += 1;
      return;
    }
    registrosVistos.add(claveUnica);

    if (!porMecanico.has(id)) {
      porMecanico.set(id, {
        id,
        mecanico: row.mecanico,
        sede: row.sede || "",
        preventivos: 0,
        correctivos: 0,
        total_trabajos: 0,
        familias: new Map(),
        trabajos: new Map()
      });
    }

    const item = porMecanico.get(id);
    const familia = clasificarTrabajo(trabajo);

    if (tipo === "PREVENTIVO") {
      item.preventivos += 1;
      totalPreventivos += 1;
    } else {
      item.correctivos += 1;
      totalCorrectivos += 1;
    }

    item.total_trabajos += 1;
    incrementarMapa(item.familias, familia.nombre);
    incrementarMapa(item.trabajos, trabajo);
    incrementarMapa(familiasGlobal, familia.nombre);
  });

  const mecanicos = [...porMecanico.values()]
    .map(item => {
      const especialidades = mayoresConteos(item.familias, 4);
      const principal = especialidades[0] || { nombre: "Sin datos", total: 0 };
      return {
        ...item,
        familias: undefined,
        trabajos: undefined,
        especialidad: principal.nombre,
        especialidad_total: principal.total,
        especialidad_porcentaje: item.total_trabajos
          ? Math.round((principal.total / item.total_trabajos) * 100)
          : 0,
        especialidades,
        trabajos_frecuentes: mayoresConteos(item.trabajos, 3)
      };
    })
    .sort((a, b) => b.total_trabajos - a.total_trabajos || a.mecanico.localeCompare(b.mecanico, "es"));

  const totalTrabajos = totalPreventivos + totalCorrectivos;

  return {
    mecanicos,
    resumen: {
      totalPreventivos,
      totalCorrectivos,
      totalTrabajos,
      mecanicosActivos: mecanicos.filter(item => item.total_trabajos > 0).length,
      promedioPorMecanico: mecanicos.length ? Math.round(totalTrabajos / mecanicos.length) : 0,
      duplicadosOmitidos
    },
    familias: mayoresConteos(familiasGlobal, 8).map(item => {
      const config = FAMILIAS_ESPECIALIDAD.find(familia => familia.nombre === item.nombre);
      return {
        ...item,
        color: config?.color || "#64748b",
        porcentaje: totalTrabajos ? Math.round((item.total / totalTrabajos) * 100) : 0
      };
    })
  };
}

router.get("/mecanicos", requireAuth, async (req, res) => {
  try {
    if (!puedeVerKpis(req.session.user)) return res.redirect("/dashboard");

    const desde = String(req.query.desde || inicioMesCostaRica()).trim();
    const hasta = String(req.query.hasta || fechaCostaRica()).trim();
    const sedesFiltro = resolverSedes(req);
    const sedeVista = sedesFiltro.length === 1 ? sedesFiltro[0] : "TODAS";

    const preventivosParams = [desde, hasta];
    const correctivosParams = [desde, hasta];
    let preventivosSedeSql = "";
    let correctivosSedeSql = "";

    if (sedesFiltro.length) {
      preventivosSedeSql = "AND u.sede IN (?)";
      correctivosSedeSql = "AND COALESCE(u.sede, c.sede) IN (?)";
      preventivosParams.push(sedesFiltro);
      correctivosParams.push(sedesFiltro);
    }

    const [rows] = await pool.query(
      `
      SELECT
        mt.id AS source_id,
        u.placa,
        mec.id AS mecanico_id,
        mec.nombre AS mecanico,
        mec.sede,
        'PREVENTIVO' AS tipo,
        COALESCE(NULLIF(mt.ejecucion, ''), NULLIF(mt.plan, ''), NULLIF(mt.tipo, ''), 'Mantenimiento preventivo') AS trabajo,
        DATE_FORMAT(COALESCE(mt.fecha_cierre, mt.fecha_programada), '%Y-%m-%d') AS fecha
      FROM mantenimiento_mecanicos mm
      JOIN mecanicos mec ON mec.id = mm.mecanico_id
      JOIN mantenimientos mt ON mt.id = mm.mantenimiento_id
      JOIN unidades u ON u.id = mt.unidad_id
      WHERE mt.estado = 'CERRADO'
        AND DATE(COALESCE(mt.fecha_cierre, mt.fecha_programada)) BETWEEN ? AND ?
        ${preventivosSedeSql}

      UNION ALL

      SELECT
        c.id AS source_id,
        COALESCE(u.placa, '') AS placa,
        mec.id AS mecanico_id,
        mec.nombre AS mecanico,
        mec.sede,
        'CORRECTIVO' AS tipo,
        COALESCE(NULLIF(ct.trabajo, ''), NULLIF(c.trabajo_realizado, ''), 'Correctivo') AS trabajo,
        DATE_FORMAT(c.fecha, '%Y-%m-%d') AS fecha
      FROM correctivo_trabajos ct
      JOIN mecanicos mec ON mec.id = ct.mecanico_id
      JOIN correctivos c ON c.id = ct.correctivo_id
      LEFT JOIN unidades u ON u.id = c.unidad_id
      WHERE DATE(c.fecha) BETWEEN ? AND ?
        ${correctivosSedeSql}
      `,
      [...preventivosParams, ...correctivosParams]
    );

    const data = procesarKpis(rows);

    res.render("kpis_mecanicos", {
      user: req.session.user,
      desde,
      hasta,
      sede: sedeVista,
      sedeTexto: sedeVista === "TODAS" ? "Todas" : etiquetaSede(sedeVista),
      totales: data.mecanicos,
      resumen: data.resumen,
      familias: data.familias
    });
  } catch (error) {
    console.error("ERROR KPIs mecánicos:", error);
    res.status(500).send("Error cargando KPIs de mecánicos");
  }
});

module.exports = router;
